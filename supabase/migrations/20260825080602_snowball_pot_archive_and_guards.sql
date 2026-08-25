-- Makes retiring a snowball pot non-destructive, and puts the two guards the
-- money table was missing into the database rather than into a form.
--
-- WHY: DELETING A POT DESTROYED ITS ENTIRE AUDIT TRAIL
--   deleteSnowballPot did three separate, non-transactional statements:
--     1. update games set snowball_pot_id = null where snowball_pot_id = $1
--     2. delete from snowball_pot_history where snowball_pot_id = $1
--     3. delete from snowball_pots where id = $1
--   Step 1 committed on its own, so every historical game silently stopped being
--   a snowball game and the host screen started saying "this game is not linked
--   to a snowball pot" about games that had been played for a jackpot. Step 2
--   destroyed the only record of how the pot ever reached its figure, and it had
--   no DELETE policy so it matched zero rows and reported no error, after which
--   step 3 failed on the foreign key. Net result: the links were gone for good
--   and the pot was still there.
--
--   Money history is not something to delete. A retired pot is archived.
--
-- WHY: THE TWO MISSING CONSTRAINTS
--   * A pot's max_calls was unbounded. Nothing stopped an admin typing 900, and
--     a 90-ball game can never call more than 90, so every Full House would have
--     won the jackpot. That is a cash error caused by a typo with no guard.
--   * games.game_index had no uniqueness per session. Two games sharing an index
--     make the host's first-game and last-game detection ambiguous, which
--     decides whether the pre-game briefing shows and whether ending the game
--     ends the session.
--
-- PREFLIGHT, run read-only against production on 2026-08-25, both clean:
--   select count(*) from (select session_id, game_index from games
--                          group by 1,2 having count(*) > 1) x;              -- 0
--   select count(*) from snowball_pots
--    where current_max_calls > 90 or base_max_calls > 90;                    -- 0
--   So neither constraint needs a backfill and neither can fail on apply.
--
-- ROLLBACK
--   drop function public.archive_snowball_pot(uuid);
--   alter table public.snowball_pots drop column archived_at;
--   alter table public.snowball_pots drop constraint snowball_pots_max_calls_within_90;
--   alter table public.games drop constraint games_session_game_index_unique;
--   The old delete path is not restored, deliberately.

-- ---------------------------------------------------------------------------
-- Archive instead of delete
-- ---------------------------------------------------------------------------
alter table public.snowball_pots
  add column if not exists archived_at timestamptz;

comment on column public.snowball_pots.archived_at is
  'Set when a pot is retired. Archived pots are hidden from the admin list and cannot be linked to a new game, but their history and their links from played games are kept. Pots are never deleted: their history is the audit trail for real cash.';

create or replace function public.archive_snowball_pot(p_pot_id uuid)
returns public.snowball_pots
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pot public.snowball_pots;
  v_live_games int;
begin
  perform public.assert_is_admin();

  select * into v_pot
    from public.snowball_pots
   where id = p_pot_id
   for update;

  if v_pot.id is null then
    raise exception 'pot_not_found';
  end if;

  if v_pot.archived_at is not null then
    -- Already archived. Idempotent on purpose: a retry of a request that lost
    -- its response must not look like a failure.
    return v_pot;
  end if;

  -- A pot in play cannot be retired. Checked under the lock so a game cannot
  -- start between the check and the write.
  select count(*) into v_live_games
    from public.games g
    join public.game_states gs on gs.game_id = g.id
   where g.snowball_pot_id = p_pot_id
     and gs.status <> 'completed'::public.game_status;

  if v_live_games > 0 then
    raise exception 'pot_in_use';
  end if;

  update public.snowball_pots
     set archived_at = now()
   where id = p_pot_id
  returning * into v_pot;

  return v_pot;
end;
$function$;

-- Both revokes. CREATE FUNCTION grants EXECUTE to PUBLIC by itself, and the
-- schema default privileges grant it to anon in its own name, so neither revoke
-- covers the other. See 20260730070705_revoke_anon_execute_on_host_rpcs.sql.
revoke all on function public.archive_snowball_pot(uuid) from public;
revoke all on function public.archive_snowball_pot(uuid) from anon;
grant execute on function public.archive_snowball_pot(uuid) to authenticated, service_role;

comment on function public.archive_snowball_pot(uuid) is
  'Retires a pot without destroying anything. Admin only, refuses while any game on the pot is not completed, idempotent on a second call.';

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'snowball_pots_max_calls_within_90'
  ) then
    alter table public.snowball_pots
      add constraint snowball_pots_max_calls_within_90
      check (
        base_max_calls between 1 and 90
        and current_max_calls between 1 and 90
        and calls_increment >= 0
        and base_jackpot_amount >= 0
        and current_jackpot_amount >= 0
        and jackpot_increment >= 0
      );
  end if;
end
$$;

comment on constraint snowball_pots_max_calls_within_90 on public.snowball_pots is
  'A 90-ball game can never call more than 90 numbers, so a window wider than that would make every Full House a jackpot win. Amounts cannot be negative.';

create unique index if not exists games_session_game_index_unique
  on public.games (session_id, game_index);

comment on index public.games_session_game_index_unique is
  'Two games sharing a game_index in one session make the host screen ambiguous about which game is first and which is last, which decides whether the briefing shows and whether ending the game ends the session.';
