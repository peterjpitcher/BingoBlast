-- Manual pot edits move the money and write the audit row in one transaction.
--
-- WHY
--   updateSnowballPot and resetSnowballPot each did three things in three round
--   trips: read the old values, write the new ones with a bare `.update()`, then
--   insert the audit row as a separate statement whose failure was caught and
--   deliberately ignored ("Continue despite error, not critical to block
--   action"). Three consequences, all of them live today:
--
--   1. The pot could move with NO audit row, and the admin was told it worked.
--   2. The audit row could be written for a move that did not happen.
--   3. The `.update()` had no `.select()`, so a write RLS filtered out returned
--      no error and no rows and was reported as success. CLAUDE.md names this
--      exact pattern as the one that has already produced two live bugs.
--
--   The same three-round-trip shape was fixed inside settle_snowball_pot in
--   20260730065531. These are the last two places it survived, and they are on
--   the same table.
--
--   Production evidence that this matters: snowball_pot_history holds zero rows
--   while the pot has demonstrably moved six times, from 42 calls / £20 to 54
--   calls / £140. Some of that predates the audit table. Nothing should be
--   allowed to add to it silently.
--
-- WHAT IS DELIBERATELY NOT DONE
--   resetSnowballPot used to clear last_awarded_at. It no longer does. That
--   column is the record of when the jackpot was last actually won, and a manual
--   correction to the current figures is not a statement about that.
--
--   The six unlogged historical movements are NOT backfilled. Inventing audit
--   rows for events nobody observed would be worse than having none. See the
--   opening-balance note in the review spec.
--
-- ROLLBACK
--   drop function public.update_snowball_pot_safe(uuid, text, int, numeric, int, numeric, int, numeric);
--   drop function public.reset_snowball_pot_safe(uuid);
--   and restore the previous bodies of the two admin actions.

create or replace function public.update_snowball_pot_safe(
  p_pot_id uuid,
  p_name text,
  p_base_max_calls int,
  p_base_jackpot_amount numeric,
  p_calls_increment int,
  p_jackpot_increment numeric,
  p_current_max_calls int,
  p_current_jackpot_amount numeric
)
returns public.snowball_pots
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pot public.snowball_pots;
  v_moved boolean;
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
    raise exception 'pot_archived';
  end if;

  -- Only a change to the CURRENT figures is a movement of money. Renaming a pot
  -- or adjusting the increments for next time is configuration, and an audit row
  -- claiming money moved when it did not is its own kind of wrong.
  v_moved := v_pot.current_max_calls is distinct from p_current_max_calls
          or v_pot.current_jackpot_amount is distinct from p_current_jackpot_amount;

  update public.snowball_pots
     set name = p_name,
         base_max_calls = p_base_max_calls,
         base_jackpot_amount = p_base_jackpot_amount,
         calls_increment = p_calls_increment,
         jackpot_increment = p_jackpot_increment,
         current_max_calls = p_current_max_calls,
         current_jackpot_amount = p_current_jackpot_amount
   where id = p_pot_id
  returning * into v_pot;

  if v_moved then
    -- Same transaction as the write above. game_id stays null: this is a manual
    -- correction, not a settlement, and the partial unique index on
    -- (snowball_pot_id, game_id) only covers rows where game_id is not null, so
    -- an admin may correct a pot more than once.
    insert into public.snowball_pot_history (
      snowball_pot_id, game_id, change_type,
      old_val_max, new_val_max, old_val_jackpot, new_val_jackpot, changed_by
    ) values (
      p_pot_id, null, 'manual_update',
      v_pot.current_max_calls, p_current_max_calls,
      v_pot.current_jackpot_amount, p_current_jackpot_amount,
      auth.uid()
    );
  end if;

  return v_pot;
end;
$function$;

create or replace function public.reset_snowball_pot_safe(p_pot_id uuid)
returns public.snowball_pots
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pot public.snowball_pots;
  v_old_max int;
  v_old_jackpot numeric;
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

  -- Refuse while a game on this pot is unfinished. Resetting mid-game would
  -- move the jackpot figure out from under a host who is already announcing it.
  select count(*) into v_live_games
    from public.games g
    join public.game_states gs on gs.game_id = g.id
   where g.snowball_pot_id = p_pot_id
     and gs.status <> 'completed'::public.game_status;

  if v_live_games > 0 then
    raise exception 'pot_in_use';
  end if;

  v_old_max := v_pot.current_max_calls;
  v_old_jackpot := v_pot.current_jackpot_amount;

  if v_old_max = v_pot.base_max_calls
     and v_old_jackpot = v_pot.base_jackpot_amount then
    -- Already at base. Nothing moved, so nothing is recorded. Idempotent so a
    -- retry of a request that lost its response is not a second audit row.
    return v_pot;
  end if;

  update public.snowball_pots
     set current_max_calls = base_max_calls,
         current_jackpot_amount = base_jackpot_amount
         -- last_awarded_at is deliberately untouched. It records when the
         -- jackpot was last actually won, which a manual correction says
         -- nothing about. Clearing it here erased that permanently.
   where id = p_pot_id
  returning * into v_pot;

  insert into public.snowball_pot_history (
    snowball_pot_id, game_id, change_type,
    old_val_max, new_val_max, old_val_jackpot, new_val_jackpot, changed_by
  ) values (
    p_pot_id, null, 'manual_reset',
    v_old_max, v_pot.current_max_calls,
    v_old_jackpot, v_pot.current_jackpot_amount,
    auth.uid()
  );

  return v_pot;
end;
$function$;

-- Both revokes on each, for the reason in
-- 20260730070705_revoke_anon_execute_on_host_rpcs.sql.
revoke all on function public.update_snowball_pot_safe(uuid, text, int, numeric, int, numeric, int, numeric) from public;
revoke all on function public.update_snowball_pot_safe(uuid, text, int, numeric, int, numeric, int, numeric) from anon;
grant execute on function public.update_snowball_pot_safe(uuid, text, int, numeric, int, numeric, int, numeric) to authenticated, service_role;

revoke all on function public.reset_snowball_pot_safe(uuid) from public;
revoke all on function public.reset_snowball_pot_safe(uuid) from anon;
grant execute on function public.reset_snowball_pot_safe(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admins need to be able to read the history they are now guaranteed to write.
-- The SELECT policy already allows it; this adds the missing DELETE refusal by
-- simply never granting one. Recorded here so the absence is obviously
-- deliberate rather than an oversight: money history is append-only.
-- ---------------------------------------------------------------------------
comment on table public.snowball_pot_history is
  'Append-only audit of every snowball pot movement, written in the same transaction as the movement itself by settle_snowball_pot, update_snowball_pot_safe and reset_snowball_pot_safe. There is no DELETE policy and there should never be one.';
