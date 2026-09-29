-- The default-privilege gap: how it opened, why the first fix missed, and that
-- the second one closes it.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project. run.sh runs this file three times in phase 6, with -v stage=:
--
--   open             the harness as built, carrying production's default
--                    privileges from before September. A new function in public
--                    is anon-callable with nobody having granted anything.
--   per_schema_only  after 20260905053040 alone. It revoked EXECUTE from anon AND
--                    from PUBLIC, but only per schema, and a per-schema default
--                    cannot take away what the built-in global default grants.
--                    PUBLIC keeps EXECUTE, anon is a member of PUBLIC, so the gap
--                    is still open. This stage exists so that mistake cannot be
--                    made again unnoticed.
--   closed           after 20260929101722, which revokes PUBLIC globally for
--                    postgres. A new function is no longer anon-callable.
--
-- The explicit pair, `revoke ... from public` and `revoke ... from anon`, is
-- asserted at every stage: it is still the shape every restricted function in
-- this repository writes, whatever the defaults do.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- A missing or unknown stage must fail the run, not skip the assertions: run.sh
-- uses ON_ERROR_STOP, so an exception here stops it.
\if :{?stage}
\else
  \set stage missing
\endif

create or replace function pg_temp.acl_of(p_fn regprocedure) returns text
language sql stable as $$
  select coalesce((select proacl::text from pg_proc where oid = p_fn),
                  'NULL, the built-in default, which grants PUBLIC')
$$;

create or replace function pg_temp.grants_public(p_fn regprocedure) returns boolean
language sql stable as $$
  select p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
    from pg_proc p where p.oid = p_fn
$$;

create or replace function pg_temp.grants_anon_by_name(p_fn regprocedure) returns boolean
language sql stable as $$
  select p.proacl is not null
         and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'anon'::regrole::oid)
    from pg_proc p where p.oid = p_fn
$$;

-- A brand new function, with no grant or revoke written. This is what the next
-- host RPC walks into.
create or replace function public.gap_probe_new()
returns boolean language sql immutable as $$ select true $$;

select :'stage' = 'open' as is_open,
       :'stage' = 'per_schema_only' as is_per_schema_only,
       :'stage' = 'closed' as is_closed
\gset

\if :is_open
select t('convention gap [open] :: a NEW function is anon-callable with no grant written',
         has_function_privilege('anon', 'public.gap_probe_new()', 'EXECUTE'),
         'if false, the harness is not production-shaped and phase 6 proves nothing. ACL: '
           || pg_temp.acl_of('public.gap_probe_new()'));

select t('convention gap [open] :: anon holds that EXECUTE in its own name, from the per-schema default',
         pg_temp.grants_anon_by_name('public.gap_probe_new()'),
         'ACL: ' || pg_temp.acl_of('public.gap_probe_new()'));
\elif :is_per_schema_only
select t('convention gap [per_schema_only] :: after 20260905053040 alone, a NEW function is STILL anon-callable',
         has_function_privilege('anon', 'public.gap_probe_new()', 'EXECUTE'),
         'if false, a per-schema revoke now removes the built-in PUBLIC grant and 20260929101722 was unnecessary. ACL: '
           || pg_temp.acl_of('public.gap_probe_new()'));

select t('convention gap [per_schema_only] :: anon no longer holds it by name, only through PUBLIC',
         not pg_temp.grants_anon_by_name('public.gap_probe_new()')
           and pg_temp.grants_public('public.gap_probe_new()'),
         'ACL: ' || pg_temp.acl_of('public.gap_probe_new()'));
\elif :is_closed
select t('convention gap [closed] :: after 20260929101722, a NEW function is NOT anon-callable',
         not has_function_privilege('anon', 'public.gap_probe_new()', 'EXECUTE'),
         'ACL: ' || pg_temp.acl_of('public.gap_probe_new()'));

select t('convention gap [closed] :: and carries no PUBLIC grant',
         not pg_temp.grants_public('public.gap_probe_new()'),
         'ACL: ' || pg_temp.acl_of('public.gap_probe_new()'));

select t('convention gap [closed] :: authenticated and service_role keep EXECUTE from the per-schema default',
         has_function_privilege('authenticated', 'public.gap_probe_new()', 'EXECUTE')
           and has_function_privilege('service_role', 'public.gap_probe_new()', 'EXECUTE'),
         'the global revoke must take PUBLIC only. ACL: ' || pg_temp.acl_of('public.gap_probe_new()'));
\else
do $$ begin
  raise exception 'convention-gap.test.sql needs -v stage=open, per_schema_only or closed';
end $$;
\endif

-- Revoking PUBLIC and anon together closes it at every stage, which is the
-- shape the convention still requires of every restricted function.
create or replace function public.gap_probe_pair()
returns boolean language sql immutable as $$ select true $$;

revoke execute on function public.gap_probe_pair() from public;
revoke execute on function public.gap_probe_pair() from anon;

select t('convention gap [' || :'stage' || '] :: revoking PUBLIC and anon together closes it',
         not has_function_privilege('anon', 'public.gap_probe_pair()', 'EXECUTE'),
         'ACL: ' || pg_temp.acl_of('public.gap_probe_pair()'));

drop function public.gap_probe_new();
drop function public.gap_probe_pair();
