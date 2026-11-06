-- Behaviour of the kit's sign-in migrations as Cash Bingo applies them
-- (20261107090000 to 20261107090006), run against the fully replayed database
-- in suites D and E of supabase/tests/run.sh, after every other suite.
--
-- WHAT THIS PROVES (spec S1.9, auth standard sections 4 and 14, row C-5)
--   * Every public table the authenticated role can reach carries the
--     restrictive active_staff_gate (the kit's own audit query finds none).
--   * A deactivated host, with a JWT that is still valid, can no longer call
--     the guarded money functions and reads no row from any staff table; a
--     rehire gives the access back.
--   * A pending account, a banned host and an account with no profile row
--     read nothing.
--   * A host reads only their own profile; an active admin reads every one.
--   * Nobody signed in can change a role or an access flag, an admin
--     included: that goes through the kit's service-role functions.
--   * The Before User Created hook refuses an account that no invite is
--     creating, and only Supabase Auth can call it.
--   * auth_audit is append-only for the service role, admin-read through RLS.
--   * The public pages are untouched: anon still reads what the TV and the
--     phones read.
-- Each check acts as the role itself, with the JWT subject set as PostgREST
-- sets it, because a catalogue row cannot show what the API will do.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- Rows of public.<table> visible to role <role> acting as <sub>; -1 means the
-- read itself failed (an error is a regression, never a pass).
create or replace function pg_temp.rows_as(p_role text, p_sub text, p_table text)
returns bigint language plpgsql as $$
declare v_count bigint;
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
    execute format('select count(*) from public.%I', p_table) into v_count;
  exception when others then
    v_count := -1;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v_count;
end $$;

-- Calls <stmt> as authenticated acting as <sub>. Returns 'ok' or the error.
create or replace function pg_temp.run_as(p_sub text, p_stmt text)
returns text language plpgsql as $$
declare v_result text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', p_sub, true);
    execute p_stmt;
    v_result := 'ok';
  exception when others then
    v_result := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v_result;
end $$;

-- Runs <stmt> as <sub>, THEN evaluates <check> as the superuser. In one
-- function so the check cannot be planned ahead of the write it checks.
create or replace function pg_temp.run_then_check(p_sub text, p_stmt text, p_check text)
returns text language plpgsql as $$
declare v_run text; v_ok boolean;
begin
  v_run := pg_temp.run_as(p_sub, p_stmt);
  execute 'select (' || p_check || ')' into v_ok;
  return case when coalesce(v_ok, false) then 'held' else 'BROKEN' end || ' (run: ' || v_run || ')';
end $$;

-- A scalar as authenticated acting as <sub>, as text ('ERROR ...' on failure).
create or replace function pg_temp.value_as(p_sub text, p_expr text)
returns text language plpgsql as $$
declare v_result text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', p_sub, true);
    execute 'select (' || p_expr || ')::text' into v_result;
    v_result := coalesce(v_result, '(null)');
  exception when others then
    v_result := 'ERROR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures, in their own uuid range. The trigger makes each profile pending;
-- the promotions are the deliberate second step, as on a real project.
--   a7...01 admin        a7...02 host          a7...03 second host
--   a7...04 pending      a7...05 host, deactivated below
--   a7...06 host, banned a7...07 no profile row
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-000000000001', 'ka-admin@example.invalid'),
  ('a7000000-0000-4000-8000-000000000002', 'ka-host@example.invalid'),
  ('a7000000-0000-4000-8000-000000000003', 'ka-host-two@example.invalid'),
  ('a7000000-0000-4000-8000-000000000004', 'ka-pending@example.invalid'),
  ('a7000000-0000-4000-8000-000000000005', 'ka-leaver@example.invalid'),
  ('a7000000-0000-4000-8000-000000000006', 'ka-banned@example.invalid'),
  ('a7000000-0000-4000-8000-000000000007', 'ka-orphan@example.invalid');
update public.profiles set role = 'admin' where id = 'a7000000-0000-4000-8000-000000000001';
update public.profiles set role = 'host'
 where id in ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003',
              'a7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000006');
update auth.users set banned_until = now() + interval '100 years'
 where id = 'a7000000-0000-4000-8000-000000000006';
delete from public.profiles where id = 'a7000000-0000-4000-8000-000000000007';

-- Something in every staff table, so "reads nothing" is not vacuous.
insert into public.sessions (id, name, status) values
  ('a7100000-0000-4000-8000-000000000001', 'Kit auth night', 'ready');
insert into public.games (id, session_id, game_index, name, type) values
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 1, 'Game 1', 'standard');

-- ---------------------------------------------------------------------------
-- The gate is on every reachable table
-- ---------------------------------------------------------------------------
-- The kit's ACTIVE_STAFF_GATE_AUDIT_SQL (@anchor-nights/kit/auth/sql), verbatim.
select t('gate :: every public table the authenticated role can reach carries active_staff_gate',
         not exists (
           select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relkind in ('r', 'p')
             and c.relname <> 'test_results'
             and (
               has_table_privilege('authenticated', c.oid, 'select')
               or has_table_privilege('authenticated', c.oid, 'insert')
               or has_table_privilege('authenticated', c.oid, 'update')
               or has_table_privilege('authenticated', c.oid, 'delete')
             )
             and (
               not c.relrowsecurity
               or not exists (
                 select 1 from pg_policy p
                 where p.polrelid = c.oid
                   and not p.polpermissive
                   and pg_get_expr(p.polqual, p.polrelid) like '%is_active_staff()%'
               )
             )),
         (select coalesce(string_agg(c.relname, ',' order by c.relname), '(none)')
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'test_results'
             and has_table_privilege('authenticated', c.oid, 'select')
             and not exists (select 1 from pg_policy p where p.polrelid = c.oid and not p.polpermissive)));

select t('gate :: is_active_staff, is_active_admin and current_staff_role are security definer with an empty search_path',
         (select bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('is_active_staff', 'is_active_admin', 'current_staff_role', 'kit_staff_role_for')),
         (select string_agg(p.proname || '=' || coalesce(array_to_string(p.proconfig, ';'), '(none)'), ' | ')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('is_active_staff', 'is_active_admin', 'current_staff_role', 'kit_staff_role_for')));

select t('gate :: anon cannot call is_active_staff, current_staff_role or the hook',
         not has_function_privilege('anon', 'public.is_active_staff()', 'EXECUTE')
           and not has_function_privilege('anon', 'public.current_staff_role()', 'EXECUTE')
           and not has_function_privilege('anon', 'public.kit_before_user_created(jsonb)', 'EXECUTE')
           and not has_function_privilege('authenticated', 'public.kit_before_user_created(jsonb)', 'EXECUTE')
           and has_function_privilege('supabase_auth_admin', 'public.kit_before_user_created(jsonb)', 'EXECUTE'));

-- ---------------------------------------------------------------------------
-- The role each account may act with
-- ---------------------------------------------------------------------------
select t('roles :: current_staff_role is admin, host, pending (pending, banned) and null (no profile)',
         pg_temp.value_as('a7000000-0000-4000-8000-000000000001', 'public.current_staff_role()') = 'admin'
           and pg_temp.value_as('a7000000-0000-4000-8000-000000000002', 'public.current_staff_role()') = 'host'
           and pg_temp.value_as('a7000000-0000-4000-8000-000000000004', 'public.current_staff_role()') = 'pending'
           and pg_temp.value_as('a7000000-0000-4000-8000-000000000006', 'public.current_staff_role()') = 'pending'
           and pg_temp.value_as('a7000000-0000-4000-8000-000000000007', 'public.current_staff_role()') = '(null)',
         concat_ws(', ',
           pg_temp.value_as('a7000000-0000-4000-8000-000000000001', 'public.current_staff_role()'),
           pg_temp.value_as('a7000000-0000-4000-8000-000000000002', 'public.current_staff_role()'),
           pg_temp.value_as('a7000000-0000-4000-8000-000000000004', 'public.current_staff_role()'),
           pg_temp.value_as('a7000000-0000-4000-8000-000000000006', 'public.current_staff_role()'),
           pg_temp.value_as('a7000000-0000-4000-8000-000000000007', 'public.current_staff_role()')));

-- ---------------------------------------------------------------------------
-- Profiles: your own row, or every row for an active admin
-- ---------------------------------------------------------------------------
select t('profiles :: the broad read policies are gone',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                       and policyname in ('Authenticated users can view profiles', 'Public profiles are viewable by everyone.')),
         (select string_agg(policyname, ',' order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'profiles'));

select t('profiles :: a host reads exactly one profile, their own',
         pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000002', 'profiles') = 1
           and pg_temp.value_as('a7000000-0000-4000-8000-000000000002',
                 '(select id from public.profiles)') = 'a7000000-0000-4000-8000-000000000002',
         'host sees ' || pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000002', 'profiles') || ' row(s)');

select t('profiles :: a host cannot read another member of staff by id',
         pg_temp.value_as('a7000000-0000-4000-8000-000000000002',
           '(select count(*) from public.profiles where id = ''a7000000-0000-4000-8000-000000000001'')') = '0',
         pg_temp.value_as('a7000000-0000-4000-8000-000000000002',
           '(select count(*) from public.profiles where id = ''a7000000-0000-4000-8000-000000000001'')'));

select t('profiles :: an active admin reads every profile',
         pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000001', 'profiles')
           = (select count(*) from public.profiles),
         pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000001', 'profiles') || ' of '
           || (select count(*) from public.profiles));

select t('profiles :: anon reads no profile',
         pg_temp.rows_as('anon', null, 'profiles') in (0, -1),
         'anon got ' || pg_temp.rows_as('anon', null, 'profiles'));

-- ---------------------------------------------------------------------------
-- Pending, banned and profile-less accounts read nothing
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_sub text;
  v_label text;
  v_count bigint;
  v_host bigint;
begin
  foreach v_table in array array['sessions', 'games', 'game_states', 'game_states_public', 'winners',
                                 'snowball_pots', 'snowball_pot_history', 'session_reset_log',
                                 'profiles', 'auth_audit'] loop
    foreach v_sub in array array['a7000000-0000-4000-8000-000000000004',
                                 'a7000000-0000-4000-8000-000000000006',
                                 'a7000000-0000-4000-8000-000000000007'] loop
      v_label := case right(v_sub, 1) when '4' then 'pending' when '6' then 'banned host' else 'no profile' end;
      v_count := pg_temp.rows_as('authenticated', v_sub, v_table);
      perform t('gate :: a ' || v_label || ' account reads no row of ' || v_table,
                v_count = 0, v_label || ' got ' || v_count);
    end loop;
  end loop;

  -- Not vacuous: an active host does see the staff tables' rows.
  v_host := pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000002', 'sessions');
  perform t('gate :: an active host still reads sessions', v_host > 0, 'host got ' || v_host);
  v_host := pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000002', 'games');
  perform t('gate :: an active host still reads games', v_host > 0, 'host got ' || v_host);
end $$;

-- ---------------------------------------------------------------------------
-- The leaver: a deactivated host's still-valid JWT
-- ---------------------------------------------------------------------------
select t('leaver :: before deactivation the host passes assert_is_host',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000005', 'select public.assert_is_host()') = 'ok',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000005', 'select public.assert_is_host()'));

-- The kit's leaver step 1 and 2, as the admin action runs it (service role).
do $$
declare v_old text;
begin
  set local role service_role;
  select public.kit_deactivate_staff('a7000000-0000-4000-8000-000000000005') into v_old;
  reset role;
  perform t('leaver :: kit_deactivate_staff reports the role it took away', v_old = 'host', v_old);
end $$;

select t('leaver :: the profile is pending and stamped deactivated',
         (select role::text = 'pending' and deactivated_at is not null from public.profiles
           where id = 'a7000000-0000-4000-8000-000000000005'));

do $$
declare
  v_stmt text;
  v_result text;
begin
  -- The guarded functions refuse before they touch anything. Each one calls
  -- assert_is_host() first (the money boundary, unchanged by this work).
  foreach v_stmt in array array[
    'select public.assert_is_host()',
    'select public.call_next_number(''a7200000-0000-4000-8000-000000000001'', 0, null)',
    'select public.void_last_number(''a7200000-0000-4000-8000-000000000001'', null, null)',
    'select public.end_night(''a7100000-0000-4000-8000-000000000001'')'
  ] loop
    v_result := pg_temp.run_as('a7000000-0000-4000-8000-000000000005', v_stmt);
    perform t('leaver :: a deactivated host is refused: ' || split_part(split_part(v_stmt, '(', 1), '.', 2),
              v_result like '%host or admin role required%', v_result);
  end loop;
end $$;

do $$
declare
  v_table text;
  v_count bigint;
begin
  foreach v_table in array array['sessions', 'games', 'game_states', 'game_states_public', 'winners',
                                 'snowball_pots', 'snowball_pot_history', 'session_reset_log', 'profiles'] loop
    v_count := pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000005', v_table);
    perform t('leaver :: a deactivated host reads no row of ' || v_table, v_count = 0, 'got ' || v_count);
  end loop;
end $$;

do $$
declare v text;
begin
  v := pg_temp.run_then_check('a7000000-0000-4000-8000-000000000005',
    'update public.sessions set notes = ''leaver'' where id = ''a7100000-0000-4000-8000-000000000001''',
    $c$(select coalesce(notes, '') <> 'leaver' from public.sessions where id = 'a7100000-0000-4000-8000-000000000001')$c$);
  perform t('leaver :: a deactivated host cannot write a session either', v like 'held%', v);
end $$;

-- Rehire: identity and role first (the app unbans last).
do $$
begin
  set local role service_role;
  perform public.kit_reactivate_staff('a7000000-0000-4000-8000-000000000005', 'host');
  reset role;
end $$;

select t('rehire :: a reactivated host passes assert_is_host and reads sessions again',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000005', 'select public.assert_is_host()') = 'ok'
           and pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000005', 'sessions') > 0,
         pg_temp.run_as('a7000000-0000-4000-8000-000000000005', 'select public.assert_is_host()'));

-- ---------------------------------------------------------------------------
-- Nobody signed in changes a role or an access flag
-- ---------------------------------------------------------------------------
-- A host has no UPDATE policy on profiles, so the update matches no row; the
-- guard trigger is the second line if a policy ever lets one through.
do $$
declare v text;
begin
  v := pg_temp.run_then_check('a7000000-0000-4000-8000-000000000002',
    'update public.profiles set role = ''admin'' where id = ''a7000000-0000-4000-8000-000000000002''',
    $c$(select role::text = 'host' from public.profiles where id = 'a7000000-0000-4000-8000-000000000002')$c$);
  perform t('guard :: a host cannot promote themselves (nothing changes)', v like 'held%', v);
end $$;

-- In a block, because the update must run before the read that checks it.
do $$
declare v_result text;
begin
  v_result := pg_temp.run_as('a7000000-0000-4000-8000-000000000001',
    'update public.profiles set email = ''ka-host-two-new@example.invalid'' where id = ''a7000000-0000-4000-8000-000000000003''');
  perform t('guard :: an admin can still update a profile''s email through the API (no 42P17 recursion)',
            v_result = 'ok' and (select email = 'ka-host-two-new@example.invalid' from public.profiles
                                  where id = 'a7000000-0000-4000-8000-000000000003'),
            v_result);
end $$;

do $$
declare v text;
begin
  v := pg_temp.run_then_check('a7000000-0000-4000-8000-000000000002',
    'update public.profiles set email = ''hijack@example.invalid'' where id = ''a7000000-0000-4000-8000-000000000001''',
    $c$(select email <> 'hijack@example.invalid' from public.profiles where id = 'a7000000-0000-4000-8000-000000000001')$c$);
  perform t('guard :: a host cannot update another profile at all (nothing changes)', v like 'held%', v);
end $$;

select t('guard :: an admin cannot change a role through the API either (42501)',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000001',
           'update public.profiles set role = ''admin'' where id = ''a7000000-0000-4000-8000-000000000003''') like '42501%'
           and (select role::text = 'host' from public.profiles where id = 'a7000000-0000-4000-8000-000000000003'),
         pg_temp.run_as('a7000000-0000-4000-8000-000000000001',
           'update public.profiles set role = ''admin'' where id = ''a7000000-0000-4000-8000-000000000003'''));

select t('guard :: an admin cannot reactivate a leaver through the API (42501)',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000001',
           'update public.profiles set deactivated_at = now() where id = ''a7000000-0000-4000-8000-000000000003''') like '42501%',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000001',
           'update public.profiles set deactivated_at = now() where id = ''a7000000-0000-4000-8000-000000000003'''));

select t('guard :: a pending account cannot insert itself a privileged profile',
         pg_temp.run_as('a7000000-0000-4000-8000-000000000007',
           'insert into public.profiles (id, email, role) values (''a7000000-0000-4000-8000-000000000007'', ''x@example.invalid'', ''admin'')') like '42501%'
           and not exists (select 1 from public.profiles where id = 'a7000000-0000-4000-8000-000000000007'),
         pg_temp.run_as('a7000000-0000-4000-8000-000000000007',
           'insert into public.profiles (id, email, role) values (''a7000000-0000-4000-8000-000000000007'', ''x@example.invalid'', ''admin'')'));

-- ---------------------------------------------------------------------------
-- Invite only: the Before User Created hook
-- ---------------------------------------------------------------------------
select t('hook :: a sign-up no invite is creating is refused with 403',
         (public.kit_before_user_created('{"user": {"email": "stranger@example.invalid", "app_metadata": {"provider": "email"}}}'::jsonb)
            -> 'error' ->> 'http_code') = '403');

select t('hook :: an anonymous sign-in is refused',
         (public.kit_before_user_created('{"user": {"email": "", "is_anonymous": true}}'::jsonb) -> 'error') is not null);

do $$
declare v_hash text := repeat('ab', 32);
begin
  set local role service_role;
  perform * from public.kit_issue_invite('Invitee@Example.invalid', 'host', v_hash, 'a7000000-0000-4000-8000-000000000001');
  perform * from public.kit_claim_invite(v_hash, gen_random_uuid());
  reset role;
  perform t('hook :: the account an invite acceptance is creating is let through',
            public.kit_before_user_created('{"user": {"email": "invitee@example.invalid", "app_metadata": {"provider": "email"}}}'::jsonb) = '{}'::jsonb);
  perform t('hook :: an invite does not let the same address in through another provider',
            (public.kit_before_user_created('{"user": {"email": "invitee@example.invalid", "app_metadata": {"provider": "google"}}}'::jsonb) -> 'error') is not null);
end $$;

select t('invites :: no API role can read invites or recovery grants',
         pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000001', 'invites') = -1
           and pg_temp.rows_as('anon', null, 'invites') = -1
           and pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000001', 'recovery_grants') = -1
           and pg_temp.rows_as('anon', null, 'recovery_grants') = -1);

-- ---------------------------------------------------------------------------
-- The auth audit: append-only, admins read it
-- ---------------------------------------------------------------------------
do $$
declare v_result text;
begin
  set local role service_role;
  insert into public.auth_audit (app, environment, event, outcome, email_hmac)
  values ('anchor-bingo', 'test', 'sign_in', 'failure', 'v1:' || repeat('0', 64));
  reset role;

  begin
    set local role service_role;
    update public.auth_audit set outcome = 'success';
    v_result := 'updated';
  exception when insufficient_privilege then v_result := 'refused';
  end;
  reset role;
  perform t('audit :: the service role cannot rewrite an audit row', v_result = 'refused', v_result);

  begin
    set local role service_role;
    delete from public.auth_audit;
    v_result := 'deleted';
  exception when insufficient_privilege then v_result := 'refused';
  end;
  reset role;
  perform t('audit :: the service role cannot delete an audit row', v_result = 'refused', v_result);
end $$;

select t('audit :: an active admin reads the audit, a host does not, anon cannot',
         pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000001', 'auth_audit') > 0
           and pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000002', 'auth_audit') = 0
           and pg_temp.rows_as('anon', null, 'auth_audit') = -1,
         concat_ws(', ',
           pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000001', 'auth_audit'),
           pg_temp.rows_as('authenticated', 'a7000000-0000-4000-8000-000000000002', 'auth_audit'),
           pg_temp.rows_as('anon', null, 'auth_audit')));

select t('audit :: the login throttle reads the audit (no wait after one failure)',
         public.kit_auth_throttle('sign_in', 'v1:' || repeat('0', 64), null) = 0);

-- ---------------------------------------------------------------------------
-- The public pages are untouched: the gate is for authenticated only
-- ---------------------------------------------------------------------------
select t('public :: anon still reads sessions, games and the public game state',
         pg_temp.rows_as('anon', null, 'sessions') > 0
           and pg_temp.rows_as('anon', null, 'games') > 0
           and pg_temp.rows_as('anon', null, 'game_states_public') >= 0,
         concat_ws(', ',
           pg_temp.rows_as('anon', null, 'sessions'),
           pg_temp.rows_as('anon', null, 'games'),
           pg_temp.rows_as('anon', null, 'game_states_public')));
