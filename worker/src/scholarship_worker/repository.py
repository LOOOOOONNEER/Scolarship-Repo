"""All SQL the discovery pipeline runs, as the discovery_worker role.

Kept in one place so it is easy to review against the privacy boundary: no
query here touches a student table (CI enforces this too).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from scholarship_worker.db import Connection


def _rows(cur) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def as_bool(v: Any) -> bool:
    return v is True or v in ("t", "true", "True", 1, "1")


@dataclass
class QueueItem:
    id: int
    url: str
    source_id: str | None
    submission_id: str | None
    attempts: int
    tier: int
    etag: str | None
    last_modified: str | None
    provider_domains: list[str]


class Repository:
    def __init__(self, conn: Connection):
        self.conn = conn

    def _exec(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return _rows(cur) if cur.description else []

    def commit(self) -> None:
        self.conn.commit()

    # ------------------------------------------------------------- queue

    def enqueue_due_sources(self) -> int:
        """Adaptive cadence: daily near a deadline, monthly when dormant, otherwise the source's interval."""
        rows = self._exec(
            """
            with due as (
              select s.id, s.url, s.tier
                from public.sources s
               where s.active and not s.submission_only and s.robots_allowed is not false
                 and (s.last_checked_at is null or s.last_checked_at < now() - (
                   case
                     when exists (
                       select 1 from public.offering_sources os
                         join public.raw_documents d on d.id = os.raw_document_id
                         join public.offerings o on o.id = os.offering_id
                        where d.source_id = s.id and o.publish_state = 'published'
                          and o.closes_on between current_date and current_date + 30
                     ) then interval '20 hours'
                     when s.last_changed_at < now() - interval '90 days' then interval '30 days'
                     else s.crawl_interval - interval '4 hours'
                   end))
            )
            insert into public.fetch_queue (url, source_id, priority)
            select url, id, tier from due
            on conflict (url) where status in ('queued', 'in_progress') do nothing
            returning id
            """
        )
        return len(rows)

    def enqueue_submissions(self, limit: int = 50) -> int:
        subs = self._exec(
            "select id, url from public.submissions_for_worker where status = 'new' and url is not null "
            "order by created_at limit %s",
            (limit,),
        )
        n = 0
        for sub in subs:
            inserted = self._exec(
                """
                insert into public.fetch_queue (url, priority, submission_id)
                values (%s, 2, %s)
                on conflict (url) where status in ('queued', 'in_progress') do nothing
                returning id
                """,
                (sub["url"], sub["id"]),
            )
            self._exec("select public.worker_set_submission_status(%s, 'processing')", (sub["id"],))
            n += len(inserted)
        return n

    def enqueue_link(self, url: str, source_id: str | None, parent_url: str) -> bool:
        rows = self._exec(
            """
            insert into public.fetch_queue (url, source_id, priority, parent_url)
            select %s, %s, 6, %s
             where not exists (select 1 from public.raw_documents where url = %s)
            on conflict (url) where status in ('queued', 'in_progress') do nothing
            returning id
            """,
            (url, source_id, parent_url, url),
        )
        return bool(rows)

    def suggest_source(self, url: str, domain: str, found_via: str, query: str | None = None) -> None:
        self._exec(
            """
            insert into public.source_suggestions (url, domain, found_via, query)
            select %s, %s, %s, %s
             where not exists (select 1 from public.sources where url = %s)
            on conflict (url) do nothing
            """,
            (url, domain, found_via, query, url),
        )

    def claim(self, limit: int) -> list[QueueItem]:
        rows = self._exec(
            """
            with picked as (
              select q.id from public.fetch_queue q
               where q.status = 'queued' and q.next_attempt_at <= now()
               order by q.priority, q.created_at
               limit %s
               for update skip locked
            )
            update public.fetch_queue q set status = 'in_progress'
              from picked where q.id = picked.id
            returning q.id, q.url, q.source_id, q.submission_id, q.attempts
            """,
            (limit,),
        )
        items = []
        for r in rows:
            extra = self._exec(
                """
                select coalesce(s.tier, 3) as tier,
                       (select d.etag from public.raw_documents d where d.url = %s order by d.retrieved_at desc limit 1) as etag,
                       (select d.last_modified from public.raw_documents d where d.url = %s order by d.retrieved_at desc limit 1) as last_modified,
                       coalesce(array_to_string(p.official_domains, ','), '') as domains
                  from (select 1) one
                  left join public.sources s on s.id = %s
                  left join public.providers p on p.id = s.provider_id
                """,
                (r["url"], r["url"], r["source_id"]),
            )[0]
            items.append(QueueItem(
                id=int(r["id"]), url=r["url"],
                source_id=str(r["source_id"]) if r["source_id"] else None,
                submission_id=str(r["submission_id"]) if r["submission_id"] else None,
                attempts=int(r["attempts"]), tier=int(extra["tier"]),
                etag=extra["etag"], last_modified=extra["last_modified"],
                provider_domains=[d for d in (extra["domains"] or "").split(",") if d],
            ))
        return items

    def finish(self, item: QueueItem) -> None:
        self._exec("update public.fetch_queue set status = 'done', last_error = null where id = %s", (item.id,))

    def fail(self, item: QueueItem, error: str, *, permanent: bool, max_attempts: int = 3) -> bool:
        """Records a failure; returns True if the item is now dead (no more retries)."""
        attempts = item.attempts + 1
        dead = permanent or attempts >= max_attempts
        self._exec(
            """
            update public.fetch_queue
               set attempts = %s, last_error = %s,
                   status = case when %s then 'dead' else 'queued' end,
                   next_attempt_at = now() + (interval '30 minutes' * power(4, %s - 1))
             where id = %s
            """,
            (attempts, error[:500], dead, attempts, item.id),
        )
        return dead

    # ------------------------------------------------------------- sources

    def source_checked(self, source_id: str | None, *, success: bool, changed: bool = False,
                       robots_allowed: bool | None = None) -> None:
        if not source_id:
            return
        self._exec(
            """
            update public.sources
               set last_checked_at = now(),
                   last_success_at = case when %s then now() else last_success_at end,
                   last_changed_at = case when %s then now() else last_changed_at end,
                   consecutive_failures = case when %s then 0 else consecutive_failures + 1 end,
                   robots_allowed = coalesce(%s, robots_allowed)
             where id = %s
            """,
            (success, changed, success, robots_allowed, source_id),
        )

    # ------------------------------------------------------------- documents

    def latest_hash(self, url: str) -> str | None:
        rows = self._exec(
            "select content_hash from public.raw_documents where url = %s order by retrieved_at desc limit 1", (url,)
        )
        return rows[0]["content_hash"] if rows else None

    def save_document(self, *, source_id, url, status, content_type, content_hash, text, etag, last_modified) -> tuple[str, str]:
        rows = self._exec(
            """
            insert into public.raw_documents (source_id, url, http_status, content_type, content_hash, text_content, etag, last_modified)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            returning id, retrieved_at
            """,
            (source_id, url, status, content_type, content_hash, text, etag, last_modified),
        )
        return str(rows[0]["id"]), str(rows[0]["retrieved_at"])

    def touch_document_validators(self, url: str, etag: str | None, last_modified: str | None) -> None:
        self._exec(
            """
            update public.raw_documents set etag = coalesce(%s, etag), last_modified = coalesce(%s, last_modified)
             where id = (select id from public.raw_documents where url = %s order by retrieved_at desc limit 1)
            """,
            (etag, last_modified, url),
        )

    # ------------------------------------------------------------- candidates

    def similar_programs(self, name: str) -> list[dict[str, Any]]:
        return self._exec("select * from public.similar_programs(%s, 3)", (name,))

    def published_offering(self, program_id: str, academic_year: str) -> dict[str, Any] | None:
        rows = self._exec(
            """
            select id, opens_on::text as opens_on, closes_on::text as closes_on, apply_url,
                   application_status::text as application_status
              from public.offerings
             where program_id = %s and academic_year = %s and publish_state = 'published'
             limit 1
            """,
            (program_id, academic_year),
        )
        return rows[0] if rows else None

    def save_candidate(self, *, raw_document_id, model, schema_version, offering_index, payload, flags,
                       confidence, suggested_status, summary, needs_review: bool) -> str:
        rows = self._exec(
            """
            insert into public.extracted_candidates
              (raw_document_id, model, schema_version, offering_index, payload, validation_flags, confidence,
               suggested_status, summary, status)
            values (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s::public.application_status, %s,
                    %s::public.candidate_status)
            returning id
            """,
            (raw_document_id, model, schema_version, offering_index, json.dumps(payload), json.dumps(flags),
             confidence, suggested_status, summary, "needs_review" if needs_review else "pending"),
        )
        return str(rows[0]["id"])

    def save_evidence(self, candidate_id: str, source_url: str, retrieved_at: str, checks: list[dict[str, Any]]) -> None:
        for c in checks:
            self._exec(
                """
                insert into public.field_evidence
                  (candidate_id, field_name, extracted_value, parsed_value, source_url, retrieved_at, evidence_text,
                   evidence_found, validation_result, validation_notes)
                values (%s, %s, %s, %s::jsonb, %s, %s::timestamptz, %s, %s, %s, %s)
                """,
                (candidate_id, c["field_name"], c["extracted_value"], json.dumps(c["parsed_value"]), source_url,
                 retrieved_at, c["evidence_text"], c["evidence_found"], c["validation_result"], c["validation_notes"]),
            )

    def open_review_task(self, kind: str, ref_table: str, ref_id: str, summary: str) -> None:
        self._exec(
            """
            insert into public.review_tasks (kind, ref_table, ref_id, summary)
            select %s::public.review_kind, %s, %s, %s
             where not exists (
               select 1 from public.review_tasks where ref_table = %s and ref_id = %s and status = 'open')
            """,
            (kind, ref_table, ref_id, summary[:500], ref_table, ref_id),
        )

    def submission_done(self, submission_id: str | None, status: str = "processed") -> None:
        if submission_id:
            self._exec("select public.worker_set_submission_status(%s, %s)", (submission_id, status))

    # ------------------------------------------------------------- statuses and quota

    def maintain_statuses(self) -> dict[str, int]:
        """Downgrades stale 'open, verified' and closes offerings whose deadline passed and was rechecked."""
        stale = self._exec(
            """
            update public.offerings set application_status = 'open_unconfirmed'
             where publish_state = 'published' and application_status = 'open_verified'
               and status_verified_at < now() - interval '7 days'
            returning id
            """
        )
        closed = self._exec(
            """
            update public.offerings o set application_status = 'closed'
             where o.publish_state = 'published'
               and o.application_status in ('open_verified', 'open_unconfirmed')
               and o.closes_on < current_date
               and exists (
                 select 1 from public.offering_sources os
                   join public.raw_documents d on d.id = os.raw_document_id
                   join public.sources s on s.id = d.source_id
                  where os.offering_id = o.id and s.last_success_at::date > o.closes_on)
            returning id
            """
        )
        return {"downgraded": len(stale), "closed": len(closed)}

    def llm_calls_today(self) -> int:
        rows = self._exec(
            """
            select coalesce(sum(llm_calls), 0) as n from public.job_runs
             where started_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
            """
        )
        return int(rows[0]["n"])
