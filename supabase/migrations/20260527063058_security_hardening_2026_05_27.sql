-- Reconstructed migration file: security_hardening_2026_05_27
--
-- PROVENANCE
--   Applied to production (Supabase project bcmorqsgeumtmhvctvgu, "BingoBlast")
--   on 2026-05-27 at applied version 20260527063058. No file for it existed in
--   this repository; recovered on 2026-07-30 from the exact SQL stored in
--   supabase_migrations.schema_migrations.statements for that version.
--
--   The applied statement, verbatim:
--
--     ALTER FUNCTION public.bump_game_state_version() SET search_path = public, pg_catalog;
--     ALTER FUNCTION public.create_table_booking_transaction(p_booking_data jsonb, p_menu_items jsonb, p_payment_data jsonb) SET search_path = public, pg_catalog;
--     ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_catalog;
--     ALTER FUNCTION public.sync_game_states_public() SET search_path = public, pg_catalog;
--
-- WHAT IT DOES
--   Pins an explicit search_path on four functions that were created without
--   one. For a SECURITY DEFINER function, an unpinned search_path lets a caller
--   who can create objects in an earlier schema shadow the names the function
--   body resolves, so this closes a real search-path injection route.
--
-- VERIFIED AGAINST LIVE STATE (read-only, 2026-07-30)
--   pg_proc.proconfig for exactly these four functions reads
--   {"search_path=public, pg_catalog"}. Every other function in the public
--   schema reads {"search_path=public"}, set by its own definition. That
--   matches the statement above with nothing left over.
--
-- REBUILD IMPACT: this is a genuine gap. Two of the four targets are created by
--   migrations in this repo with no search_path at all:
--     - public.sync_game_states_public()  (SECURITY DEFINER, so this matters)
--     - public.bump_game_state_version()  (not SECURITY DEFINER)
--   Without this file a rebuilt project comes up with both unpinned.
--
-- WHY THIS FILE IS GUARDED RATHER THAN A BARE ALTER
--   The other two targets are NOT created anywhere in this repository:
--     - public.handle_new_user() is created outside these migrations (auth
--       bootstrap), and
--     - public.create_table_booking_transaction(jsonb, jsonb, jsonb) does not
--       belong to this application at all. It is a stray function from another
--       project that shares this database.
--   A bare ALTER FUNCTION on an absent function raises 42883
--   (undefined_function) and aborts the whole migration, so a fresh rebuild
--   would fail at this point. Each target is therefore applied only if present,
--   and skipped with a notice if not. The resulting state on production and on
--   a rebuild is identical to the statement above.
--
-- IDEMPOTENT: yes. ALTER FUNCTION ... SET search_path is a set-to-value, so
--   re-running converges on the same state, and absent targets are skipped.
-- NOT re-applied to production; production already holds this configuration.

do $$
declare
  v_fn text;
  v_targets text[] := array[
    'public.bump_game_state_version()',
    'public.create_table_booking_transaction(jsonb, jsonb, jsonb)',
    'public.handle_new_user()',
    'public.sync_game_states_public()'
  ];
begin
  foreach v_fn in array v_targets loop
    if to_regprocedure(v_fn) is null then
      raise notice 'security_hardening_2026_05_27: skipping %, not present in this database', v_fn;
    else
      execute format('alter function %s set search_path = public, pg_catalog', v_fn);
    end if;
  end loop;
end;
$$;
