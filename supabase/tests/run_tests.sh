#!/usr/bin/env bash
# Applies every migration to a fresh database and runs the access-control tests.
#
# Uses the standard libpq environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# The connecting user must be a superuser on a throwaway Postgres 15+ server,
# never a real Supabase project.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
db="${TEST_DB:-scholarship_finder_test}"
worker_pw="${TEST_WORKER_PASSWORD:-local-test-only}"
psql_opts=(-X -q -v ON_ERROR_STOP=1)

echo "== fresh database: $db"
psql "${psql_opts[@]}" -d postgres -c "drop database if exists $db" -c "create database $db"

echo "== supabase shim"
psql "${psql_opts[@]}" -d "$db" -f "$here/shim/supabase_shim.sql"

echo "== migrations"
for f in "$here"/../migrations/*.sql; do
  echo "   $(basename "$f")"
  psql "${psql_opts[@]}" -d "$db" -f "$f"
done
psql "${psql_opts[@]}" -d "$db" -c "alter role discovery_worker password '$worker_pw'"

run() {
  echo "== $(basename "$1")"
  psql "${psql_opts[@]}" -d "$db" -f "$1" 2>&1 | sed -n -e 's/^.*NOTICE:  /   /p' -e '/ERROR/p'
  test "${PIPESTATUS[0]}" -eq 0
}

run "$here/sql/00_helpers.sql"
run "$here/sql/10_fixtures.sql"
run "$here/sql/20_anon_and_students.sql"
run "$here/sql/30_admin.sql"

echo "== 40_worker.sql (connected as discovery_worker)"
PGUSER=discovery_worker PGPASSWORD="$worker_pw" \
  psql "${psql_opts[@]}" -d "$db" -f "$here/sql/40_worker.sql" 2>&1 | sed -n -e 's/^.*NOTICE:  /   /p' -e '/ERROR/p'
test "${PIPESTATUS[0]}" -eq 0

echo "== all database tests passed"
