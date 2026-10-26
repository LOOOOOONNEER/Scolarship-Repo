"""Database access as the restricted discovery_worker role."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator, Protocol

from scholarship_worker.logsafe import redact

log = logging.getLogger(__name__)


class Connection(Protocol):  # the subset of a DB-API / psycopg connection we use
    def cursor(self) -> Any: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...
    def close(self) -> None: ...


def connect(database_url: str) -> Connection:
    import psycopg  # imported lazily so unit tests run without the driver

    conn = psycopg.connect(database_url, application_name="scholarship-worker", connect_timeout=15)
    with conn.cursor() as cur:
        cur.execute("select current_user")
        (role,) = cur.fetchone()
    if role != "discovery_worker":
        conn.close()
        raise RuntimeError(f"connected as {role!r}; the worker must run as discovery_worker")
    return conn


@dataclass
class JobRun:
    """Counters for one job run, written to public.job_runs."""

    name: str
    id: str | None = None
    pages_fetched: int = 0
    llm_calls: int = 0
    errors: int = 0
    error_messages: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def record_error(self, message: str) -> None:
        self.errors += 1
        if len(self.error_messages) < 10:
            self.error_messages.append(redact(message)[:300])


@contextmanager
def job_run(conn: Connection, name: str) -> Iterator[JobRun]:
    """Opens a job_runs row, yields counters, and closes the row as succeeded or failed.

    Each job commits its own work; the job_runs row is committed separately so a
    failed job still leaves a record.
    """
    run = JobRun(name=name)
    with conn.cursor() as cur:
        cur.execute("insert into public.job_runs (job_name) values (%s) returning id", (name,))
        run.id = str(cur.fetchone()[0])
    conn.commit()

    status = "succeeded"
    try:
        yield run
    except Exception as exc:  # recorded, then re-raised so the Action fails visibly
        conn.rollback()
        status = "failed"
        run.record_error(f"{type(exc).__name__}: {exc}")
        raise
    finally:
        if status == "succeeded" and run.errors and not run.details.get("partial_ok", False):
            status = "failed"
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.job_runs
                   set finished_at = now(), status = %s, pages_fetched = %s, llm_calls = %s,
                       errors = %s, error_summary = %s, details = %s::jsonb
                 where id = %s
                """,
                (
                    status,
                    run.pages_fetched,
                    run.llm_calls,
                    run.errors,
                    "\n".join(run.error_messages) or None,
                    json.dumps(run.details, default=str),
                    run.id,
                ),
            )
        conn.commit()
        log.info("job %s finished: %s (errors=%d)", name, status, run.errors)
