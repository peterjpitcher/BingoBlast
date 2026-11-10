-- @anchor-nights/kit auth 02: the auth event audit table, the login and
-- reset throttle that reads it, and retention.
--
-- Standard sections 7 and 11; spec S1.7.
--
--   * Append-only for every API role: the service role may insert and read,
--     never update or delete. Active admins read through RLS.
--   * Pre-authentication events (a failed sign-in, a reset request) carry an
--     HMAC-SHA-256 pseudonym of the email (email_hmac), never the address.
--     Signed-in actors keep their plaintext email for attribution.
--   * The throttle counts failures in this table, so it is shared by every
--     server instance with no extra store. Defaults are the standard's:
--     10 failures in 15 minutes per email and IP, 20 per email, 50 per IP.
--     A success clears the pair and email counts only, never the IP count.
--   * Retention: sign-in telemetry (sign_in, sign_out) 12 months, every other
--     event 6 years; kit_prune_auth_data() deletes, run daily by the app.
--   * Rollback: drop the functions, then the table once no code writes it.

create table if not exists public.auth_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  occurred_at timestamptz not null default now(),
  app text not null check (length(app) between 1 and 60),
  environment text not null check (length(environment) between 1 and 30),
  event text not null check (event in (
    'sign_in', 'sign_out', 'password_reset_requested', 'password_recovery_confirmed',
    'password_updated', 'invite_sent', 'invite_accepted', 'invite_cancelled',
    'account_banned', 'account_unbanned', 'account_deactivated', 'account_reactivated',
    'role_changed', 'email_changed', 'account_deleted', 'sessions_revoked',
    'captcha_bypass_detected', 'breach_check_unavailable', 'limiter_unavailable'
  )),
  outcome text not null check (outcome in ('success', 'failure', 'denied', 'error')),
  reason text check (reason is null or length(reason) <= 200),
  actor_user_id uuid,
  actor_email text check (actor_email is null or length(actor_email) <= 320),
  email_hmac text check (email_hmac is null or email_hmac ~ '^v[0-9]+:[0-9a-f]{64}$'),
  target_user_id uuid,
  target_email text check (target_email is null or length(target_email) <= 320),
  operation_id uuid,
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);

create index if not exists auth_audit_email_window on public.auth_audit (email_hmac, event, occurred_at desc)
  where email_hmac is not null;
create index if not exists auth_audit_ip_window on public.auth_audit (ip, event, occurred_at desc)
  where ip is not null;
create index if not exists auth_audit_occurred_at on public.auth_audit (occurred_at);

alter table public.auth_audit enable row level security;
revoke all on table public.auth_audit from public, anon, authenticated, service_role;
grant select, insert on table public.auth_audit to service_role;
grant select on table public.auth_audit to authenticated;

drop policy if exists kit_auth_audit_admin_read on public.auth_audit;
create policy kit_auth_audit_admin_read on public.auth_audit
  for select to authenticated
  using ((select public.is_active_admin()));
drop policy if exists active_staff_gate on public.auth_audit;
create policy active_staff_gate on public.auth_audit
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- Seconds to wait before another attempt, or 0 when it may go ahead.
-- p_scope 'sign_in': the standard's three buckets over 15 minutes.
-- p_scope 'password_reset': one request per email a minute, 20 per IP in
-- 15 minutes (the kit's defaults, see the README).
create or replace function public.kit_auth_throttle(p_scope text, p_email_hmac text, p_ip text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window constant interval := interval '15 minutes';
  v_since timestamptz := pg_catalog.now() - v_window;
  v_last_success timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_wait integer := 0;
begin
  if p_scope = 'sign_in' then
    if p_email_hmac is not null then
      select max(occurred_at) into v_last_success
      from public.auth_audit
      where event = 'sign_in' and outcome = 'success' and email_hmac = p_email_hmac and occurred_at > v_since;

      select count(*), min(occurred_at) into v_count, v_oldest
      from public.auth_audit
      where event = 'sign_in' and outcome = 'failure' and email_hmac = p_email_hmac
        and ip is not distinct from p_ip
        and occurred_at > greatest(v_since, coalesce(v_last_success, v_since));
      if v_count >= 10 then
        v_wait := greatest(v_wait, 1, ceil(extract(epoch from (v_oldest + v_window - pg_catalog.now())))::integer);
      end if;

      select count(*), min(occurred_at) into v_count, v_oldest
      from public.auth_audit
      where event = 'sign_in' and outcome = 'failure' and email_hmac = p_email_hmac
        and occurred_at > greatest(v_since, coalesce(v_last_success, v_since));
      if v_count >= 20 then
        v_wait := greatest(v_wait, 1, ceil(extract(epoch from (v_oldest + v_window - pg_catalog.now())))::integer);
      end if;
    end if;

    if p_ip is not null then
      select count(*), min(occurred_at) into v_count, v_oldest
      from public.auth_audit
      where event = 'sign_in' and outcome = 'failure' and ip = p_ip and occurred_at > v_since;
      if v_count >= 50 then
        v_wait := greatest(v_wait, 1, ceil(extract(epoch from (v_oldest + v_window - pg_catalog.now())))::integer);
      end if;
    end if;
  elsif p_scope = 'password_reset' then
    if p_email_hmac is not null then
      select max(occurred_at) into v_oldest
      from public.auth_audit
      where event = 'password_reset_requested' and email_hmac = p_email_hmac
        and occurred_at > pg_catalog.now() - interval '60 seconds';
      if v_oldest is not null then
        v_wait := greatest(v_wait, 1, ceil(extract(epoch from (v_oldest + interval '60 seconds' - pg_catalog.now())))::integer);
      end if;
    end if;
    if p_ip is not null then
      select count(*), min(occurred_at) into v_count, v_oldest
      from public.auth_audit
      where event = 'password_reset_requested' and ip = p_ip and occurred_at > v_since;
      if v_count >= 20 then
        v_wait := greatest(v_wait, 1, ceil(extract(epoch from (v_oldest + v_window - pg_catalog.now())))::integer);
      end if;
    end if;
  else
    raise exception 'kit_unknown_throttle_scope' using errcode = '22023';
  end if;

  return greatest(v_wait, 0);
end;
$$;
revoke all on function public.kit_auth_throttle(text, text, text) from public, anon, authenticated;
grant execute on function public.kit_auth_throttle(text, text, text) to service_role;
