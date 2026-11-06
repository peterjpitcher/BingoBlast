-- Somewhere for technical failures to land: public.app_errors.
--
-- WHY
--   src/lib/report-error.ts posts every reported failure to ERROR_SINK_URL.
--   That variable has never been set in production, so nothing was recorded
--   beyond Vercel's short log retention. Spec assumption A3 (Anchor Nights
--   standard, 6 November 2026) puts the reports in each app's own database,
--   listed on the admin page, at no cost. This is that table. The route that
--   writes it is src/app/api/errors/route.ts.
--
-- WHO CAN TOUCH IT
--   Only the service role writes it, from that route, after validating and
--   redacting the payload. anon and authenticated hold NO privilege on the
--   table at all (revoked explicitly, because production's default privileges
--   would otherwise hand them everything), and RLS is on with no policy, so
--   even a stray grant later would read and write nothing. Admins read it only
--   through list_app_errors_safe(), which checks assert_is_admin() first, the
--   same shape as the other admin *_safe functions.
--
-- WHAT IS STORED
--   Redacted text only: the route strips uuids, email addresses, phone
--   numbers and pound amounts before the insert, as report-error.ts already
--   does before it posts. No player data exists in this app to leak, and the
--   length checks below keep a runaway payload from filling the table.
--
-- ROLLBACK
--   drop function if exists public.list_app_errors_safe(integer);
--   drop table if exists public.app_errors;
--   Both are new and nothing else depends on them; the reports are lost.

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  message text not null,
  digest text,
  path text,
  context jsonb not null default '{}'::jsonb,
  user_agent text,
  constraint app_errors_source_length check (char_length(source) between 1 and 120),
  constraint app_errors_message_length check (char_length(message) between 1 and 2000),
  constraint app_errors_digest_length check (digest is null or char_length(digest) <= 200),
  constraint app_errors_path_length check (path is null or char_length(path) <= 500),
  constraint app_errors_user_agent_length check (user_agent is null or char_length(user_agent) <= 300),
  constraint app_errors_context_is_object check (jsonb_typeof(context) = 'object'),
  constraint app_errors_context_size check (pg_column_size(context) <= 4096)
);

comment on table public.app_errors is
  'Redacted technical failures posted by src/lib/report-error.ts through /api/errors. Service role writes; admins read through list_app_errors_safe().';

-- The admin page reads the newest first.
create index if not exists app_errors_created_at_idx on public.app_errors (created_at desc);

alter table public.app_errors enable row level security;

revoke all on table public.app_errors from public, anon, authenticated;
grant all on table public.app_errors to service_role;

-- The admin read. Newest first, at most 200 rows, 50 by default.
create or replace function public.list_app_errors_safe(p_limit integer default 50)
returns setof public.app_errors
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_is_admin();

  return query
    select *
      from public.app_errors
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

revoke all on function public.list_app_errors_safe(integer) from public, anon;
grant execute on function public.list_app_errors_safe(integer) to authenticated, service_role;

-- Prove the end state inside the same transaction, so a wrong grant fails the
-- apply instead of shipping.
do $$
declare
  v_priv text;
begin
  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('anon', 'public.app_errors', v_priv) then
      raise exception 'app_errors: anon holds % on public.app_errors', v_priv;
    end if;
    if has_table_privilege('authenticated', 'public.app_errors', v_priv) then
      raise exception 'app_errors: authenticated holds % on public.app_errors', v_priv;
    end if;
  end loop;

  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role', 'public.app_errors', v_priv) then
      raise exception 'app_errors: service_role lacks % on public.app_errors', v_priv;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.app_errors'::regclass) then
    raise exception 'app_errors: row level security is off';
  end if;

  if has_function_privilege('anon', 'public.list_app_errors_safe(integer)', 'EXECUTE') then
    raise exception 'app_errors: anon can execute list_app_errors_safe';
  end if;
end;
$$;
