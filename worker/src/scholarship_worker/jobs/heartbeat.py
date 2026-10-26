"""Heartbeat: proves the scheduled worker can reach the database, and reports
registry health. Runs daily, and keeps the free Supabase project active.

Phase 2 adds the real jobs (fetch, extract, validate) beside this one.
"""

from __future__ import annotations

import logging

from scholarship_worker.db import Connection, job_run

log = logging.getLogger(__name__)


def run(conn: Connection) -> dict[str, int]:
    with job_run(conn, "heartbeat") as job:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*) filter (where active and not submission_only),
                       count(*) filter (where is_stale),
                       count(*) filter (where is_failing)
                  from public.source_health
                """
            )
            active, stale, failing = cur.fetchone()
            cur.execute("select count(*) from public.fetch_queue where status in ('queued', 'in_progress')")
            (queued,) = cur.fetchone()
            cur.execute("select count(*) from public.review_tasks where status = 'open'")
            (open_tasks,) = cur.fetchone()

        summary = {
            "active_sources": int(active),
            "stale_sources": int(stale),
            "failing_sources": int(failing),
            "queued_fetches": int(queued),
            "open_review_tasks": int(open_tasks),
        }
        job.details.update(summary)

    log.info(
        "heartbeat: %(active_sources)d active sources, %(stale_sources)d stale, "
        "%(failing_sources)d failing, %(queued_fetches)d queued, %(open_review_tasks)d open review tasks",
        summary,
    )
    return summary
