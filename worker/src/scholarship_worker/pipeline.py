"""The discovery pipeline: discover -> fetch -> extract -> validate -> review queue.

Each stage writes to its own table, so a failure in one stage never corrupts
another. Nothing here publishes: every new or changed offering goes to the
admin review queue.
"""

from __future__ import annotations

import logging
import re
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from scholarship_worker import prefilter
from scholarship_worker.db import JobRun
from scholarship_worker.extract_text import UnsupportedDocument, document_to_text
from scholarship_worker.fetch import FetchError, PoliteFetcher
from scholarship_worker.llm import SCHEMA_VERSION, ExtractionError, Extractor
from scholarship_worker.repository import QueueItem, Repository
from scholarship_worker.validate import checks_as_rows, validate_offering

log = logging.getLogger(__name__)

LINK_HINT = re.compile(r"scholar|iskolar|grant|assistance|financial|stipend|guideline|application|apply", re.I)
MAX_LINKS_PER_PAGE = 10


@dataclass
class PipelineConfig:
    batch_size: int = 40
    time_budget_s: float = 20 * 60
    llm_daily_limit: int = 1000  # below the free tier's ~1,500 requests a day


@dataclass
class ItemOutcome:
    status: str  # unchanged | filtered_out | no_offerings | candidates | failed | skipped_quota
    candidates: int = 0


class DiscoveryPipeline:
    def __init__(self, repo: Repository, fetcher: PoliteFetcher, extractor: Extractor | None,
                 config: PipelineConfig | None = None, now: Callable[[], datetime] | None = None):
        self.repo = repo
        self.fetcher = fetcher
        self.extractor = extractor
        self.config = config or PipelineConfig()
        self.now = now or (lambda: datetime.now(timezone.utc))

    # ------------------------------------------------------------- top level

    def run(self, job: JobRun) -> dict[str, Any]:
        enqueued = self.repo.enqueue_due_sources()
        submitted = self.repo.enqueue_submissions()
        self.repo.commit()

        llm_budget = max(0, self.config.llm_daily_limit - self.repo.llm_calls_today())
        started = time.monotonic()
        counts: dict[str, int] = {}

        while time.monotonic() - started < self.config.time_budget_s:
            items = self.repo.claim(min(10, self.config.batch_size - sum(counts.values())))
            self.repo.commit()
            if not items:
                break
            for item in items:
                outcome = self.process(item, job, llm_budget - job.llm_calls)
                counts[outcome.status] = counts.get(outcome.status, 0) + 1
                self.repo.commit()
            if sum(counts.values()) >= self.config.batch_size:
                break

        statuses = self.repo.maintain_statuses()
        self.repo.commit()
        summary = {"enqueued_sources": enqueued, "enqueued_submissions": submitted, "outcomes": counts,
                   "llm_budget_left": max(0, llm_budget - job.llm_calls), **statuses}
        job.details.update(summary)
        return summary

    # ------------------------------------------------------------- one URL

    def process(self, item: QueueItem, job: JobRun, llm_budget: int) -> ItemOutcome:
        try:
            result = self.fetcher.fetch(item.url, etag=item.etag, last_modified=item.last_modified)
        except FetchError as exc:
            return self._fetch_failed(item, exc, job)

        job.pages_fetched += 1

        if result.not_modified:
            self.repo.source_checked(item.source_id, success=True)
            self.repo.finish(item)
            self.repo.submission_done(item.submission_id)
            return ItemOutcome("unchanged")

        try:
            doc = document_to_text(result.kind or "", result.body, result.final_url, result.content_type)
        except UnsupportedDocument as exc:
            self.repo.source_checked(item.source_id, success=True)
            self.repo.finish(item)
            if item.submission_id:
                self.repo.open_review_task("submission", "submissions", item.submission_id,
                                           f"Submitted link needs a manual look ({exc}): {item.url}")
                self.repo.submission_done(item.submission_id)
            return ItemOutcome("no_offerings")

        if self.repo.latest_hash(item.url) == doc.content_hash:
            self.repo.touch_document_validators(item.url, result.etag, result.last_modified)
            self.repo.source_checked(item.source_id, success=True)
            self.repo.finish(item)
            self.repo.submission_done(item.submission_id)
            return ItemOutcome("unchanged")

        doc_id, retrieved_at = self.repo.save_document(
            source_id=item.source_id, url=item.url, status=result.status, content_type=result.content_type,
            content_hash=doc.content_hash, text=doc.text, etag=result.etag, last_modified=result.last_modified,
        )
        self.repo.source_checked(item.source_id, success=True, changed=True)

        screen = prefilter.check(doc.text)
        if not screen.passed:
            self.repo.finish(item)
            self.repo.submission_done(item.submission_id)
            return ItemOutcome("filtered_out")

        self._follow_links(item, doc.links)

        if self.extractor is None or llm_budget <= 0:
            # Leave it for the next run rather than skipping silently.
            self.repo.fail(item, "AI extraction quota reached for today", permanent=False, max_attempts=10)
            return ItemOutcome("skipped_quota")

        try:
            job.llm_calls += 1
            extracted = self.extractor.extract(doc.text, source_url=item.url, title=doc.title,
                                               links=[u for u, _ in doc.links])
        except ExtractionError as exc:
            dead = self.repo.fail(item, f"extraction: {exc}", permanent=not exc.retryable)
            job.record_error(f"extraction failed for a page: {exc}")
            if dead:
                self.repo.submission_done(item.submission_id)
            return ItemOutcome("failed")

        offerings = extracted.get("offerings") or [] if extracted.get("is_announcement") else []
        made = 0
        for idx, off in enumerate(offerings[:10]):
            made += self._save_offering(item, off, idx, doc_id, retrieved_at, doc.text, [u for u, _ in doc.links])

        if not made and item.submission_id:
            self.repo.open_review_task("submission", "submissions", item.submission_id,
                                       f"Submitted link had no scholarship offering the system could read: {item.url}")
        self.repo.finish(item)
        self.repo.submission_done(item.submission_id)
        return ItemOutcome("candidates" if made else "no_offerings", made)

    # ------------------------------------------------------------- helpers

    def _fetch_failed(self, item: QueueItem, exc: FetchError, job: JobRun) -> ItemOutcome:
        dead = self.repo.fail(item, f"{exc.reason}: {exc}", permanent=exc.permanent)
        robots = False if exc.reason == "robots_disallowed" else None
        if dead:
            self.repo.source_checked(item.source_id, success=False, robots_allowed=robots)
            if item.submission_id:
                self.repo.open_review_task("submission", "submissions", item.submission_id,
                                           f"Could not fetch a submitted link automatically ({exc.reason}); check it by hand: {item.url}")
                self.repo.submission_done(item.submission_id)
        if not exc.permanent:
            job.record_error(f"fetch failed ({exc.reason}) for {urllib.parse.urlsplit(item.url).hostname}")
        return ItemOutcome("failed")

    def _follow_links(self, item: QueueItem, links: list[tuple[str, str]]) -> None:
        host = urllib.parse.urlsplit(item.url).hostname or ""
        queued = 0
        for url, anchor in links:
            if queued >= MAX_LINKS_PER_PAGE:
                break
            if not (LINK_HINT.search(anchor) or LINK_HINT.search(url)):
                continue
            link_host = urllib.parse.urlsplit(url).hostname or ""
            if link_host == host:
                if self.repo.enqueue_link(url, item.source_id, item.url):
                    queued += 1
            elif link_host.endswith((".gov.ph", ".edu.ph")):
                self.repo.suggest_source(url, link_host, "link")

    def _save_offering(self, item: QueueItem, off: dict[str, Any], idx: int, doc_id: str, retrieved_at: str,
                       text: str, links: list[str]) -> int:
        v = validate_offering(
            off, source_text=text, source_url=item.url, retrieved_at=self.now(),
            page_links=links, provider_domains=item.provider_domains, source_tier=item.tier,
        )
        name = v.normalized.get("program_name")
        if not name:
            return 0

        payload = v.to_payload()
        kind = "new_offering"
        similar = self.repo.similar_programs(name)
        payload["similar_programs"] = [
            {"program_id": str(s["program_id"]), "program_name": s["program_name"],
             "provider_name": s["provider_name"], "similarity": float(s["similarity"])}
            for s in similar
        ]
        changes: list[str] = []
        ay = v.normalized.get("academic_year")
        if similar and ay and float(similar[0]["similarity"]) >= 0.8:
            existing = self.repo.published_offering(str(similar[0]["program_id"]), ay)
            if existing:
                kind = "offering_change"
                payload["existing_offering_id"] = str(existing["id"])
                for field in ("opens_on", "closes_on", "apply_url"):
                    new = v.normalized.get(field)
                    if new and str(existing.get(field) or "") != new:
                        changes.append(f"{field}: {existing.get(field) or 'none'} -> {new}")
                if not changes:
                    return 0  # same details as the published record: nothing to review
                payload["changes"] = changes
        elif similar and float(similar[0]["similarity"]) >= 0.6:
            kind = "duplicate"

        when = v.normalized.get("closes_on") or ("rolling" if v.normalized.get("rolling_admission") else "no deadline found")
        summary = f"{name} ({ay or 'year not stated'}), closes {when}"
        cand_id = self.repo.save_candidate(
            raw_document_id=doc_id, model=getattr(self.extractor, "model", "unknown"), schema_version=SCHEMA_VERSION,
            offering_index=idx, payload=payload, flags=v.flags, confidence=v.confidence,
            suggested_status=v.suggested_status, summary=summary, needs_review=v.blocking or bool(v.flags),
        )
        self.repo.save_evidence(cand_id, item.url, retrieved_at, checks_as_rows(v.fields))

        label = {"new_offering": "New", "offering_change": "Changed", "duplicate": "Possible duplicate"}[kind]
        detail = "; ".join(changes) if changes else f"{len(v.flags)} flag(s)" if v.flags else "no flags"
        self.repo.open_review_task(kind, "extracted_candidates", cand_id, f"{label}: {summary} — {detail}")
        return 1

