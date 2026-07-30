-- Migration: atomic snowball pot settlement, callable by a host.
--
-- Why this exists. Two separate problems, one fix.
--
--   1. A host-role account could not settle the pot at all. snowball_pots UPDATE
--      is admin-only ("Admins can update pots", for all) and
--      snowball_pot_history INSERT is admin-only ("Admins insert history"), so
--      handleSnowballPotUpdate in src/app/host/actions.ts ended a snowball game
--      with an RLS-filtered update that matched no rows. The action even carries
--      a bespoke message for it: "The signed-in account probably lacks admin
--      rights on snowball_pots."
--
--      The tempting fix is to widen those two policies to admin-or-host. That
--      grants far more than it needs to, because RLS grants row access and not
--      column or value access: a host could then write ANY value to
--      snowball_pots by hand-crafted API call, and insert arbitrary
--      snowball_pot_history rows, including pre-claiming a
--      (snowball_pot_id, game_id) pair to freeze a pot's settlement for good.
--
--   2. handleSnowballPotUpdate wrote the claim row and then updated the pot as
--      two separate round trips with no transaction. If the claim landed and the
--      pot update then failed, the claim blocked any retry and the pot had to be
--      corrected by hand on /admin/snowball. That residual risk was documented
--      in the function's own doc comment and is now gone.
--
-- Both close with one security definer function. RLS on snowball_pots and
-- snowball_pot_history stays exactly as it is, admin-only, and the host reaches
-- the pot only through this narrow door, which derives every written value
-- server-side from the pot row itself. The host supplies a game id and nothing
-- else. There is no value a host can name.
--
-- Conventions follow 20260729120000_atomic_host_mutations.sql: plpgsql, security
-- definer, set search_path = public, row lock via "for update", revoke all from
-- public then grant execute to authenticated and service_role. The function is
-- owned by postgres, which owns both tables and does not have
-- FORCE ROW LEVEL SECURITY set on them, so the definer context is what lets the
-- privileged insert and update through the admin-only policies.
--
-- IMPORTANT for callers: this goes through assert_is_host(), which reads
-- auth.uid(). It must be invoked with the cookie-based Supabase client (the
-- authenticated role), never the service-role client, because auth.uid() is null
-- under service_role and the call would be rejected. auth.uid() is also written
-- to snowball_pot_history.changed_by, so a service-role call would lose the
-- audit attribution as well.
--
-- Outcomes are returned, not raised, because none of them is an error the host
-- needs to see. 'already_settled' and 'not_snowball' both mean the pot is
-- correct. Only a genuinely broken state raises: game_not_found,
-- snowball_pot_not_found, and 'unauthorized: ...' from assert_is_host. Those
-- strings are a contract with src/app/host/actions.ts.
--
-- Notes on the data model, verified against production:
--   * games.type is the game_type enum (standard, snowball, jackpot). Only
--     'snowball' settles a pot, which mirrors the TypeScript this replaces.
--     'jackpot' games are deliberately untouched.
--   * winners.is_void and winners.is_snowball_jackpot are both nullable, so they
--     are coalesced. A voided jackpot winner must NOT reset the pot: that is a
--     money bug, and coalesce(is_void, false) = false is the SQL form of the
--     .not('is_void', 'is', true) filter it replaces.
--   * sessions.is_test_session is nullable. A test session settles nothing, so
--     practice games cannot move real money.
--   * snowball_pot_history.game_id plus the partial unique index
--     snowball_pot_history_pot_game_unique is still the once-per-game guard. The
--     claim is inserted BEFORE the pot moves, exactly as before, so a re-opened
--     and re-ended game cannot invent cash.
--
-- Deliberately NOT added: a game status gate. Settlement is driven by the end-game
-- path in src/app/host/actions.ts and the once-per-game claim is the real guard.
-- Gating on status here would change when a pot settles, which is out of scope.

create or replace function public.settle_snowball_pot(p_game_id uuid)
returns table (
  outcome text,
  settlement text,
  pot_id uuid,
  new_max_calls int,
  new_jackpot_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games;
  v_is_test boolean;
  v_pot public.snowball_pots;
  v_jackpot_won boolean;
  v_settlement text;
  v_new_max_calls int;
  v_new_jackpot numeric;
begin
  perform public.assert_is_host();

  select * into v_game from public.games where id = p_game_id;

  if v_game.id is null then
    raise exception 'game_not_found';
  end if;

  select coalesce(is_test_session, false) into v_is_test
    from public.sessions
   where id = v_game.session_id;

  if coalesce(v_is_test, false) then
    return query select 'test_session'::text, null::text, null::uuid, null::int, null::numeric;
    return;
  end if;

  if v_game.type is distinct from 'snowball'::public.game_type
     or v_game.snowball_pot_id is null then
    return query select 'not_snowball'::text, null::text, null::uuid, null::int, null::numeric;
    return;
  end if;

  -- The lock. It serialises settlement of this pot, which is what makes the
  -- read-modify-write below correct: two different games ending on the same pot
  -- at the same moment roll over one after the other, not on top of each other.
  select * into v_pot
    from public.snowball_pots
   where id = v_game.snowball_pot_id
   for update;

  if v_pot.id is null then
    raise exception 'snowball_pot_not_found';
  end if;

  -- Won or not decides reset vs rollover. Voided winners do not count.
  select exists (
    select 1 from public.winners
     where game_id = p_game_id
       and coalesce(is_snowball_jackpot, false)
       and coalesce(is_void, false) = false
  ) into v_jackpot_won;

  -- Both new values come from the locked pot row and nowhere else.
  if v_jackpot_won then
    v_settlement := 'reset';
    v_new_max_calls := v_pot.base_max_calls;
    v_new_jackpot := v_pot.base_jackpot_amount;
  else
    v_settlement := 'rollover';
    v_new_max_calls := v_pot.current_max_calls + v_pot.calls_increment;
    v_new_jackpot := v_pot.current_jackpot_amount + v_pot.jackpot_increment;
  end if;

  -- Claim the settlement first. The partial unique index on
  -- (snowball_pot_id, game_id) turns a second attempt for this game into a
  -- unique violation, caught here so the pot is left exactly where it is.
  begin
    insert into public.snowball_pot_history (
      snowball_pot_id,
      game_id,
      change_type,
      old_val_max,
      new_val_max,
      old_val_jackpot,
      new_val_jackpot,
      changed_by
    ) values (
      v_pot.id,
      p_game_id,
      case when v_jackpot_won then 'jackpot_won' else 'rollover' end,
      v_pot.current_max_calls,
      v_new_max_calls,
      v_pot.current_jackpot_amount,
      v_new_jackpot,
      auth.uid()
    );
  exception when unique_violation then
    -- Already settled, most likely a completed game re-opened and ended again.
    -- settlement is null because this call moved nothing; the values returned are
    -- the pot as it actually stands, read under the lock.
    return query select 'already_settled'::text,
                        null::text,
                        v_pot.id::uuid,
                        v_pot.current_max_calls::int,
                        v_pot.current_jackpot_amount::numeric;
    return;
  end;

  -- Same transaction as the claim, so the documented "claim landed, pot did not
  -- move" gap cannot happen any more. last_awarded_at only moves on a reset.
  update public.snowball_pots
     set current_max_calls = v_new_max_calls,
         current_jackpot_amount = v_new_jackpot,
         last_awarded_at = case when v_jackpot_won then now() else last_awarded_at end
   where id = v_pot.id;

  return query select 'settled'::text,
                      v_settlement::text,
                      v_pot.id::uuid,
                      v_new_max_calls::int,
                      v_new_jackpot::numeric;
end;
$$;

comment on function public.settle_snowball_pot(uuid) is
  'Settles the snowball pot for a finished game: reset if the jackpot was won, rollover if not. Host-callable by design, so RLS on snowball_pots and snowball_pot_history can stay admin-only. Every written value is derived from the locked pot row, never supplied by the caller. Once per game, guarded by snowball_pot_history_pot_game_unique.';

-- The anon revoke is NOT decoration. Supabase ships default privileges that grant
-- EXECUTE on new public-schema functions to anon, and "revoke ... from public"
-- does not remove an explicit grant to a named role. Without this line anon can
-- call the function; assert_is_host() still rejects it, because auth.uid() is
-- null, but a money function should not be reachable by an unauthenticated role
-- at all. Verified in production: the four functions from
-- 20260729120000_atomic_host_mutations.sql all carry anon EXECUTE for exactly
-- this reason, while the older admin RPCs do not.
revoke all on function public.settle_snowball_pot(uuid) from public;
revoke all on function public.settle_snowball_pot(uuid) from anon;
grant execute on function public.settle_snowball_pot(uuid) to authenticated;
grant execute on function public.settle_snowball_pot(uuid) to service_role;
