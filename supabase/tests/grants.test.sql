-- Grant assertions for the four host RPCs created by
-- 20260729120000_atomic_host_mutations.sql and hardened by
-- 20260730130000_revoke_anon_host_rpcs.sql.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project.
--
-- This file asserts the CLEAN end state and is deliberately re-runnable: run.sh
-- calls it at several points in the sequence (fresh build, after the drift
-- repair, and again after a second apply to prove idempotency), each time with
-- -v phase='...' so the results table says which pass a failure came from.
--
-- What it is proving, in one line: anon can execute none of the four, in any
-- overload, while authenticated and service_role can execute all of them.
--
-- Every assertion lands in test_results. run.sh fails the run on any false row.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- run.sh always supplies this. Guard anyway so a hand-run says so rather than
-- failing on an unbound variable.
\if :{?phase}
\else
  \set phase 'unnamed phase'
\endif

-- ---------------------------------------------------------------------------
-- The canary. harness-schema.sql sets ALTER DEFAULT PRIVILEGES exactly as
-- production has it and then creates probe_default_privileges() with no grant of
-- its own. If anon cannot execute it, the container is NOT reproducing the
-- production default privileges and every other assertion below passes for the
-- wrong reason. This one must be true in every phase, including after the
-- hardening migration: the migration revokes from four named functions, it does
-- not and must not change the default privileges themselves.
-- ---------------------------------------------------------------------------
select t(:'phase' || ' :: default privileges still grant anon EXECUTE on a new function',
         has_function_privilege('anon', 'public.probe_default_privileges()', 'EXECUTE'),
         'if false, the harness is not production-shaped and the run proves nothing');

-- ---------------------------------------------------------------------------
-- Per-function grants, across every overload present. Overload coverage is the
-- point rather than pedantry: production carries the eight-argument
-- record_winner_atomic from winner_idempotency_key while this repo's history
-- still builds the seven-argument one, so a check pinned to one signature would
-- pass against a database that is still open on the other.
-- ---------------------------------------------------------------------------
create or replace view host_rpc_grants as
with expected(fname) as (
  values ('assert_is_host'),
         ('call_next_number'),
         ('void_last_number'),
         ('record_winner_atomic')
)
select e.fname,
       p.oid,
       p.oid::regprocedure::text as signature,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') as svc_exec,
       -- PUBLIC is a separate grantee from anon; the original migration revoked
       -- from it and nothing here should have handed it back. A NULL proacl is
       -- the owner default, which for a function means PUBLIC DOES hold EXECUTE,
       -- so it counts as true rather than as "no grants".
       (p.proacl is null
        or p.proacl::text[] && array['=X/postgres']) as public_exec
  from expected e
  left join pg_proc p
         on p.proname = e.fname
        and p.pronamespace = 'public'::regnamespace
        and p.prokind = 'f';

-- Every expected function still exists. Catches a phase that silently dropped
-- one, which would otherwise make the anon assertions vacuously true.
select t(:'phase' || ' :: all four host RPCs exist',
         count(*) filter (where oid is null) = 0,
         'missing: ' || coalesce(string_agg(fname, ', ') filter (where oid is null), 'none')
           || ' | present: ' || coalesce(string_agg(signature, ' | ') filter (where oid is not null), 'none'))
  from host_rpc_grants;

-- The assertion this whole exercise is for.
select t(:'phase' || ' :: anon cannot EXECUTE ' || fname,
         count(*) filter (where anon_exec) = 0,
         'overloads=' || count(*)
           || ' anon_executable=' || count(*) filter (where anon_exec)
           || coalesce(' -> ' || string_agg(signature, ' | ') filter (where anon_exec), ''))
  from host_rpc_grants
 where oid is not null
 group by fname;

-- The host UI must keep working. A revoke that took authenticated with it would
-- break every call, undo and winner in the pub.
select t(:'phase' || ' :: authenticated and service_role can EXECUTE ' || fname,
         count(*) filter (where auth_exec) = count(*)
           and count(*) filter (where svc_exec) = count(*),
         'overloads=' || count(*)
           || ' authenticated=' || count(*) filter (where auth_exec)
           || ' service_role=' || count(*) filter (where svc_exec))
  from host_rpc_grants
 where oid is not null
 group by fname;

-- PUBLIC was revoked by the original migration and must stay revoked.
select t(:'phase' || ' :: PUBLIC holds no EXECUTE on any host RPC',
         count(*) filter (where public_exec) = 0,
         'public_executable=' || count(*) filter (where public_exec))
  from host_rpc_grants
 where oid is not null;
