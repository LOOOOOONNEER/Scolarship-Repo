"""Discovery job: run daily by GitHub Actions."""

from __future__ import annotations

import logging

from scholarship_worker.config import Settings
from scholarship_worker.db import Connection, job_run
from scholarship_worker.fetch import PoliteFetcher
from scholarship_worker.llm import GeminiExtractor
from scholarship_worker.pipeline import DiscoveryPipeline, PipelineConfig
from scholarship_worker.repository import Repository

log = logging.getLogger(__name__)


def run(conn: Connection, settings: Settings) -> dict:
    extractor = None
    if settings.gemini_api_key:
        extractor = GeminiExtractor(settings.gemini_api_key, model=settings.gemini_model)
    else:
        log.warning("GEMINI_API_KEY is not set: pages will be fetched and filtered, but not extracted")

    fetcher = PoliteFetcher(user_agent=settings.user_agent, per_host_delay_s=settings.per_host_delay_s)
    pipeline = DiscoveryPipeline(
        Repository(conn), fetcher, extractor,
        PipelineConfig(batch_size=settings.batch_size, llm_daily_limit=settings.llm_daily_limit),
    )
    with job_run(conn, "discover") as job:
        job.details["partial_ok"] = True  # one unreachable site should not mark the whole run failed
        summary = pipeline.run(job)
    log.info("discover: %s", summary)
    return summary
