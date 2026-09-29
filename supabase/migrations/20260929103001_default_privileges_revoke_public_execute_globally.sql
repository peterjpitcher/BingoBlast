-- Stop new functions granting EXECUTE to PUBLIC, which anon inherits.
--
-- WHY
--   20260905053040 ran `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE
--   ON FUNCTIONS FROM PUBLIC`, and it did nothing. Default privileges set for a
--   schema are ADDED to the global ones and cannot take away a privilege granted
--   globally, and EXECUTE for PUBLIC on every new function is Postgres's built-in
--   global default. With no global pg_default_acl row to override it, a function
--   created by postgres in public still gets PUBLIC EXECUTE, and anon is a member
--   of PUBLIC, so anon can call it with nobody having granted anything.
--
--   Found on 29 September 2026 on a fresh `supabase start` (CLI 2.108, image
--   postgres 17.6.1.139) with every migration applied: a new function came out
--   with a NULL proacl (the built-in default) and
--   has_function_privilege('anon', fn, 'EXECUTE') was true. Production behaves
--   the same: read-only on bcmorqsgeumtmhvctvgu the same day, pg_default_acl
--   holds no global row at all, and for postgres-owned functions only
--   `postgres/public/f {postgres=X, authenticated=X, service_role=X}`, so a new
--   function there would read {=X/postgres, postgres=X, authenticated=X,
--   service_role=X}. Nothing is exposed today, because every migration in this
--   repository revokes PUBLIC by hand. The risk is the next function someone
--   creates without that line.
--
-- WHAT THIS CHANGES
--   One global default for the postgres role: new functions it creates, in any
--   schema, no longer grant EXECUTE to PUBLIC. The per-schema grants still add on
--   top, so in public a new function reads {postgres=X, authenticated=X,
--   service_role=X} on production and {postgres=X} on a project built from the
--   current image. A function the public site genuinely needs must carry an
--   explicit GRANT, which is the point. Existing functions are untouched:
--   default privileges only apply when an object is created.
--
--   Checked before choosing the global form, because it reaches beyond public:
--     extensions  postgres owns pgcrypto, uuid-ossp and pg_stat_statements on
--                 production, all at their latest version, so no pending update
--                 can create a function under the new default. A NEW extension
--                 is owned by supabase_admin on the current image (citext and
--                 pg_trgm both were, created as postgres on 17.6.1.139), so its
--                 functions keep PUBLIC EXECUTE exactly as before. Only a
--                 function someone writes into extensions by hand as postgres
--                 would need an explicit grant, the same as in public.
--     graphql, graphql_public, realtime, vault, pgbouncer, auth, storage
--                 functions there are owned by supabase_admin or a Supabase
--                 service role, and postgres cannot create in any of them, so
--                 they are unaffected.
--
--   supabase_admin is deliberately left alone. Its default privileges in public
--   grant anon EXECUTE outright, but postgres is not a member of supabase_admin
--   on production (checked with pg_has_role), so a migration cannot change them:
--   the statement would fail. Nothing in this repository creates functions as
--   supabase_admin. replay.test.sql keeps that gap visible.
--
-- GUARDED
--   It refuses to run as any role but postgres, because the proof below creates a
--   function as the current role and would test the wrong defaults otherwise. It
--   then creates a probe function in public and raises, rolling the whole
--   migration back, if the probe carries a PUBLIC grant or anon can execute it.
--   The probe is dropped in the same transaction, so nobody ever sees it.
--
-- IDEMPOTENT: yes. Revoking what is already revoked leaves the same global row.
--
-- ROLLBACK (restores exactly the state before this ran: no global row)
--   alter default privileges for role postgres grant execute on functions to public;
--   Re-granting PUBLIC makes the global ACL equal to the built-in default, and
--   Postgres removes such a row rather than storing it.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'default_privileges_revoke_public_execute_globally: run as postgres, not %', current_user;
  end if;
end;
$$;

alter default privileges for role postgres revoke execute on functions from public;

-- Prove the behaviour rather than trusting the statement above. has_function_privilege
-- answers what anon can actually do, including anything inherited via PUBLIC.
do $$
declare
  v_acl aclitem[];
begin
  create function public.default_privileges_probe() returns int
    language sql immutable as 'select 1';

  select proacl into v_acl from pg_proc
   where oid = 'public.default_privileges_probe()'::regprocedure;

  if v_acl is null or exists (select 1 from aclexplode(v_acl) a where a.grantee = 0) then
    raise exception 'default_privileges_revoke_public_execute_globally: a new function in public still grants PUBLIC EXECUTE (proacl %)',
      coalesce(v_acl::text, 'NULL, the built-in default');
  end if;

  if has_function_privilege('anon', 'public.default_privileges_probe()', 'EXECUTE') then
    raise exception 'default_privileges_revoke_public_execute_globally: anon can execute a new function in public (proacl %)',
      v_acl::text;
  end if;

  drop function public.default_privileges_probe();
end;
$$;
