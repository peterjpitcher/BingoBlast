-- Stop new objects granting themselves to anon.
--
-- Applied to production on 5 September 2026. Supabase grants the anon role every
-- privilege on each new table and EXECUTE on each new function created in this
-- schema, so the public surface widened on its own with every migration. That is
-- the root cause behind the anon exposures found across this workspace: grants
-- were clawed back object by object, and the next migration re-armed them.
--
-- Existing objects are untouched. From here a new table or function that the
-- public site genuinely needs must carry an explicit GRANT, which is the point.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
