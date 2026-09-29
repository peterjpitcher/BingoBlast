#!/usr/bin/env bash
#
# Validates the host mutation and grant migrations against a throwaway Postgres
# in Docker. Nothing here touches a real Supabase project.
#
#   bash supabase/tests/run.sh
#
# Needs Docker running and psql on PATH. Exits non-zero if any assertion fails,
# so it is safe to gate a production apply on it.
#
# One container, three databases, because the suites need different worlds:
#
# SUITE A (bingo_test) is the winner-idempotency upgrade path, in order: the
# harness schema has winners WITHOUT client_request_id and two rows already in
# it, then 20260729231945 installs the 7-argument record_winner_atomic, then
# 20260730064309 drops that and installs the 8-argument version. So the run also
# proves the migration lands on a populated table and that no ambiguous overload
# is left behind. Shell-driven concurrency pairs at the end cover what a single
# connection cannot.
#
# SUITE B (bingo_grant_test) is the grant hardening, in phases:
#
#   Phase 1  20260729231945 alone, the 7-argument world. It now carries the anon
#            revoke inline, so the four functions must never be anon-callable
#            even for a moment, and 20260730070705 has nothing left to do.
#
#   Phase 2  PRODUCTION as it was before 20260730070705 ran: 20260729231945 was
#            applied there before the inline revoke existed, so all four carried
#            anon=X/postgres, and record_winner_atomic is the eight-argument
#            version from winner_idempotency_key. grants-drift.sql recreates
#            both, then 20260730070705 repairs them. That is what proves the
#            migration did what it says against the database it actually ran on.
#
# Phase 3 re-applies it to prove it is safe to run twice, and phase 4 checks the
# behaviour rather than the catalogue: the host flow still works as
# authenticated, and anon is refused with 42501 before the function body.
#
# Phase 5 covers the trigger function lockdown_admin_functions_2026_05_27 missed,
# where the assertion that matters is not the grant but that state_version is
# still bumped afterwards. Phase 6 records the gap none of this closes: the
# default privileges are still armed for the next function anyone creates.
#
# SUITE C (bingo_fresh_test) is the fresh-build end state the repo produces NOW
# that winner_idempotency_key is part of its history: 20260730064309 installs the
# 8-argument record_winner_atomic, which picks the default-privilege anon grant
# straight back up, and 20260730070705 takes it off again, exactly as the fresh
# migration order replays what production did.
#
# SUITE D (bingo_replay_test) replays EVERY migration in supabase/migrations, in
# filename order, against a database bootstrapped by supabase-bootstrap.sql to
# look like a fresh Supabase project, applying each one twice as it goes. Suites
# A to C each test a hand-picked handful of migrations, which leaves the failure
# none of them can see: a migration that is correct alone and wrong in sequence,
# or a repo history that no longer rebuilds what production holds.
# replay.test.sql then asserts the end state object by object and grant by grant
# against what production actually carries, and remediation-behaviour.test.sql
# asserts what the functions DO, by acting as a real host against real fixtures.
#
# SUITE E (bingo_replay_current_test) is suite D again, bootstrapped with the
# default privileges a project created TODAY gets instead of the ones production
# was built with. Supabase tightened them: a table a migration creates without
# stating grants is now unreadable by anon, authenticated and service_role
# alike. Suite D alone passed while a rebuilt project served the pub TV 42501 on
# game_states_public. Suite D catches a migration that forgets to revoke; suite E
# catches one that forgets to grant.
set -euo pipefail

CONTAINER=bingo-migration-tests
PORT=55432
IMAGE=postgres:17
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

HOST_MUTATIONS="$MIGRATIONS/20260729231945_atomic_host_mutations.sql"
WINNER_IDEMPOTENCY="$MIGRATIONS/20260730064309_winner_idempotency_key.sql"
REVOKE_ANON="$MIGRATIONS/20260730070705_revoke_anon_execute_on_host_rpcs.sql"
REVOKE_TRIGGER="$MIGRATIONS/20260730072329_revoke_anon_on_bump_game_state_version.sql"

export PGPASSWORD=test
psql() { command psql -h 127.0.0.1 -p "$PORT" -U postgres -q "$@"; }
psql_strict() { psql -v ON_ERROR_STOP=1 "$@"; }

# ---------------------------------------------------------------------------
# Where the throwaway Postgres comes from.
#
# Docker is preferred, because it pins the exact server version. But Docker is
# not available on every machine this repo is worked on, and a test suite nobody
# can run is a test suite that does not exist: this harness sat unexecuted for
# weeks for exactly that reason. So if Docker is missing and a local Postgres 17
# is installed, a temporary cluster is used instead. Same assertions, same
# server version, no daemon.
#
# LC_ALL is pinned on the local path deliberately. Homebrew's postgres refuses to
# start under some macOS locales with "postmaster became multithreaded during
# startup", which is a confusing failure to hand somebody who only wanted to run
# the tests.
# ---------------------------------------------------------------------------
LOCAL_PGDATA=""

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$LOCAL_PGDATA" ]; then
    pg_ctl -D "$LOCAL_PGDATA" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$LOCAL_PGDATA"
  fi
}
trap cleanup EXIT

if docker info >/dev/null 2>&1; then
  echo "==> starting $IMAGE as $CONTAINER on port $PORT"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -p "$PORT:5432" "$IMAGE" >/dev/null
elif command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
  echo "==> Docker unavailable; using a temporary local cluster ($(postgres --version))"
  export LC_ALL=C LANG=C
  LOCAL_PGDATA="$(mktemp -d "${TMPDIR:-/tmp}/bingo-pgdata.XXXXXX")"
  initdb -D "$LOCAL_PGDATA" -U postgres --auth=trust >/dev/null
  pg_ctl -D "$LOCAL_PGDATA" -o "-p $PORT -h 127.0.0.1" -l "$LOCAL_PGDATA/server.log" start >/dev/null
else
  echo "FAILED: needs either Docker, or initdb and pg_ctl on PATH (brew install postgresql@17)" >&2
  exit 1
fi

for _ in $(seq 1 60); do
  if psql -d postgres -c 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
psql -d postgres -c 'select 1' >/dev/null

# ===========================================================================
# SUITE A: winner idempotency (bingo_test)
# ===========================================================================
echo "==> suite A: building the harness schema and fixtures"
psql_strict -d postgres -c 'create database bingo_test;'
psql_strict -d bingo_test -f "$HERE/harness-schema.sql"

echo "==> suite A: applying $(basename "$HOST_MUTATIONS")"
psql_strict -d bingo_test -f "$HOST_MUTATIONS"

echo "==> suite A: applying $(basename "$WINNER_IDEMPOTENCY")"
psql_strict -d bingo_test -f "$WINNER_IDEMPOTENCY"

echo "==> suite A: running assertions"
psql -d bingo_test -f "$HERE/winner-idempotency.test.sql"

FAILED=$(psql -d bingo_test -At -c 'select count(*) from test_results where not ok')
if [ "$FAILED" != "0" ]; then
  echo "FAILED: $FAILED assertion(s) did not pass" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The single-connection assertions cannot cover contention. These two do: the
# same key from two live connections, then two different keys from two live
# connections. The first must leave one row, the second must leave two.
# ---------------------------------------------------------------------------
HOST='11111111-1111-4111-8111-111111111111'
SESS='55555555-5555-4555-8555-555555555555'
GAME='77777777-7777-4777-8777-777777777777'

reset_game() {
  psql -d bingo_test \
    -c "delete from public.winners where game_id = '$GAME';" \
    -c "update public.game_states
           set paused_for_validation = false, display_win_type = null,
               display_win_text = null, controlling_host_id = '$HOST',
               current_stage_index = 0
         where game_id = '$GAME';" >/dev/null
}

# $1 = claim key, $2 = seconds to hold the transaction open before committing.
record_in_tx() {
  psql -d bingo_test -c "
    set test.uid = '$HOST';
    begin;
    select (record_winner_atomic(
      p_session_id => '$SESS', p_game_id => '$GAME', p_stage => 'Line',
      p_prize_description => 'Line prize',
      p_client_request_id => '$1')).state_version;
    select pg_sleep($2);
    commit;" 2>&1
}

concurrent_pair() {  # $1 = key for A, $2 = key for B
  reset_game
  record_in_tx "$1" 2 >/tmp/bingo-tx-a.log 2>&1 &
  local a=$!
  sleep 0.5                       # A now holds the game_states row lock
  record_in_tx "$2" 0 >/tmp/bingo-tx-b.log 2>&1 &
  local b=$!
  wait "$a" "$b"
  if grep -q ERROR /tmp/bingo-tx-a.log /tmp/bingo-tx-b.log; then
    echo "FAILED: a concurrent attempt errored" >&2
    cat /tmp/bingo-tx-a.log /tmp/bingo-tx-b.log >&2
    exit 1
  fi
  psql -d bingo_test -At -c "select count(*) from public.winners where game_id = '$GAME';"
}

echo "==> suite A: concurrent same key (expect 1 winner)"
SAME=$(concurrent_pair 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001' \
                       'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001')
echo "    winners rows: $SAME"

echo "==> suite A: concurrent different keys, same ball (expect 2 winners, a real tie)"
TIE=$(concurrent_pair 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002' \
                      'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003')
echo "    winners rows: $TIE"

if [ "$SAME" != "1" ] || [ "$TIE" != "2" ]; then
  echo "FAILED: concurrency expectations not met (same=$SAME tie=$TIE)" >&2
  exit 1
fi

echo "==> suite A: ALL PASS"

# ===========================================================================
# SUITE B: grant hardening (bingo_grant_test)
# ===========================================================================
echo "==> suite B: building the harness schema, roles and default privileges"
psql_strict -d postgres -c 'create database bingo_grant_test;'
psql_strict -d bingo_grant_test -f "$HERE/harness-schema.sql"

# --- Phase 1: a fresh build from this repo -----------------------------------
echo "==> phase 1: applying $(basename "$HOST_MUTATIONS")"
psql_strict -d bingo_grant_test -f "$HOST_MUTATIONS"

echo "==> phase 1: asserting a fresh build is already hardened"
psql_strict -d bingo_grant_test -v phase='fresh build' -f "$HERE/grants.test.sql"

echo "==> phase 1: applying $(basename "$REVOKE_ANON") (expected to be a no-op here)"
psql_strict -d bingo_grant_test -f "$REVOKE_ANON"

# --- Phase 2: the production-shaped database ---------------------------------
echo "==> phase 2: recreating the production drift (anon grants + 8-arg overload)"
psql_strict -d bingo_grant_test -f "$HERE/grants-drift.sql"

echo "==> phase 2: applying $(basename "$REVOKE_ANON") to repair it"
psql_strict -d bingo_grant_test -f "$REVOKE_ANON"

echo "==> phase 2: asserting the repair"
psql_strict -d bingo_grant_test -v phase='after repair' -f "$HERE/grants.test.sql"

# --- Phase 3: idempotency ----------------------------------------------------
echo "==> phase 3: applying $(basename "$REVOKE_ANON") a second time"
psql_strict -d bingo_grant_test -f "$REVOKE_ANON"
psql_strict -d bingo_grant_test -v phase='after second apply' -f "$HERE/grants.test.sql"

# --- Phase 4: behaviour, not catalogue ---------------------------------------
echo "==> phase 4: host flow as authenticated, refusal as anon"
psql_strict -d bingo_grant_test -f "$HERE/host-flow.test.sql"

# --- Phase 5: the trigger function lockdown_admin_functions missed ------------
echo "==> phase 5: recreating the production ACL on bump_game_state_version"
psql_strict -d bingo_grant_test -f "$HERE/trigger-grant-drift.sql"

echo "==> phase 5: applying $(basename "$REVOKE_TRIGGER")"
psql_strict -d bingo_grant_test -f "$REVOKE_TRIGGER"

echo "==> phase 5: asserting the revoke, and that the trigger still fires"
psql_strict -d bingo_grant_test -f "$HERE/trigger-grant.test.sql"

# --- Phase 6: the gap that is still open -------------------------------------
echo "==> phase 6: recording the default-privilege gap none of this closes"
psql_strict -d bingo_grant_test -f "$HERE/convention-gap.test.sql"

# ===========================================================================
# SUITE C: the fresh-build end state this repo now produces (bingo_fresh_test)
# ===========================================================================
echo "==> suite C: building the harness schema, roles and default privileges"
psql_strict -d postgres -c 'create database bingo_fresh_test;'
psql_strict -d bingo_fresh_test -f "$HERE/harness-schema.sql"

echo "==> suite C: applying $(basename "$HOST_MUTATIONS"), $(basename "$WINNER_IDEMPOTENCY"), $(basename "$REVOKE_ANON") in repo order"
psql_strict -d bingo_fresh_test -f "$HOST_MUTATIONS"
psql_strict -d bingo_fresh_test -f "$WINNER_IDEMPOTENCY"
psql_strict -d bingo_fresh_test -f "$REVOKE_ANON"

echo "==> suite C: asserting the fresh end state is hardened"
psql_strict -d bingo_fresh_test -v phase='fresh end state' -f "$HERE/grants.test.sql"

# ===========================================================================
# SUITE D: full replay of EVERY migration from empty (bingo_replay_test)
# ===========================================================================
# Suites A to C each apply a hand-picked handful of migrations. That leaves the
# one failure they cannot see: a migration that is correct on its own and wrong
# in sequence, or a repo whose history no longer rebuilds what production holds.
# This suite replays all of supabase/migrations in filename order against a
# database bootstrapped to look like a fresh Supabase project, then asserts the
# end state against what production actually carries.
#
# It is also the check that makes a NEW migration safe to write: if the replay
# stops passing, the repo can no longer rebuild itself, whatever `db push` says.
# $1 = suite label, $2 = database, $3 = current_defaults (off = production's
# default privileges, on = the current Supabase image's).
replay_suite() {
local suite="$1" db="$2" current_defaults="$3"

echo "==> suite $suite: bootstrapping an empty database (current_defaults=$current_defaults)"
psql_strict -d postgres -c "create database $db;"
psql_strict -d "$db" -v current_defaults="$current_defaults" -f "$HERE/supabase-bootstrap.sql"

# Each migration is applied, then applied AGAIN immediately, before moving on.
#
# That is the idempotency property worth having: `db push` against a repaired
# history can re-offer a single migration, so each one must survive being run
# twice. Re-running the WHOLE history a second time is a stronger property and
# not an achievable one: a later migration that legitimately changes a
# function's return type (20260825080604 does, from void to a row type) makes an
# earlier `create or replace` of the same function fail with "cannot change
# return type of existing function". Testing per migration catches real
# non-idempotency without demanding something no real deployment ever does.
# --single-transaction is not a detail, it is the point. `supabase db push`
# wraps each migration file in a transaction, and psql WITHOUT that flag runs a
# file statement by statement in autocommit. The difference is not cosmetic:
# Postgres refuses to USE a new enum value in the same transaction that adds it,
# so a migration that does both passes here in autocommit and is rejected by
# production with SQLSTATE 55P04. That happened on 2026-08-25. Replaying the way
# production applies is the only way this suite can speak for production.
MIGRATION_COUNT=0
for f in "$MIGRATIONS"/*.sql; do
  MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
  echo "==> suite $suite: [$MIGRATION_COUNT] $(basename "$f")"
  psql_strict --single-transaction -d "$db" -f "$f" >/dev/null
  psql_strict --single-transaction -d "$db" -f "$f" >/dev/null   # twice, deliberately
done
echo "==> suite $suite: replayed $MIGRATION_COUNT migrations, each applied twice"

echo "==> suite $suite: asserting the replayed end state"
psql_strict -d "$db" -v current_defaults="$current_defaults" -f "$HERE/replay.test.sql" >/dev/null

# The catalogue is not the behaviour. replay.test.sql proves the objects and
# grants exist; this proves the functions actually do what the remediation
# claims, by creating a staff account, a session, a game and a pot and acting as
# that host. A catalogue assertion cannot tell you that a retried call draws a
# second ball; only calling it twice can.
echo "==> suite $suite: behavioural assertions against the replayed schema"
psql_strict -d "$db" -f "$HERE/remediation-behaviour.test.sql" >/dev/null
}

replay_suite D bingo_replay_test off

# ===========================================================================
# SUITE E: the same replay under the current Supabase default privileges
# ===========================================================================
replay_suite E bingo_replay_current_test on

# --- Results -----------------------------------------------------------------
echo
psql -d bingo_grant_test -c \
  "select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
     from test_results order by seq;"
psql -d bingo_fresh_test -c \
  "select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
     from test_results order by seq;"
psql -d bingo_replay_test -c \
  "select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
     from test_results order by seq;"
psql -d bingo_replay_current_test -c \
  "select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
     from test_results order by seq;"

FAILED_B=$(psql -d bingo_grant_test -At -c 'select count(*) from test_results where not ok')
TOTAL_B=$(psql -d bingo_grant_test -At -c 'select count(*) from test_results')
FAILED_C=$(psql -d bingo_fresh_test -At -c 'select count(*) from test_results where not ok')
TOTAL_C=$(psql -d bingo_fresh_test -At -c 'select count(*) from test_results')
FAILED_D=$(psql -d bingo_replay_test -At -c 'select count(*) from test_results where not ok')
TOTAL_D=$(psql -d bingo_replay_test -At -c 'select count(*) from test_results')
FAILED_E=$(psql -d bingo_replay_current_test -At -c 'select count(*) from test_results where not ok')
TOTAL_E=$(psql -d bingo_replay_current_test -At -c 'select count(*) from test_results')

if [ "$FAILED_B" != "0" ] || [ "$FAILED_C" != "0" ] || [ "$FAILED_D" != "0" ] || [ "$FAILED_E" != "0" ]; then
  echo "FAILED: $((FAILED_B + FAILED_C + FAILED_D + FAILED_E)) of $((TOTAL_B + TOTAL_C + TOTAL_D + TOTAL_E)) assertion(s) did not pass" >&2
  exit 1
fi

echo
echo "ALL PASS (suite A, plus $((TOTAL_B + TOTAL_C)) grant assertions, plus $TOTAL_D + $TOTAL_E replay assertions over $MIGRATION_COUNT migrations under production and current Supabase defaults)"
