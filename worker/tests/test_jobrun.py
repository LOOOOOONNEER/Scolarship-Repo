import unittest

from scholarship_worker.db import job_run


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.conn.statements.append((" ".join(sql.split()), params))

    def fetchone(self):
        return ("11111111-1111-1111-1111-111111111111",)


class FakeConnection:
    def __init__(self):
        self.statements = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        pass

    def final_update(self):
        sql, params = self.statements[-1]
        assert sql.startswith("update public.job_runs"), sql
        return params


class JobRunTests(unittest.TestCase):
    def test_success_is_recorded(self):
        conn = FakeConnection()
        with job_run(conn, "test") as run:
            run.pages_fetched = 3
        params = conn.final_update()
        self.assertEqual(params[0], "succeeded")
        self.assertEqual(params[1], 3)
        self.assertEqual(conn.statements[0][1], ("test",))

    def test_exception_is_recorded_and_reraised(self):
        conn = FakeConnection()
        with self.assertRaises(RuntimeError):
            with job_run(conn, "test"):
                raise RuntimeError("source returned password=hunter2")
        params = conn.final_update()
        self.assertEqual(params[0], "failed")
        self.assertEqual(conn.rollbacks, 1)
        self.assertNotIn("hunter2", params[4])

    def test_recorded_errors_mark_the_run_failed(self):
        conn = FakeConnection()
        with job_run(conn, "test") as run:
            run.record_error("timeout fetching a page")
        self.assertEqual(conn.final_update()[0], "failed")

    def test_partial_success_can_be_allowed(self):
        conn = FakeConnection()
        with job_run(conn, "test") as run:
            run.details["partial_ok"] = True
            run.record_error("one source timed out")
        params = conn.final_update()
        self.assertEqual(params[0], "succeeded")
        self.assertEqual(params[3], 1)


if __name__ == "__main__":
    unittest.main()
