-- Full-migration-replay assertions (SUITE D in supabase/tests/run.sh).
--
-- WHAT THIS PROVES
--   That replaying EVERY file in supabase/migrations, in filename order, against
--   an empty production-shaped database produces the object set, security
--   settings and grants that production actually carries. The other suites test
--   four hand-picked migrations; this one is the only thing that would catch a
--   migration that is fine on its own and wrong in sequence, or a repo whose
--   history no longer rebuilds what production holds.
--
--   Everything asserted below was read from production (bcmorqsgeumtmhvctvgu) on
--   2026-08-25. When production legitimately changes, this file changes with it,
--   in the same pull request as the migration that changed it.
--
-- DELIBERATE OMISSION
--   public.create_table_booking_transaction exists in production and no
--   migration in this repo creates it. It belongs to no code here. The replay
--   therefore must NOT produce it, and the count below reflects that. See the
--   review spec for the open decision on whether to drop it from production.
--
-- Run via supabase/tests/run.sh, never against a real project.

-- Harness scaffolding. `test_results` and `t()` are created by this file, so
-- every assertion that COUNTS or SWEEPS objects has to exclude them, or the
-- suite fails on its own presence. They are named explicitly rather than
-- filtered by a prefix so a future harness object cannot hide behind the rule.
create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- run.sh runs this file twice: after a replay under production's default
-- privileges (current_defaults=off) and after one under the current Supabase
-- image's (current_defaults=on). See supabase-bootstrap.sql for why both.
\if :{?current_defaults}
\else
  \set current_defaults off
\endif

-- ---------------------------------------------------------------------------
-- The canaries, as in grants.test.sql. If the bootstrap did not reproduce the
-- production default privileges then every grant assertion below is meaningless
-- because the container is friendlier than the thing it is modelling.
--
-- Until 20260929103001 the first canary was "a function postgres creates is
-- anon-callable". The replay now closes that, so it is asserted as a result
-- further down, and the generosity this canary needs is found where no
-- migration can reach: supabase_admin's default privileges in public, which
-- grant anon EXECUTE outright in both worlds, on production too.
-- ---------------------------------------------------------------------------
set role supabase_admin;
create function public.replay_probe_admin_function() returns int
language sql immutable as $$ select 1 $$;
reset role;

select t('canary :: a function supabase_admin creates in public is still anon-callable',
         has_function_privilege('anon', 'public.replay_probe_admin_function()', 'EXECUTE'),
         'if false, supabase-bootstrap.sql is not production-shaped and this suite proves nothing. ACL: '
           || coalesce((select proacl::text from pg_proc
                         where oid = 'public.replay_probe_admin_function()'::regprocedure), 'NULL'));

drop function public.replay_probe_admin_function();

-- The second canary tells the two worlds apart for functions, as the table one
-- below does for tables: production's postgres defaults in public name
-- authenticated on a new function, the current image's do not. It reads the
-- ACL rather than has_function_privilege, because without 20260929103001 PUBLIC
-- would hand authenticated EXECUTE in both worlds and blur the difference.
create function public.replay_probe_postgres_function() returns int
language sql immutable as $$ select 1 $$;

select t('canary :: a new function names authenticated only under production defaults (current_defaults=' || :'current_defaults' || ')',
         (select p.proacl is not null
                 and exists (select 1 from aclexplode(p.proacl) a
                              where a.grantee = 'authenticated'::regrole::oid)
            from pg_proc p where p.oid = 'public.replay_probe_postgres_function()'::regprocedure)
           = (:'current_defaults' not in ('on', 'true', '1', 'yes')),
         'if false, supabase-bootstrap.sql did not build the default privileges this run asked for. ACL: '
           || coalesce((select proacl::text from pg_proc
                         where oid = 'public.replay_probe_postgres_function()'::regprocedure), 'NULL'));

-- And the assertion the canary used to be the opposite of. In both worlds, a
-- function postgres creates after the whole history has run must carry no PUBLIC
-- grant and must not be anon-callable, with nobody having written a revoke.
-- 20260905053040 alone did not achieve this: a per-schema default cannot revoke
-- the built-in global PUBLIC EXECUTE. 20260929103001 does, globally.
select t('default privileges :: a function postgres creates after the replay is NOT anon-callable',
         not has_function_privilege('anon', 'public.replay_probe_postgres_function()', 'EXECUTE'),
         'ACL: ' || coalesce((select proacl::text from pg_proc
                               where oid = 'public.replay_probe_postgres_function()'::regprocedure),
                             'NULL, the built-in default, which grants PUBLIC'));

select t('default privileges :: a function postgres creates after the replay carries no PUBLIC grant',
         (select p.proacl is not null
                 and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
            from pg_proc p where p.oid = 'public.replay_probe_postgres_function()'::regprocedure),
         'ACL: ' || coalesce((select proacl::text from pg_proc
                               where oid = 'public.replay_probe_postgres_function()'::regprocedure),
                             'NULL, the built-in default, which grants PUBLIC'));

drop function public.replay_probe_postgres_function();

select t('default privileges :: postgres holds a global default that withholds EXECUTE from PUBLIC',
         exists (select 1 from pg_default_acl d
                  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
                    and d.defaclobjtype = 'f'
                    and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)),
         (select coalesce(string_agg(coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, '(global)')
                                     || ' ' || d.defaclacl::text, ' | '), '(no function rows for postgres)')
            from pg_default_acl d
           where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f'));

-- The second canary tells the two worlds apart. Under production's defaults a
-- new table is readable by authenticated with nobody granting it; under the
-- current image's it is not. If this does not match the world run.sh asked for,
-- the table grant assertions further down are testing the wrong thing.
create table public.replay_probe_default_table (id int);

select t('canary :: a new table is readable by authenticated only under production defaults (current_defaults=' || :'current_defaults' || ')',
         has_table_privilege('authenticated', 'public.replay_probe_default_table', 'SELECT')
           = (:'current_defaults' not in ('on', 'true', '1', 'yes')),
         'if false, supabase-bootstrap.sql did not build the default privileges this run asked for');

drop table public.replay_probe_default_table;

-- What a role can actually do to a table, as a sorted list. pg_temp keeps it
-- out of public, where the function counts below would trip over it.
create or replace function pg_temp.table_privs(p_role text, p_table text) returns text
language sql stable as $$
  select coalesce(string_agg(p, ',' order by p), '')
    from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
   where has_table_privilege(p_role, p_table, p)
$$;

-- ---------------------------------------------------------------------------
-- Tables and row level security
-- ---------------------------------------------------------------------------
select t('tables :: the nine expected tables exist',
         (select count(*) = 9 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and c.relname in ('profiles','sessions','games','game_states',
                               'game_states_public','winners','snowball_pots',
                               'snowball_pot_history','session_reset_log')),
         (select string_agg(c.relname, ',' order by c.relname) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'));

select t('tables :: no unexpected tables were created',
         (select count(*) = 9 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'test_results'),
         (select string_agg(c.relname, ',' order by c.relname) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'test_results'));

select t('rls :: row level security is enabled on every public table',
         (select bool_and(c.relrowsecurity) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'test_results'),
         (select string_agg(c.relname || '=' || c.relrowsecurity::text, ',' order by c.relname)
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'test_results'
             and not c.relrowsecurity));

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
select t('enums :: user_role is exactly {admin,host,pending}',
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder) = 'admin,host,pending'
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'user_role'),
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'user_role'));

select t('enums :: session_status is exactly {draft,ready,running,completed}',
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder) = 'draft,ready,running,completed'
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'session_status'),
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'session_status'));

select t('enums :: game_type is exactly {standard,snowball,jackpot}',
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder) = 'standard,snowball,jackpot'
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'game_type'),
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'game_type'));

select t('enums :: win_stage is exactly {Line,Two Lines,Full House}',
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder) = 'Line,Two Lines,Full House'
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'win_stage'),
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
            from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'win_stage'));

-- ---------------------------------------------------------------------------
-- Functions: presence, security settings and search_path
-- ---------------------------------------------------------------------------
select t('functions :: the twenty expected functions exist and nothing else',
         (select count(*) = 20 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'),
         (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'));

select t('functions :: every security definer function pins search_path',
         (select bool_and(p.proconfig is not null
                          and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef),
         (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and (p.proconfig is null
                  or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))));

select t('functions :: bump_game_state_version is security INVOKER',
         (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'bump_game_state_version'),
         'a version bump must run as the caller so it cannot be used to escalate');

-- ---------------------------------------------------------------------------
-- Grants. This is the assertion the repo has been burned by twice: a function
-- created after ALTER DEFAULT PRIVILEGES picks up anon EXECUTE by itself, and
-- revoking from anon alone leaves the PUBLIC grant behind (a bare leading
-- "=X/postgres" in proacl), which anon inherits.
-- ---------------------------------------------------------------------------
select t('grants :: no function in public is executable by anon',
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'
             and has_function_privilege('anon', p.oid, 'EXECUTE')),
         (select string_agg(p.proname || ' ' || coalesce(p.proacl::text, 'DEFAULT'), ' | ' order by p.proname)
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'
             and has_function_privilege('anon', p.oid, 'EXECUTE')));

select t('grants :: no function in public carries a bare PUBLIC EXECUTE grant',
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'
             and p.proacl is not null
             and array_to_string(p.proacl, ',') like '=X/%'),
         (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't' and p.proacl is not null
             and array_to_string(p.proacl, ',') like '=X/%'));

select t('grants :: the fourteen caller-facing functions are executable by authenticated',
         (select count(*) = 14 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('assert_is_admin','assert_is_host','call_next_number',
                               'delete_game_safe','delete_session_safe','record_winner_atomic',
                               'reset_session_safe','set_winner_prize_given','settle_snowball_pot',
                               'update_game_safe','void_last_number','archive_snowball_pot',
                               'update_snowball_pot_safe','reset_snowball_pot_safe')
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('assert_is_admin','assert_is_host','call_next_number',
                               'delete_game_safe','delete_session_safe','record_winner_atomic',
                               'reset_session_safe','set_winner_prize_given','settle_snowball_pot',
                               'update_game_safe','void_last_number','archive_snowball_pot',
                               'update_snowball_pot_safe','reset_snowball_pot_safe')
             and not has_function_privilege('authenticated', p.oid, 'EXECUTE')));

select t('grants :: the three trigger functions are NOT executable by authenticated',
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('bump_game_state_version','sync_game_states_public','handle_new_user')
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('bump_game_state_version','sync_game_states_public','handle_new_user')
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')));

-- The general form, as for tables below: under the current defaults a function
-- nobody granted to service_role fails this. Eight did until 20260929103018.
select t('grants :: every public function is executable by service_role',
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'
             and not has_function_privilege('service_role', p.oid, 'EXECUTE')),
         (select coalesce(string_agg(p.proname, ',' order by p.proname), '(all fine)') from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 't'
             and not has_function_privilege('service_role', p.oid, 'EXECUTE')));

-- The whole matrix, function by function, as read from production on
-- 2026-09-29: sixteen callable by authenticated and service_role, four trigger
-- functions by service_role only, none by anon. It must come out the same in
-- both worlds, or a rebuilt project is not the project it rebuilds.
with expected(fname, authd, svc) as (
  values ('archive_snowball_pot', true, true),
         ('assert_is_admin', true, true),
         ('assert_is_host', true, true),
         ('bump_game_state_version', false, true),
         ('call_next_number', true, true),
         ('delete_game_safe', true, true),
         ('delete_session_safe', true, true),
         ('handle_new_user', false, true),
         ('parse_prize_pence', true, true),
         ('recompute_prize_shares', true, true),
         ('record_winner_atomic', true, true),
         ('reset_session_safe', true, true),
         ('reset_snowball_pot_safe', true, true),
         ('set_winner_prize_given', true, true),
         ('settle_snowball_pot', true, true),
         ('sync_game_states_public', false, true),
         ('sync_prize_shares', false, true),
         ('update_game_safe', true, true),
         ('update_snowball_pot_safe', true, true),
         ('void_last_number', true, true)
), actual as (
  select p.proname::text as fname,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authd,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 't'
), diff as (
  select coalesce(e.fname, a.fname) as fname,
         format('%s: want authenticated=%s service_role=%s anon=false, got authenticated=%s service_role=%s anon=%s',
                coalesce(e.fname, a.fname), e.authd, e.svc, a.authd, a.svc, a.anon) as detail
    from expected e full join actual a on a.fname = e.fname
   where e.fname is null or a.fname is null
      or a.anon or a.authd is distinct from e.authd or a.svc is distinct from e.svc
)
select t('grants :: every function''s EXECUTE for anon, authenticated and service_role matches production',
         (select count(*) = 0 from diff),
         (select coalesce(string_agg(detail, ' | ' order by fname), '(all twenty match)') from diff));

-- ---------------------------------------------------------------------------
-- Table grants. A table whose migration does not state its grants gets whatever
-- the defaults hand out: everything under production's, and nothing an API role
-- can read or write under the current image's. game_states_public and
-- session_reset_log relied on that until 20260929101118, and a rebuilt project
-- served the pub TV 42501. These hold in both worlds or the build is wrong.
-- ---------------------------------------------------------------------------
select t('table grants :: anon can SELECT game_states_public and nothing else (pub TV and phone follower)',
         pg_temp.table_privs('anon', 'public.game_states_public') = 'SELECT',
         'anon holds: ' || pg_temp.table_privs('anon', 'public.game_states_public'));

select t('table grants :: authenticated can SELECT game_states_public and nothing else',
         pg_temp.table_privs('authenticated', 'public.game_states_public') = 'SELECT',
         'authenticated holds: ' || pg_temp.table_privs('authenticated', 'public.game_states_public'));

select t('table grants :: anon holds no privilege at all on session_reset_log',
         pg_temp.table_privs('anon', 'public.session_reset_log') = '',
         'anon holds: ' || pg_temp.table_privs('anon', 'public.session_reset_log'));

select t('table grants :: authenticated can SELECT session_reset_log (RLS keeps it to admins) and write nothing',
         pg_temp.table_privs('authenticated', 'public.session_reset_log') = 'SELECT',
         'authenticated holds: ' || pg_temp.table_privs('authenticated', 'public.session_reset_log'));

-- The general form of the same bug, so the next new table cannot repeat it: under
-- the current defaults a table nobody granted on fails this for service_role.
select t('table grants :: every public table grants service_role SELECT, INSERT, UPDATE and DELETE',
         (select bool_and(string_to_array(pg_temp.table_privs('service_role', format('public.%I', c.relname)), ',')
                          @> array['SELECT','INSERT','UPDATE','DELETE'])
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'test_results'),
         (select coalesce(string_agg(c.relname || '=' || pg_temp.table_privs('service_role', format('public.%I', c.relname)), ' | '), '(all fine)')
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'test_results'
             and not string_to_array(pg_temp.table_privs('service_role', format('public.%I', c.relname)), ',')
                     @> array['SELECT','INSERT','UPDATE','DELETE']));

-- The catalogue says what is granted; these say what the REST API will actually
-- do for each role. Zero rows is fine; 42501 on a read is the outage.
do $$
declare
  v_ok boolean;
  v_detail text;
begin
  begin
    set local role anon;
    perform count(*) from public.game_states_public;
    v_ok := true;
    v_detail := 'anon read game_states_public';
  exception when insufficient_privilege then
    v_ok := false;
    v_detail := sqlerrm;
  end;
  reset role;
  perform t('table grants :: acting as anon, reading game_states_public succeeds', v_ok, v_detail);

  begin
    set local role authenticated;
    perform count(*) from public.game_states_public;
    v_ok := true;
    v_detail := 'authenticated read game_states_public';
  exception when insufficient_privilege then
    v_ok := false;
    v_detail := sqlerrm;
  end;
  reset role;
  perform t('table grants :: acting as authenticated, reading game_states_public succeeds', v_ok, v_detail);

  -- RLS would also refuse this with 42501, so the message is what proves the
  -- grant is the thing saying no.
  begin
    set local role anon;
    insert into public.game_states_public (game_id) values (gen_random_uuid());
    v_ok := false;
    v_detail := 'anon inserted into game_states_public';
  exception when insufficient_privilege then
    v_ok := sqlerrm like 'permission denied for table%';
    v_detail := sqlerrm;
  end;
  reset role;
  perform t('table grants :: acting as anon, writing game_states_public is refused by the grant', v_ok, v_detail);

  begin
    set local role anon;
    perform count(*) from public.session_reset_log;
    v_ok := false;
    v_detail := 'anon read session_reset_log';
  exception when insufficient_privilege then
    v_ok := sqlerrm like 'permission denied for table%';
    v_detail := sqlerrm;
  end;
  reset role;
  perform t('table grants :: acting as anon, reading session_reset_log is refused by the grant', v_ok, v_detail);

  begin
    set local role authenticated;
    perform count(*) from public.session_reset_log;
    v_ok := true;
    v_detail := 'authenticated read session_reset_log (RLS returns zero rows without an admin uid)';
  exception when insufficient_privilege then
    v_ok := false;
    v_detail := sqlerrm;
  end;
  reset role;
  perform t('table grants :: acting as authenticated, reading session_reset_log succeeds', v_ok, v_detail);

  begin
    set local role authenticated;
    insert into public.session_reset_log (session_id) values (gen_random_uuid());
    v_ok := false;
    v_detail := 'authenticated inserted into session_reset_log';
  exception when insufficient_privilege then
    v_ok := sqlerrm like 'permission denied for table%';
    v_detail := sqlerrm;
  end;
  reset role;
  perform t('table grants :: acting as authenticated, writing session_reset_log is refused by the grant', v_ok, v_detail);
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
select t('triggers :: on_auth_user_created is installed on auth.users',
         exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
                   and not tgisinternal and tgname = 'on_auth_user_created'),
         'the profile row for a new staff account is created by this trigger');

select t('triggers :: game_states carries both the version bump and the public sync',
         (select count(*) >= 2 from pg_trigger where tgrelid = 'public.game_states'::regclass
            and not tgisinternal),
         (select string_agg(tgname, ',' order by tgname) from pg_trigger
           where tgrelid = 'public.game_states'::regclass and not tgisinternal));

-- ---------------------------------------------------------------------------
-- Indexes that carry a correctness guarantee, not just performance
-- ---------------------------------------------------------------------------
select t('indexes :: winners_client_request_id_key exists and is partial on not null',
         exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'winners_client_request_id_key'
                   and indexdef like '%WHERE (client_request_id IS NOT NULL)%'),
         'record_winner_atomic catches unique_violation BY THIS EXACT NAME, so a rename breaks idempotency silently');

select t('indexes :: snowball_pot_history_pot_game_unique exists and is partial on not null',
         exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'snowball_pot_history_pot_game_unique'
                   and indexdef like '%WHERE (game_id IS NOT NULL)%'),
         'settle_snowball_pot relies on this to turn a second settlement into already_settled');

-- ---------------------------------------------------------------------------
-- Realtime publication. The public screens read game_states_public and watch
-- their snowball pot (20260929091809); nothing reads winners over realtime, and
-- it must not be published without a deliberate decision (see the review spec,
-- R13).
-- ---------------------------------------------------------------------------
select t('realtime :: the publication contains exactly sessions, game_states, game_states_public and snowball_pots',
         (select coalesce(string_agg(tablename, ',' order by tablename), '')
                 = 'game_states,game_states_public,sessions,snowball_pots'
            from pg_publication_tables where pubname = 'supabase_realtime'),
         (select coalesce(string_agg(tablename, ',' order by tablename), '(none)')
            from pg_publication_tables where pubname = 'supabase_realtime'));

select t('realtime :: snowball_pots has a replica identity, so publishing it cannot break pot updates',
         (select c.relreplident = 'f'
                 or (c.relreplident = 'd' and exists (select 1 from pg_constraint
                       where conrelid = c.oid and contype = 'p'))
                 or (c.relreplident = 'i' and exists (select 1 from pg_index
                       where indrelid = c.oid and indisreplident))
            from pg_class c where c.oid = 'public.snowball_pots'::regclass),
         'a published table with no usable replica identity rejects every UPDATE (55000), which would stop settle_snowball_pot. relreplident='
           || (select relreplident::text from pg_class where oid = 'public.snowball_pots'::regclass));

select t('realtime :: snowball_pots stays readable only through its one SELECT policy',
         (select count(*) = 1 from pg_policies
           where schemaname = 'public' and tablename = 'snowball_pots' and cmd = 'SELECT'),
         'Realtime sends a pot change to exactly the subscribers this policy lets read the row, so a new or widened SELECT policy widens the broadcast too: '
           || (select coalesce(string_agg(policyname || '=' || cmd, ', ' order by policyname), '(none)')
                 from pg_policies where schemaname = 'public' and tablename = 'snowball_pots'));

select t('realtime :: winners is NOT published',
         not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'winners'),
         'winners SELECT is public, so publishing it would broadcast prize text and void reasons');

-- ---------------------------------------------------------------------------
-- Policies. The count is a tripwire: a migration that adds or drops one without
-- updating this number has to say so out loud.
-- ---------------------------------------------------------------------------
select t('policies :: twenty one policies exist across the public schema',
         (select count(*) = 21 from pg_policies where schemaname = 'public'),
         (select count(*)::text || ' :: ' || string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
            from pg_policies where schemaname = 'public'));

select t('policies :: game_states_public has a read policy and no write policy',
         (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'game_states_public')
         and (select bool_and(cmd = 'SELECT') from pg_policies
               where schemaname = 'public' and tablename = 'game_states_public'),
         (select string_agg(policyname || '=' || cmd, ',' order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'game_states_public'));

-- ---------------------------------------------------------------------------
-- The security posture the remediation adds. These are behavioural assertions,
-- not catalogue ones: they are what would actually be exploited if they broke.
-- ---------------------------------------------------------------------------
select t('security :: winners has no INSERT policy, so the only way in is record_winner_atomic',
         not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'winners' and cmd = 'INSERT'),
         (select string_agg(policyname, ',' order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'winners' and cmd = 'INSERT'));

select t('security :: profiles.role defaults to pending',
         (select column_default like '%pending%' from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'),
         (select coalesce(column_default, '(none)') from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'));

-- The trigger is what actually decides what a stranger who signs up becomes, so
-- assert the behaviour rather than the source text.
do $$
declare
  v_id uuid := gen_random_uuid();
  v_role text;
begin
  insert into auth.users (id, email) values (v_id, 'replay-probe@example.invalid');
  select role::text into v_role from public.profiles where id = v_id;
  perform t('security :: a brand new auth user is created as pending, not host',
            v_role = 'pending',
            'handle_new_user gave the new account role ' || coalesce(v_role, '(no profile row)'));
  delete from public.profiles where id = v_id;
  delete from auth.users where id = v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Constraints and columns added by the remediation. These are the guards that
-- stop a typo becoming a cash error, so they are asserted rather than assumed.
-- ---------------------------------------------------------------------------
select t('constraints :: a snowball pot cannot be given a window wider than 90 balls',
         exists (select 1 from pg_constraint where conname = 'snowball_pots_max_calls_within_90'),
         'a 90-ball game can never call more than 90, so a wider window makes every Full House a jackpot');

select t('constraints :: two games in one session cannot share a game_index',
         exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'games_session_game_index_unique'),
         'a duplicate index makes the host screen ambiguous about which game is first and last');

select t('columns :: snowball_pots.archived_at exists, so a pot can be retired without being deleted',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'snowball_pots'
                    and column_name = 'archived_at'),
         'pot history is the audit trail for real cash and must never be deletable');

select t('policies :: snowball_pot_history has no DELETE policy, so the money audit is append-only',
         not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'snowball_pot_history' and cmd = 'DELETE'),
         (select string_agg(policyname, ',' order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'snowball_pot_history' and cmd = 'DELETE'));

select t('audit :: session_reset_log is readable by admins and writable by nobody',
         (select count(*) = 1 from pg_policies
           where schemaname = 'public' and tablename = 'session_reset_log')
         and (select bool_and(cmd = 'SELECT') from pg_policies
               where schemaname = 'public' and tablename = 'session_reset_log'),
         (select coalesce(string_agg(policyname || '=' || cmd, ',' order by policyname), '(none)')
            from pg_policies where schemaname = 'public' and tablename = 'session_reset_log'));

select t('audit :: reset_session_safe returns the log row rather than void',
         (select pg_get_function_result(p.oid) = 'session_reset_log'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reset_session_safe'),
         (select pg_get_function_result(p.oid) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reset_session_safe'));

select t('security :: a user cannot insert their own profile with a privileged role',
         (select count(*) = 1 from pg_policies
           where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT'
             and with_check like '%pending%'),
         (select coalesce(string_agg(policyname || ' :: ' || coalesce(with_check, '-'), ' | '), '(no INSERT policy)')
            from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT'));

select t('idempotency :: game_states carries the call idempotency key',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'game_states'
                    and column_name = 'last_call_request_id'),
         'without a persisted key compared under the row lock, a client-side key is decoration');

select t('idempotency :: the key is NOT mirrored to the public table',
         not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'game_states_public'
                        and column_name = 'last_call_request_id'),
         'no public surface reads it and it is a host concern');

select t('idempotency :: only the three-argument call_next_number exists',
         (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'call_next_number'),
         (select string_agg(pg_get_function_identity_arguments(p.oid), ' | ') from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'call_next_number'));

select t('idempotency :: only the eight-argument record_winner_atomic exists',
         (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_winner_atomic'),
         (select string_agg(pg_get_function_identity_arguments(p.oid), ' | ') from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_winner_atomic'));

select t('privacy :: winners is NOT readable without a staff role',
         not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'winners' and cmd = 'SELECT'
                        and coalesce(qual, '') = 'true'),
         (select coalesce(string_agg(policyname || ' :: ' || coalesce(qual, '-'), ' | '), '(no SELECT policy)')
            from pg_policies where schemaname = 'public' and tablename = 'winners' and cmd = 'SELECT'));
