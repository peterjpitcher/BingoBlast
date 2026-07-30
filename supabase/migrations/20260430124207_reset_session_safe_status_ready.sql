-- Reconstructed migration file: reset_session_safe_status_ready
--
-- PROVENANCE
--   Applied to production (Supabase project bcmorqsgeumtmhvctvgu, "BingoBlast")
--   on 2026-04-30 at applied version 20260430124207. No file for it existed in
--   this repository; recovered on 2026-07-30 from the exact SQL stored in
--   supabase_migrations.schema_migrations.statements for that version.
--   The body below is that stored statement, reproduced verbatim.
--
-- WHAT IT DOES
--   Redefines public.reset_session_safe so a reset returns the session to
--   status 'ready' (and clears active_game_id) after deleting its winners and
--   game states.
--
-- VERIFIED AGAINST LIVE STATE (read-only, 2026-07-30)
--   pg_get_functiondef('public.reset_session_safe(uuid)') matches this body
--   exactly, including SECURITY DEFINER and search_path = public.
--
-- REBUILD IMPACT: none. 20260430120300_atomic_admin_mutations.sql in this repo
--   already defines reset_session_safe with a byte-identical body, so a fresh
--   project built from these migrations was already correct for this function.
--   This file exists for migration-history parity, so that the remote version
--   20260430124207 has a local counterpart and `supabase db push` stops
--   aborting with "Remote migration versions not found in local migrations
--   directory".
--
-- ORDERING NOTE
--   In production this ran before 20260430124552 (tighten_profiles_select).
--   Locally that migration is filed as 20260430120400, so on a rebuild this
--   file now sorts after it instead. The two changes are independent (a
--   function body versus a profiles RLS policy), so the end state is the same.
--
-- IDEMPOTENT: yes, create or replace.
-- NOT re-applied to production; production already holds this definition.

create or replace function public.reset_session_safe(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  delete from public.winners where session_id = p_session_id;

  delete from public.game_states gs
   using public.games g
   where gs.game_id = g.id and g.session_id = p_session_id;

  update public.sessions
     set status = 'ready', active_game_id = null
   where id = p_session_id;
end;
$$;
