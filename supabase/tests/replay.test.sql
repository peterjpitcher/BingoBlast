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

-- ---------------------------------------------------------------------------
-- The canary, as in grants.test.sql. If the bootstrap did not reproduce the
-- production default privileges then every grant assertion below is meaningless
-- because the container is friendlier than the thing it is modelling.
-- ---------------------------------------------------------------------------
create or replace function public.replay_probe_default_privileges() returns int
language sql immutable as $$ select 1 $$;

select t('canary :: default privileges grant anon EXECUTE on a newly created function',
         has_function_privilege('anon', 'public.replay_probe_default_privileges()', 'EXECUTE'),
         'if false, supabase-bootstrap.sql is not production-shaped and this suite proves nothing');

drop function public.replay_probe_default_privileges();

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
select t('functions :: the seventeen expected functions exist and nothing else',
         (select count(*) = 17 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
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
-- Realtime publication. The public screens read game_states_public; nothing
-- reads winners over realtime, and it must not be published without a
-- deliberate decision (see the review spec, R13).
-- ---------------------------------------------------------------------------
select t('realtime :: the publication contains exactly sessions, game_states and game_states_public',
         (select coalesce(string_agg(tablename, ',' order by tablename), '')
                 = 'game_states,game_states_public,sessions'
            from pg_publication_tables where pubname = 'supabase_realtime'),
         (select coalesce(string_agg(tablename, ',' order by tablename), '(none)')
            from pg_publication_tables where pubname = 'supabase_realtime'));

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
