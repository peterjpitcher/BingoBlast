-- Behaviour of the kit's TV pairing in Cash Bingo (spec S3.1, row C-6):
-- 20261107120000_kit_tv_pairing_tables.sql and
-- 20261107120001_kit_tv_pairing_functions.sql, run against the fully replayed
-- database in suites D and E of supabase/tests/run.sh.
--
-- WHAT THIS PROVES
--   The three tables are invisible to anon and authenticated (an admin's JWT
--   included) and carry no policy; the kit_tv_* functions are service role
--   only; and, through those functions as the service role, a code an active
--   host types pairs a TV, a pending account cannot pair one, a wrong code is
--   counted, only an admin can remove a TV, and a removed TV reads as
--   unpaired. The kit's own suite tests every edge; this proves the templates
--   work on Cash Bingo's profiles and roles.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- Fixtures: an admin, a host and a pending account of this file's own.
insert into auth.users (id, email) values
  ('7e000000-0000-4000-8000-000000000001', 'tv-admin@example.invalid'),
  ('7e000000-0000-4000-8000-000000000002', 'tv-host@example.invalid'),
  ('7e000000-0000-4000-8000-000000000003', 'tv-pending@example.invalid');
update public.profiles set role = 'admin' where id = '7e000000-0000-4000-8000-000000000001';
update public.profiles set role = 'host' where id = '7e000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
select t('tv pairing :: row level security is on for all three tables, with no policy',
         (select bool_and(relrowsecurity) from pg_class
           where oid in ('public.tv_devices'::regclass, 'public.tv_pairing_codes'::regclass, 'public.tv_pairing_attempts'::regclass))
           and not exists (select 1 from pg_policies where schemaname = 'public'
                            and tablename in ('tv_devices', 'tv_pairing_codes', 'tv_pairing_attempts')));

select t('tv pairing :: anon and authenticated hold no privilege on any of the three tables',
         not exists (
           select 1
             from unnest(array['anon','authenticated']) r,
                  unnest(array['public.tv_devices','public.tv_pairing_codes','public.tv_pairing_attempts']) tbl,
                  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
            where has_table_privilege(r, tbl, p)),
         (select string_agg(r || ':' || tbl || ':' || p, ',')
            from unnest(array['anon','authenticated']) r,
                 unnest(array['public.tv_devices','public.tv_pairing_codes','public.tv_pairing_attempts']) tbl,
                 unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
           where has_table_privilege(r, tbl, p)));

select t('tv pairing :: every kit_tv_* function is service role only, security definer, with an empty search_path',
         (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')
                          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          and has_function_privilege('service_role', p.oid, 'EXECUTE')
                          and p.prosecdef
                          and 'search_path=""' = any(p.proconfig))
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'kit\_tv\_%'),
         (select string_agg(p.proname || ' ' || coalesce(p.proconfig::text, '{}'), ' | ')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'kit\_tv\_%'));

-- ---------------------------------------------------------------------------
-- anon and authenticated (as the admin) are refused with 42501
-- ---------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_stmt text;
  v_ok boolean;
  v_detail text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_stmt in array array[
      'select count(*) from public.tv_devices',
      'select count(*) from public.tv_pairing_codes',
      'select count(*) from public.tv_pairing_attempts',
      $q$select public.kit_tv_list_devices(true)$q$
    ] loop
      begin
        execute format('set local role %I', v_role);
        perform set_config('request.jwt.claim.sub',
                           case when v_role = 'authenticated' then '7e000000-0000-4000-8000-000000000001' else '' end, true);
        execute v_stmt;
        v_ok := false;
        v_detail := v_role || ' ran: ' || v_stmt;
      exception
        when insufficient_privilege then v_ok := true; v_detail := sqlerrm;
        when others then v_ok := false; v_detail := v_role || ' got past the privilege check: ' || sqlerrm;
      end;
      reset role;
      perform t('tv pairing :: ' || v_role || ' is refused: ' || v_stmt, v_ok, v_detail);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The flow, through the functions, as the service role. Each step runs as
-- service_role and its result is recorded after `reset role` (t() and
-- test_results belong to the harness, not to the service role). Hashes are
-- SHA-256 hex, as the kit's sha256Hex sends them.
-- ---------------------------------------------------------------------------
do $$
declare
  c_code text := encode(sha256(convert_to('482913', 'UTF8')), 'hex');
  c_wrong text := encode(sha256(convert_to('000001', 'UTF8')), 'hex');
  c_secret text := encode(sha256(convert_to('tv-secret-cash-bingo-0000000000000000000000', 'UTF8')), 'hex');
  c_token_raw text := 'device-token-cash-bingo-000000000000000000';
  c_token text := encode(sha256(convert_to('device-token-cash-bingo-000000000000000000', 'UTF8')), 'hex');
  c_admin uuid := '7e000000-0000-4000-8000-000000000001';
  c_host uuid := '7e000000-0000-4000-8000-000000000002';
  c_pending uuid := '7e000000-0000-4000-8000-000000000003';
  v_text text;
  v_ok boolean;
  v_detail text;
  v_device uuid;
  v_name text;
  v_status text;
  v_seen boolean;
  v_prune jsonb;
begin
  set local role service_role;
  perform public.kit_tv_issue_code(c_code, c_secret, '203.0.113.7');
  reset role;

  -- A pending account cannot approve a code.
  begin
    set local role service_role;
    perform public.kit_tv_pair(c_code, 'Bar TV', c_pending, '203.0.113.8');
    reset role;
    v_ok := false; v_detail := 'a pending account paired a TV';
  exception when insufficient_privilege then
    reset role;
    v_ok := sqlerrm = 'kit_tv_not_staff'; v_detail := sqlerrm;
  end;
  perform t('tv pairing :: a pending account cannot pair a TV', v_ok, v_detail);

  set local role service_role;
  v_text := public.kit_tv_pair(c_code, 'Bar TV', c_host, '203.0.113.8');
  reset role;
  perform t('tv pairing :: an active host typing the code pairs it', v_text = 'paired', v_text);

  set local role service_role;
  v_text := public.kit_tv_pair(c_wrong, 'Other TV', c_host, '203.0.113.8');
  reset role;
  perform t('tv pairing :: a wrong code is answered wrong and recorded',
            v_text = 'wrong' and exists (select 1 from public.tv_pairing_attempts where user_id = c_host and outcome = 'wrong'),
            v_text);

  set local role service_role;
  select c.status, c.device_id, c.device_name into v_status, v_device, v_name
    from public.kit_tv_claim(c_secret, c_token) c;
  reset role;
  perform t('tv pairing :: the TV holding the pairing secret collects its device',
            v_status = 'paired' and v_device is not null and v_name = 'Bar TV',
            format('%s %s %s', v_status, v_device, v_name));

  set local role service_role;
  v_seen := exists (select 1 from public.kit_tv_device_seen(c_token));
  reset role;
  perform t('tv pairing :: the device token is recognised, and only its hash is stored',
            v_seen and not exists (select 1 from public.tv_devices where token_hash = c_token_raw)
                   and exists (select 1 from public.tv_devices where token_hash = c_token));

  begin
    set local role service_role;
    perform public.kit_tv_revoke(v_device, c_host);
    reset role;
    v_ok := false; v_detail := 'a host removed a TV';
  exception when insufficient_privilege then
    reset role;
    v_ok := sqlerrm = 'kit_tv_not_admin'; v_detail := sqlerrm;
  end;
  perform t('tv pairing :: a host cannot remove a TV', v_ok, v_detail);

  set local role service_role;
  v_text := public.kit_tv_revoke(v_device, c_admin);
  v_seen := exists (select 1 from public.kit_tv_device_seen(c_token));
  v_prune := public.kit_tv_prune_pairing();
  reset role;
  perform t('tv pairing :: an admin can remove a TV', v_text = 'Bar TV', v_text);
  perform t('tv pairing :: a removed TV reads as unpaired', not v_seen);
  perform t('tv pairing :: the daily clean-up runs and reports its counts',
            v_prune ?& array['codes', 'attempts', 'revoked_devices'], v_prune::text);
end $$;
