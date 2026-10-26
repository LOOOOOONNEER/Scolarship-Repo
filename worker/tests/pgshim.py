"""TEST-ONLY database adapter that runs SQL through the psql command line.

Used when psycopg is not installed (it is in CI). It interpolates parameters as
SQL literals, has no transactions, and returns every value as text, so it is
good enough to exercise the worker's real SQL against a real database, and
nothing more. Never use it outside tests.
"""

from __future__ import annotations

import csv
import io
import os
import subprocess
from datetime import date, datetime

NULL = "__NULL__"


class ShimError(Exception):
    pass


def literal(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (datetime, date)):
        v = v.isoformat()
    if isinstance(v, (list, tuple)):
        return "ARRAY[" + ",".join(literal(x) for x in v) + "]::text[]"
    return "'" + str(v).replace("'", "''") + "'"


class Cursor:
    def __init__(self, conn: "Connection"):
        self.conn = conn
        self.description = None
        self._rows: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params: tuple = ()):
        parts = sql.split("%s")
        if len(parts) - 1 != len(params):
            raise ShimError(f"expected {len(parts) - 1} parameters, got {len(params)}")
        text = parts[0] + "".join(literal(p) + rest for p, rest in zip(params, parts[1:]))
        proc = subprocess.run(
            ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-P", f"null={NULL}", "-d", self.conn.dbname, "-c", text],
            capture_output=True, text=True, env=self.conn.env,
        )
        if proc.returncode != 0:
            raise ShimError(proc.stderr.strip())
        out = proc.stdout
        if not out.strip():
            self.description, self._rows = None, []
            return
        reader = list(csv.reader(io.StringIO(out)))
        header, body = reader[0], reader[1:]
        self.description = [(name,) for name in header]
        self._rows = [tuple(None if c == NULL else c for c in row) for row in body]

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class Connection:
    def __init__(self, dbname: str, user: str, password: str | None = None):
        self.dbname = dbname
        self.env = {**os.environ, "PGUSER": user}
        if password:
            self.env["PGPASSWORD"] = password

    def cursor(self):
        return Cursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass
