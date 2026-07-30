-- Evidence for the standing recommendation, not a check on any one migration.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project.
--
-- 20260730070705 fixed the four host RPCs that already existed. It did nothing
-- about the mechanism that put the grant there, which is still armed: the next
-- "create function" in schema public picks anon straight back up. This file
-- reproduces that in two steps so the recommendation rests on something runnable
-- rather than on an assertion in a report.
--
-- A failure here means the world got BETTER, not worse: either the default
-- privileges were changed or Postgres stopped granting PUBLIC by default. Read
-- the detail column, confirm, then delete the assertion that no longer holds.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Gap 1: a brand new function is anon-callable the moment it is created, with
-- nobody having granted anything. This is what a future host RPC walks into.
-- ---------------------------------------------------------------------------
create or replace function public.gap_probe_one()
returns boolean language sql immutable as $$ select true $$;

select t('convention gap :: a NEW function is anon-callable with no grant written',
         has_function_privilege('anon', 'public.gap_probe_one()', 'EXECUTE'),
         'ACL: ' || coalesce(
           (select array_to_string(proacl, ' | ') from pg_proc
             where oid = 'public.gap_probe_one()'::regprocedure), '(null)'));

-- ---------------------------------------------------------------------------
-- Gap 2: and "revoke ... from anon" alone is not a lockdown either, because
-- CREATE FUNCTION grants PUBLIC its own EXECUTE and anon is a member of PUBLIC.
-- Both revokes are needed. The four host RPCs are safe from this only because
-- 20260729120000 happened to revoke PUBLIC as well; a new function written
-- without that line would not be.
-- ---------------------------------------------------------------------------
create or replace function public.gap_probe_two()
returns boolean language sql immutable as $$ select true $$;

revoke execute on function public.gap_probe_two() from anon;

select t('convention gap :: revoking anon alone leaves the function reachable via PUBLIC',
         has_function_privilege('anon', 'public.gap_probe_two()', 'EXECUTE'),
         'anon still holds EXECUTE through PUBLIC. ACL: ' || coalesce(
           (select array_to_string(proacl, ' | ') from pg_proc
             where oid = 'public.gap_probe_two()'::regprocedure), '(null)'));

-- And the pair together does close it, which is the shape the convention should
-- require of every new function.
create or replace function public.gap_probe_three()
returns boolean language sql immutable as $$ select true $$;

revoke execute on function public.gap_probe_three() from public;
revoke execute on function public.gap_probe_three() from anon;

select t('convention gap :: revoking PUBLIC and anon together does close it',
         not has_function_privilege('anon', 'public.gap_probe_three()', 'EXECUTE'),
         'ACL: ' || coalesce(
           (select array_to_string(proacl, ' | ') from pg_proc
             where oid = 'public.gap_probe_three()'::regprocedure), '(null)'));

drop function public.gap_probe_one();
drop function public.gap_probe_two();
drop function public.gap_probe_three();
