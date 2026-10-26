"""End-to-end discovery run against the test database, connected as discovery_worker,
with a local web server standing in for a provider's site and a fake AI extractor.

Runs in CI (psycopg + WORKER_TEST_DATABASE_URL) and locally through tests/pgshim.py
(PSQL_TEST_DB). Requires supabase/tests/run_tests.sh to have created the database.
WORKER_TEST_ADMIN_DATABASE_URL / PSQL_TEST_ADMIN_USER (a superuser) is used only
to set up a student submission and to clean up.
"""

import os
import threading
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scholarship_worker.db import job_run
from scholarship_worker.fetch import PoliteFetcher
from scholarship_worker.pipeline import DiscoveryPipeline, PipelineConfig
from scholarship_worker.repository import Repository

PAGE = """<html><head><title>Test Scholarship 2027</title></head><body><main>
<h1>Riverbend Pipeline Grant</h1>
<p>Academic Year 2027-2028</p>
<p>Applications are open from November 1, 2026 to November 30, 2026.</p>
<p>Qualifications: Bona fide resident of Tarlac. General weighted average of 2.00 or better.</p>
<p><a href="/apply">Apply here</a> and read the <a href="/scholarship-guidelines">scholarship guidelines</a>.</p>
</main></body></html>"""
GUIDELINES = "<html><body><p>Guidelines for the scholarship: bring your report card when you apply.</p></body></html>"
NEWS = "<html><body><p>Road repairs on MacArthur Highway this week.</p></body></html>"


class Site(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/scholarships" and self.headers.get("If-None-Match") == '"p1"':
            self.send_response(304)
            self.end_headers()
            return
        body = {"/robots.txt": "User-agent: *\nDisallow: /blocked\n", "/scholarships": PAGE,
                "/scholarship-guidelines": GUIDELINES, "/news": NEWS}.get(path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain" if path == "/robots.txt" else "text/html")
        if path == "/scholarships":
            self.send_header("ETag", '"p1"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class FakeExtractor:
    model = "fake-extractor"

    def __init__(self, base):
        self.base = base
        self.calls = 0

    def extract(self, text, *, source_url, title, links):
        self.calls += 1
        if "Riverbend Pipeline Grant" not in text:
            return {"is_announcement": False, "offerings": []}
        rng = "Applications are open from November 1, 2026 to November 30, 2026."
        return {"is_announcement": True, "offerings": [{
            "program_name": {"value": "Riverbend Pipeline Grant", "evidence": "Riverbend Pipeline Grant"},
            "provider_name": {"value": None, "evidence": None},
            "academic_year": {"value": "2027-2028", "evidence": "Academic Year 2027-2028"},
            "opens_on": {"value": "2026-11-01", "evidence": rng},
            "closes_on": {"value": "2026-11-30", "evidence": rng},
            "apply_url": {"value": self.base + "/apply", "evidence": "Apply here"},
            "eligibility": [
                {"text": "Resident of Tarlac", "kind": "criterion", "evidence": "Bona fide resident of Tarlac."},
                {"text": "GWA 2.00 or better", "kind": "criterion", "evidence": "General weighted average of 2.00 or better."},
            ],
        }]}


def connect_worker():
    url = os.environ.get("WORKER_TEST_DATABASE_URL")
    if url:
        try:
            from scholarship_worker.db import connect
            return connect(url)
        except ImportError:
            pass
    db = os.environ.get("PSQL_TEST_DB")
    if db:
        from tests.pgshim import Connection
        return Connection(db, "discovery_worker", os.environ.get("PSQL_TEST_WORKER_PASSWORD", "local-test-only"))
    return None


def connect_admin():
    url = os.environ.get("WORKER_TEST_ADMIN_DATABASE_URL")
    if url:
        import psycopg
        return psycopg.connect(url, autocommit=True)
    db = os.environ.get("PSQL_TEST_DB")
    if db:
        from tests.pgshim import Connection
        return Connection(db, os.environ.get("PSQL_TEST_ADMIN_USER", "postgres"))
    return None


def q(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


@unittest.skipUnless(os.environ.get("WORKER_TEST_DATABASE_URL") or os.environ.get("PSQL_TEST_DB"), "needs a test database")
class PipelineEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Site)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.conn = connect_worker()
        cls.admin = connect_admin()
        cls.run_id = uuid.uuid4().hex[:8]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        if cls.admin is not None:
            q(cls.admin, "delete from public.fetch_queue where url like %s", (cls.base + "%",))
            q(cls.admin, "delete from public.raw_documents where url like %s", (cls.base + "%",))
            q(cls.admin, "delete from public.source_suggestions where url like %s", (cls.base + "%",))
            q(cls.admin, "delete from public.sources where url like %s", (cls.base + "%",))
        cls.conn.close()

    def make_pipeline(self, extractor):
        fetcher = PoliteFetcher(user_agent="ScholarshipFinderBot/test", per_host_delay_s=1, allow_private=True,
                                sleep=lambda s: None)
        return DiscoveryPipeline(Repository(self.conn), fetcher, extractor, PipelineConfig(batch_size=20))

    def test_full_run(self):
        conn = self.conn
        q(conn, "insert into public.sources (url, tier, region_code) values (%s, 1, 'R3'), (%s, 1, 'R3')",
          (self.base + "/scholarships", self.base + "/news"))

        # A student submits a link to a page the bot is not allowed to read.
        if self.admin is not None:
            q(self.admin, "insert into public.submissions (url, note) values (%s, %s)",
              (self.base + "/blocked", "e2e " + self.run_id))

        extractor = FakeExtractor(self.base)
        pipeline = self.make_pipeline(extractor)
        with job_run(conn, "discover-test") as job:
            job.details["partial_ok"] = True
            summary = pipeline.run(job)

        outcomes = summary["outcomes"]
        self.assertEqual(outcomes.get("candidates"), 1, summary)
        self.assertGreaterEqual(outcomes.get("filtered_out", 0), 1, summary)  # the news page never reaches the AI
        self.assertEqual(extractor.calls, 2, "scholarship page and the followed guidelines link only")

        [(cand_id, status, conf, suggested)] = q(conn, """
            select c.id, c.status, c.confidence, c.suggested_status from public.extracted_candidates c
              join public.raw_documents d on d.id = c.raw_document_id where d.url = %s""", (self.base + "/scholarships",))
        self.assertIn(status, ("pending", "needs_review"))
        self.assertIsNotNone(suggested)
        evidence = q(conn, "select field_name, validation_result from public.field_evidence where candidate_id = %s", (cand_id,))
        results = dict(evidence)
        self.assertEqual(results["closes_on"], "pass")
        self.assertEqual(results["opens_on"], "pass")
        tasks = q(conn, "select kind, summary from public.review_tasks where ref_id = %s and status = 'open'", (cand_id,))
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0][0], "new_offering")
        self.assertIn("Riverbend Pipeline Grant", tasks[0][1])

        [(last_success, failures)] = q(conn, "select last_success_at, consecutive_failures from public.sources where url = %s",
                                       (self.base + "/scholarships",))
        self.assertIsNotNone(last_success)
        self.assertEqual(int(failures), 0)

        [(llm_calls, pages)] = q(conn, "select llm_calls, pages_fetched from public.job_runs where job_name = 'discover-test' order by started_at desc limit 1")
        self.assertEqual(int(llm_calls), 2)
        self.assertGreaterEqual(int(pages), 3)

        if self.admin is not None:
            [(sub_status,)] = q(self.admin, "select status from public.submissions where note = %s", ("e2e " + self.run_id,))
            self.assertEqual(sub_status, "processed")
            self.assertTrue(q(conn, "select 1 from public.review_tasks where kind = 'submission' and summary like %s",
                              ("%robots_disallowed%",)))

        # Second run: the page answers 304 Not Modified, so nothing new is created.
        q(conn, "insert into public.fetch_queue (url, source_id) select url, id from public.sources where url = %s",
          (self.base + "/scholarships",))
        with job_run(conn, "discover-test") as job:
            job.details["partial_ok"] = True
            summary2 = self.make_pipeline(extractor).run(job)
        self.assertEqual(summary2["outcomes"].get("unchanged"), 1, summary2)
        self.assertEqual(extractor.calls, 2)
        self.assertEqual(len(q(conn, """select 1 from public.extracted_candidates c join public.raw_documents d
                                       on d.id = c.raw_document_id where d.url = %s""", (self.base + "/scholarships",))), 1)

    def test_no_ai_key_leaves_work_for_later(self):
        conn = self.conn
        url = self.base + "/scholarships?nokey=" + self.run_id
        q(conn, "insert into public.fetch_queue (url) values (%s)", (url,))
        with job_run(conn, "discover-test") as job:
            job.details["partial_ok"] = True
            summary = self.make_pipeline(None).run(job)
        self.assertEqual(summary["outcomes"].get("skipped_quota"), 1, summary)
        [(status,)] = q(conn, "select status from public.fetch_queue where url = %s", (url,))
        self.assertEqual(status, "queued")


if __name__ == "__main__":
    unittest.main()
