"""Runs against the CI test database (after supabase/tests/run_tests.sh), connected
as discovery_worker. Skipped when WORKER_TEST_DATABASE_URL is not set."""

import os
import unittest

URL = os.environ.get("WORKER_TEST_DATABASE_URL")

try:
    import psycopg  # noqa: F401
except ImportError:  # pragma: no cover
    psycopg = None


@unittest.skipUnless(URL and psycopg, "needs WORKER_TEST_DATABASE_URL and psycopg")
class HeartbeatIntegrationTests(unittest.TestCase):
    def test_heartbeat_records_a_job_run(self):
        from scholarship_worker.db import connect
        from scholarship_worker.jobs import heartbeat

        conn = connect(URL)
        try:
            summary = heartbeat.run(conn)
            self.assertGreaterEqual(summary["active_sources"], 0)
            with conn.cursor() as cur:
                cur.execute(
                    "select status from public.job_runs where job_name = 'heartbeat' order by started_at desc limit 1"
                )
                self.assertEqual(cur.fetchone()[0], "succeeded")
        finally:
            conn.close()

    def test_worker_role_cannot_read_student_data(self):
        from scholarship_worker.db import connect

        conn = connect(URL)
        try:
            with conn.cursor() as cur:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    cur.execute("select 1 from public.profiles limit 1")
            conn.rollback()
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
