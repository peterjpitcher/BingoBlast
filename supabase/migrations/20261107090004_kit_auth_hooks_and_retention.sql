-- @anchor-nights/kit auth 05: the Before User Created hook and retention.
--
-- Standard sections 10 (passwordless suppression, invite-only) and 11
-- (retention); spec S1.10.
--
--   * kit_before_user_created is set as the project's Before User Created
--     hook (Authentication, Hooks, Postgres function). It refuses every new
--     Auth user except the one an invite acceptance is creating right now
--     (an invite in accepting for that email, claimed in the last 10
--     minutes). Public sign-up, a passwordless request for an unknown
--     address and an anonymous sign-in therefore never create an account,
--     even if a dashboard setting is switched back on by mistake.
--   * Supabase's Send Email Hook replaces Auth's own mail sending entirely,
--     so it cannot be combined with the custom SMTP sender the reset emails
--     need (spec S1.10). This hook plus the neutered magic link and sign-up
--     templates plus a recovery-only /auth/confirm are the kit's layered
--     control instead; see the README.
--   * kit_prune_auth_data deletes sign-in telemetry after 12 months, every
--     other audit event after 6 years, spent recovery grants after a day and
--     finished invites after 12 months. Run it daily (an app cron route or
--     pg_cron). It is the only path that deletes from auth_audit.

create or replace function public.kit_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  v_anonymous boolean := coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false);
  v_provider text := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email');
begin
  if v_email <> '' and not v_anonymous and v_provider = 'email' and exists (
    select 1 from public.invites i
    where i.email = v_email
      and i.status = 'accepting'
      and i.accepting_at > pg_catalog.now() - interval '10 minutes'
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Accounts are created by invitation only.')
  );
end;
$$;
revoke all on function public.kit_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.kit_before_user_created(jsonb) to supabase_auth_admin;

create or replace function public.kit_prune_auth_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telemetry integer;
  v_admin integer;
  v_grants integer;
  v_invites integer;
begin
  delete from public.auth_audit
    where event in ('sign_in', 'sign_out') and occurred_at < pg_catalog.now() - interval '12 months';
  get diagnostics v_telemetry = row_count;

  delete from public.auth_audit
    where event not in ('sign_in', 'sign_out') and occurred_at < pg_catalog.now() - interval '6 years';
  get diagnostics v_admin = row_count;

  delete from public.recovery_grants
    where created_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_grants = row_count;

  delete from public.invites
    where (status in ('active', 'cancelled', 'failed')
        and coalesce(accepted_at, cancelled_at, failed_at, created_at) < pg_catalog.now() - interval '12 months')
      or (status = 'pending' and expires_at < pg_catalog.now() - interval '12 months');
  get diagnostics v_invites = row_count;

  return jsonb_build_object(
    'audit_telemetry', v_telemetry,
    'audit_admin', v_admin,
    'recovery_grants', v_grants,
    'invites', v_invites
  );
end;
$$;
revoke all on function public.kit_prune_auth_data() from public, anon, authenticated;
grant execute on function public.kit_prune_auth_data() to service_role;
