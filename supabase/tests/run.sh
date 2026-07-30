#!/usr/bin/env bash
#
# Validates the host mutation migrations against a throwaway Postgres in Docker.
# Nothing here touches a real Supabase project.
#
#   bash supabase/tests/run.sh
#
# Needs Docker running and psql on PATH. Exits non-zero if any assertion fails,
# so it is safe to gate a production apply on it.
#
# The order below is the real upgrade path, not a shortcut: the harness schema has
# winners WITHOUT client_request_id and two rows already in it, then
# 20260729120000 installs the 7-argument record_winner_atomic, then
# 20260730120000 drops that and installs the 8-argument version. So the run also
# proves the migration lands on a populated table and that no ambiguous overload
# is left behind.
set -euo pipefail

CONTAINER=bingo-migration-tests
PORT=55432
IMAGE=postgres:17
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

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

echo "==> building the harness schema and fixtures"
psql_strict -d postgres -c 'create database bingo_test;'
psql_strict -d bingo_test -f "$HERE/harness-schema.sql"

echo "==> applying 20260729120000_atomic_host_mutations.sql"
psql_strict -d bingo_test -f "$MIGRATIONS/20260729120000_atomic_host_mutations.sql"

echo "==> applying 20260730120000_winner_idempotency_key.sql"
psql_strict -d bingo_test -f "$MIGRATIONS/20260730120000_winner_idempotency_key.sql"

echo "==> running assertions"
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

echo "==> concurrent same key (expect 1 winner)"
SAME=$(concurrent_pair 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001' \
                       'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001')
echo "    winners rows: $SAME"

echo "==> concurrent different keys, same ball (expect 2 winners, a real tie)"
TIE=$(concurrent_pair 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002' \
                      'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003')
echo "    winners rows: $TIE"

if [ "$SAME" != "1" ] || [ "$TIE" != "2" ]; then
  echo "FAILED: concurrency expectations not met (same=$SAME tie=$TIE)" >&2
  exit 1
fi

echo
echo "ALL PASS"
