-- Resetting a session keeps a record of what it destroyed, and refuses when the
-- reset would leave the snowball pot permanently wrong.
--
-- WHY
--   reset_session_safe deleted every winner and every game state for a session
--   and set it back to 'ready'. Nothing anywhere recorded that it happened. For
--   the 29 July session that is 14 winners and 10 game states, gone in one
--   transaction, and afterwards the questions "who won on 29 July and what were
--   they paid?", "why is last month's session empty?" and "was this a mistake?"
--   are all permanently unanswerable.
--
--   Worse, it left the snowball settlement behind. settle_snowball_pot claims
--   (snowball_pot_id, game_id) in snowball_pot_history and that claim survived
--   the reset, while the pot itself stayed where the deleted night had moved it.
--   The replayed night then hit 'already_settled' every time, so the pot could
--   never move again for that game. A jackpot won on the replay would not reset
--   the pot, and a rollover would not roll over.
--
-- THE CHOICE MADE HERE, AND WHY
--   The alternative was to reverse the pot automatically using the old values on
--   the history row. That is rejected. Later games may legitimately have moved
--   the pot since, so rewinding it would overwrite real movements with a stale
--   figure, and a wrong pot that looks right is worse than a refusal. Financial
--   history is corrected by compensating entries, not by rewinding.
--
--   So: a session whose snowball game has already settled cannot be reset until
--   an admin has dealt with the pot deliberately on /admin/snowball. The refusal
--   names the pot. Everything else resets exactly as before, with a record.
--
-- ROLLBACK
--   Restore the previous three-statement body of reset_session_safe, and
--   optionally `drop table public.session_reset_log`. The log is additive and
--   harmless to leave behind.

-- ---------------------------------------------------------------------------
-- The record of what a reset destroyed
-- ---------------------------------------------------------------------------
create table if not exists public.session_reset_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  -- Snapshotted rather than joined. The session may be renamed or deleted later,
  -- and this row has to still mean something when it is.
  session_name text,
  reset_by uuid references auth.users(id) on delete set null,
  reset_at timestamptz not null default now(),
  winners_deleted int not null default 0,
  game_states_deleted int not null default 0,
  -- The winners exactly as they were. winner_name is always the literal
  -- 'Anonymous' by policy, so this snapshot carries no personal data: it is
  -- stages, prizes, call counts, void flags and timestamps.
  winners_snapshot jsonb
);

alter table public.session_reset_log enable row level security;

drop policy if exists "Admins view session reset log" on public.session_reset_log;
create policy "Admins view session reset log"
  on public.session_reset_log for select
  using (exists (select 1 from public.profiles
                  where profiles.id = auth.uid()
                    and profiles.role = 'admin'::public.user_role));

-- No INSERT, UPDATE or DELETE policy, deliberately. The only writer is
-- reset_session_safe, which is security definer and owned by postgres, so it
-- writes without consulting policies. A record of a destructive act that the
-- actor can edit or remove is not a record.
comment on table public.session_reset_log is
  'Append-only record of every session reset: who, when, and what was destroyed, including the winners as jsonb. Written only by reset_session_safe. There is no INSERT, UPDATE or DELETE policy and there should never be one.';

create index if not exists session_reset_log_session_idx
  on public.session_reset_log (session_id, reset_at desc);

-- ---------------------------------------------------------------------------
-- The reset itself
-- ---------------------------------------------------------------------------
-- The return type changes from void to the log row, and `create or replace`
-- cannot change a return type ("cannot change return type of existing
-- function"). The drop is required, and it is safe: the function is recreated
-- immediately below in the same transaction, and the grants are reasserted after
-- it, which they must be anyway because dropping and recreating rebuilds the ACL
-- from the schema default privileges.
drop function if exists public.reset_session_safe(uuid);

create or replace function public.reset_session_safe(p_session_id uuid)
returns public.session_reset_log
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.sessions;
  v_settled_pot_name text;
  v_winners jsonb;
  v_winner_count int;
  v_state_count int;
  v_log public.session_reset_log;
begin
  perform public.assert_is_admin();

  select * into v_session
    from public.sessions
   where id = p_session_id
   for update;

  if v_session.id is null then
    raise exception 'session_not_found';
  end if;

  -- Refuse if any game in this session has already settled the pot. Resetting
  -- would leave the claim in place and the pot where this night put it, and the
  -- replayed night could then never move the pot again.
  select p.name into v_settled_pot_name
    from public.snowball_pot_history h
    join public.games g on g.id = h.game_id
    join public.snowball_pots p on p.id = h.snowball_pot_id
   where g.session_id = p_session_id
   limit 1;

  if v_settled_pot_name is not null then
    raise exception 'snowball_already_settled:%', v_settled_pot_name;
  end if;

  -- Snapshot before deleting. jsonb_agg over zero rows is null, which is the
  -- right answer for "this session had no winners".
  select jsonb_agg(to_jsonb(w) order by w.created_at), count(*)
    into v_winners, v_winner_count
    from public.winners w
   where w.session_id = p_session_id;

  select count(*) into v_state_count
    from public.game_states gs
    join public.games g on g.id = gs.game_id
   where g.session_id = p_session_id;

  insert into public.session_reset_log (
    session_id, session_name, reset_by,
    winners_deleted, game_states_deleted, winners_snapshot
  ) values (
    p_session_id, v_session.name, auth.uid(),
    coalesce(v_winner_count, 0), coalesce(v_state_count, 0), v_winners
  )
  returning * into v_log;

  delete from public.winners where session_id = p_session_id;

  delete from public.game_states gs
   using public.games g
   where gs.game_id = g.id and g.session_id = p_session_id;

  update public.sessions
     set status = 'ready', active_game_id = null
   where id = p_session_id;

  return v_log;
end;
$function$;

revoke all on function public.reset_session_safe(uuid) from public;
revoke all on function public.reset_session_safe(uuid) from anon;
grant execute on function public.reset_session_safe(uuid) to authenticated, service_role;

comment on function public.reset_session_safe(uuid) is
  'Wipes a session back to ready. Admin only. Records everything it destroys in session_reset_log first, and refuses outright when the session has already settled a snowball pot, because the pot cannot be safely rewound.';
