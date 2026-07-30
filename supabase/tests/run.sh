#!/usr/bin/env bash
#
# Validates the host RPC grant migrations against a throwaway Postgres in Docker.
# Nothing here touches a real Supabase project.
#
#   bash supabase/tests/run.sh
#
# Needs Docker running and psql on PATH. Exits non-zero if any assertion fails,
# so it is safe to gate a production apply on it.
#
# The order below is not a shortcut, it is the two real worlds this change has to
# be correct in at once:
#
#   Phase 1  a FRESH database built from this repo. 20260729120000 now carries
#            the anon revoke inline, so the four functions must never be
#            anon-callable even for a moment, and 20260730070705 has nothing left
#            to do.
#
#   Phase 2  PRODUCTION as it was before 20260730070705 ran: 20260729120000 was
#            applied there before the inline revoke existed, so all four carried
#            anon=X/postgres, and record_winner_atomic has an eighth argument
#            from winner_idempotency_key that this repo's history does not build.
#            grants-drift.sql recreates both, then 20260730070705 repairs them.
#            That is what proves the migration did what it says against the
#            database it actually ran on.
#
# Phase 3 re-applies it to prove it is safe to run twice, phase 4 checks the
# behaviour rather than the catalogue (host flow still works as authenticated,
# anon is refused with 42501 before the function body), and phase 5 records the
# gap none of this closes: the default privileges are still armed for the next
# function anyone creates.
set -euo pipefail

CONTAINER=bingo-grant-tests
PORT=55433
IMAGE=postgres:17
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

HOST_MUTATIONS="$MIGRATIONS/20260729120000_atomic_host_mutations.sql"
REVOKE_ANON="$MIGRATIONS/20260730070705_revoke_anon_execute_on_host_rpcs.sql"

export PGPASSWORD=test
psql() { command psql -h localhost -p "$PORT" -U postgres -q "$@"; }
psql_strict() { psql -v ON_ERROR_STOP=1 "$@"; }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }

echo "==> starting $IMAGE as $CONTAINER on port $PORT"
cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -p "$PORT:5432" "$IMAGE" >/dev/null
trap cleanup EXIT

for _ in $(seq 1 60); do
  if psql -d postgres -c 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
psql -d postgres -c 'select 1' >/dev/null

echo "==> building the harness schema, roles and default privileges"
psql_strict -d postgres -c 'create database bingo_test;'
psql_strict -d bingo_test -f "$HERE/harness-schema.sql"

# --- Phase 1: a fresh build from this repo -----------------------------------
echo "==> phase 1: applying $(basename "$HOST_MUTATIONS")"
psql_strict -d bingo_test -f "$HOST_MUTATIONS"

echo "==> phase 1: asserting a fresh build is already hardened"
psql_strict -d bingo_test -v phase='fresh build' -f "$HERE/grants.test.sql"

echo "==> phase 1: applying $(basename "$REVOKE_ANON") (expected to be a no-op here)"
psql_strict -d bingo_test -f "$REVOKE_ANON"

# --- Phase 2: the production-shaped database ---------------------------------
echo "==> phase 2: recreating the production drift (anon grants + 8-arg overload)"
psql_strict -d bingo_test -f "$HERE/grants-drift.sql"

echo "==> phase 2: applying $(basename "$REVOKE_ANON") to repair it"
psql_strict -d bingo_test -f "$REVOKE_ANON"

echo "==> phase 2: asserting the repair"
psql_strict -d bingo_test -v phase='after repair' -f "$HERE/grants.test.sql"

# --- Phase 3: idempotency ----------------------------------------------------
echo "==> phase 3: applying $(basename "$REVOKE_ANON") a second time"
psql_strict -d bingo_test -f "$REVOKE_ANON"
psql_strict -d bingo_test -v phase='after second apply' -f "$HERE/grants.test.sql"

# --- Phase 4: behaviour, not catalogue ---------------------------------------
echo "==> phase 4: host flow as authenticated, refusal as anon"
psql_strict -d bingo_test -f "$HERE/host-flow.test.sql"

# --- Phase 5: the gap that is still open -------------------------------------
echo "==> phase 5: recording the default-privilege gap none of this closes"
psql_strict -d bingo_test -f "$HERE/convention-gap.test.sql"

# --- Results -----------------------------------------------------------------
echo
psql -d bingo_test -c \
  "select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
     from test_results order by seq;"

FAILED=$(psql -d bingo_test -At -c 'select count(*) from test_results where not ok')
TOTAL=$(psql -d bingo_test -At -c 'select count(*) from test_results')

if [ "$FAILED" != "0" ]; then
  echo "FAILED: $FAILED of $TOTAL assertion(s) did not pass" >&2
  exit 1
fi

echo
echo "ALL PASS ($TOTAL assertions)"
