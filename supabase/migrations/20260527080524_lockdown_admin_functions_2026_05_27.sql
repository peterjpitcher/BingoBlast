-- Reconstructed migration file: lockdown_admin_functions_2026_05_27
--
-- PROVENANCE
--   Applied to production (Supabase project bcmorqsgeumtmhvctvgu, "BingoBlast")
--   on 2026-05-27 at applied version 20260527080524. No file for it existed in
--   this repository; recovered on 2026-07-30 from the exact SQL stored in
--   supabase_migrations.schema_migrations.statements for that version.
--
--   The applied statement, verbatim:
--
--     -- Trigger functions (no direct RPC callers needed; triggers fire regardless of grant)
--     REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
--     REVOKE EXECUTE ON FUNCTION public.sync_game_states_public() FROM anon, authenticated, PUBLIC;
--
--     -- Admin-only operations (revoke anon, keep authenticated for admin UI)
--     REVOKE EXECUTE ON FUNCTION public.assert_is_admin() FROM anon;
--     REVOKE EXECUTE ON FUNCTION public.delete_game_safe(uuid) FROM anon;
--     REVOKE EXECUTE ON FUNCTION public.delete_session_safe(uuid) FROM anon;
--     REVOKE EXECUTE ON FUNCTION public.reset_session_safe(uuid) FROM anon;
--     REVOKE EXECUTE ON FUNCTION public.update_game_safe(p_game_id uuid, p_name text, p_game_index integer, p_background_colour text, p_notes text, p_type game_type, p_snowball_pot_id uuid, p_stage_sequence jsonb, p_prizes jsonb) FROM anon;
--
--     -- create_table_booking_transaction left anon-callable: likely used by public booking form.
--     -- Flag for app-team review if public bookings aren't actually a feature here.
--
--   The two trailing comments are the original author's, kept as written. See
--   the note at the foot of this file on that last point, which is now answered.
--
-- WHAT IT DOES
--   Removes EXECUTE from roles that should not be able to call these functions
--   as RPCs. Trigger functions are revoked outright (a trigger fires with the
--   table owner's rights, so no role needs a direct grant), and the admin
--   mutation helpers lose anon while keeping authenticated for the admin UI.
--
-- VERIFIED AGAINST LIVE STATE (read-only, 2026-07-30)
--   has_function_privilege checks confirm the end state on production:
--     handle_new_user()          anon=false  authenticated=false  PUBLIC=false
--     sync_game_states_public()  anon=false  authenticated=false  PUBLIC=false
--     assert_is_admin()          anon=false  authenticated=true
--     delete_game_safe(uuid)     anon=false  authenticated=true
--     delete_session_safe(uuid)  anon=false  authenticated=true
--     reset_session_safe(uuid)   anon=false  authenticated=true
--     update_game_safe(...)      anon=false  authenticated=true
--   service_role retains EXECUTE on all of them.
--
-- REBUILD IMPACT: partly a genuine gap.
--   - Genuinely missing: the revoke on public.sync_game_states_public(). This
--     repo creates it in 20251221101438_add_game_states_public.sql as SECURITY
--     DEFINER and never revokes the default PUBLIC EXECUTE, so a rebuilt
--     project leaves a SECURITY DEFINER function callable by anon over RPC.
--   - Already covered: the five anon revokes. Each of those functions is
--     created in 20260430120300_atomic_admin_mutations.sql, which already does
--     "revoke all on function ... from public" followed by "grant execute ...
--     to authenticated". That is why production reads anon=false for them.
--     Reproducing the revokes here is a harmless no-op that keeps this file a
--     faithful record of what was applied.
--
-- WHY THIS FILE IS GUARDED RATHER THAN BARE REVOKEs
--   public.handle_new_user() is not created anywhere in this repository, and a
--   bare REVOKE on an absent function raises 42883 (undefined_function) and
--   aborts the migration, so a fresh rebuild would fail here. Each target is
--   therefore revoked only if present, and skipped with a notice if not.
--
-- IDEMPOTENT: yes. REVOKE converges on the same state when re-run, and absent
--   targets are skipped.
-- NOT re-applied to production; production already holds these grants.

-- Trigger functions (no direct RPC callers needed; triggers fire regardless of grant)
do $$
declare
  v_fn text;
  v_targets text[] := array[
    'public.handle_new_user()',
    'public.sync_game_states_public()'
  ];
begin
  foreach v_fn in array v_targets loop
    if to_regprocedure(v_fn) is null then
      raise notice 'lockdown_admin_functions_2026_05_27: skipping %, not present in this database', v_fn;
    else
      execute format('revoke execute on function %s from anon, authenticated, public', v_fn);
    end if;
  end loop;
end;
$$;

-- Admin-only operations (revoke anon, keep authenticated for admin UI)
do $$
declare
  v_fn text;
  v_targets text[] := array[
    'public.assert_is_admin()',
    'public.delete_game_safe(uuid)',
    'public.delete_session_safe(uuid)',
    'public.reset_session_safe(uuid)',
    'public.update_game_safe(uuid, text, integer, text, text, public.game_type, uuid, jsonb, jsonb)'
  ];
begin
  foreach v_fn in array v_targets loop
    if to_regprocedure(v_fn) is null then
      raise notice 'lockdown_admin_functions_2026_05_27: skipping %, not present in this database', v_fn;
    else
      execute format('revoke execute on function %s from anon', v_fn);
    end if;
  end loop;
end;
$$;

-- Follow-up on the original author's open question, resolved 2026-07-30:
-- public.create_table_booking_transaction(jsonb, jsonb, jsonb) is NOT a feature
-- of this application. Anchor Bingo has no booking form; the function belongs to
-- another project sharing this database. It is deliberately left untouched here
-- so this file stays a faithful record of what was applied, and because this
-- repository does not own that function. It is still anon-callable and
-- PUBLIC-executable on production.
--
-- Also noted while verifying: public.bump_game_state_version() was given a
-- search_path by 20260527063058 but never revoked, so unlike the other two
-- trigger functions it remains anon-callable and PUBLIC-executable. Reproduced
-- as applied rather than corrected here. Both points are raised with the user
-- rather than changed in a reconstruction migration.
