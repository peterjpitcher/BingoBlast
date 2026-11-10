-- @anchor-nights/kit pairing 02: the pairing functions.
--
-- Spec S3.1 and K5 (pairing). Every function is SECURITY DEFINER with an
-- empty search_path and fully qualified names, revoked from public, anon and
-- authenticated, and granted to the service role only: the app's server
-- calls them after its own checks, and the staff checks here are a second
-- wall, not the only one.
--
--   kit_tv_issue_code      an unpaired TV asks for a code (10 per IP in 10
--                          minutes; at most 200 live codes at once)
--   kit_tv_pair            a host types the code: approves it, or counts a
--                          wrong attempt (5 wrong in 15 minutes locks the
--                          user and the IP; every live code dies after 5
--                          wrong attempts made while it was live)
--   kit_tv_claim           the TV polls with its pairing secret; an approved
--                          code becomes a device (one poll a second at most)
--   kit_tv_device_seen     the device for a token, last_seen_at at most once
--                          a minute; nothing for a revoked device
--   kit_tv_list_devices    the admin list
--   kit_tv_revoke          an admin revokes a device
--   kit_tv_prune_pairing   daily clean-up

create or replace function public.kit_tv_issue_code(
  p_code_hash text,
  p_secret_hash text,
  p_ip text,
  p_previous_secret_hash text default null,
  p_ttl_seconds integer default 600
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 600 then
    raise exception 'kit_invalid_ttl' using errcode = '22023';
  end if;

  if (
    select count(*) from public.tv_pairing_codes c
    where c.requested_ip is not distinct from p_ip
      and c.created_at > pg_catalog.now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'kit_tv_code_rate_limited' using errcode = '54000';
  end if;

  update public.tv_pairing_codes
    set status = 'expired'
    where status = 'waiting' and expires_at <= pg_catalog.now();

  if p_previous_secret_hash is not null then
    update public.tv_pairing_codes
      set status = 'replaced'
      where secret_hash = p_previous_secret_hash and status = 'waiting';
  end if;

  if (select count(*) from public.tv_pairing_codes c where c.status = 'waiting') >= 200 then
    raise exception 'kit_tv_code_capacity' using errcode = '54000';
  end if;

  begin
    insert into public.tv_pairing_codes (code_hash, secret_hash, requested_ip, expires_at)
      values (p_code_hash, p_secret_hash, p_ip, pg_catalog.now() + make_interval(secs => p_ttl_seconds))
      returning expires_at into v_expires;
  exception when unique_violation then
    -- Another screen is showing this code right now: the server draws again.
    raise exception 'kit_tv_code_collision' using errcode = '23505';
  end;
  return v_expires;
end;
$$;
revoke all on function public.kit_tv_issue_code(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.kit_tv_issue_code(text, text, text, text, integer) to service_role;

-- 'paired' or 'wrong'. Raises kit_tv_not_staff, kit_tv_invalid_name or
-- kit_tv_pair_locked.
create or replace function public.kit_tv_pair(p_code_hash text, p_device_name text, p_user uuid, p_ip text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_device_name, ''));
  v_code uuid;
begin
  if p_user is null or coalesce(public.kit_staff_role_for(p_user), 'pending') not in ('admin', 'host') then
    raise exception 'kit_tv_not_staff' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'kit_tv_invalid_name' using errcode = '22023';
  end if;

  if (
    select count(*) from public.tv_pairing_attempts a
    where a.outcome = 'wrong' and a.user_id = p_user
      and a.occurred_at > pg_catalog.now() - interval '15 minutes'
  ) >= 5 or (
    p_ip is not null and (
      select count(*) from public.tv_pairing_attempts a
      where a.outcome = 'wrong' and a.ip = p_ip
        and a.occurred_at > pg_catalog.now() - interval '15 minutes'
    ) >= 5
  ) then
    raise exception 'kit_tv_pair_locked' using errcode = '54000';
  end if;

  select c.id into v_code
    from public.tv_pairing_codes c
    where c.code_hash = p_code_hash
      and c.status = 'waiting'
      and c.expires_at > pg_catalog.now()
    for update;

  if v_code is null then
    insert into public.tv_pairing_attempts (user_id, ip, outcome) values (p_user, p_ip, 'wrong');
    -- Any live code could have been the target, so each one counts it.
    update public.tv_pairing_codes
      set wrong_attempts = wrong_attempts + 1,
          status = case when wrong_attempts + 1 >= 5 then 'burnt' else status end
      where status = 'waiting' and expires_at > pg_catalog.now();
    return 'wrong';
  end if;

  update public.tv_pairing_codes
    set status = 'approved', approved_by = p_user, approved_at = pg_catalog.now(), device_name = v_name
    where id = v_code;
  insert into public.tv_pairing_attempts (user_id, ip, outcome) values (p_user, p_ip, 'paired');
  return 'paired';
end;
$$;
revoke all on function public.kit_tv_pair(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.kit_tv_pair(text, text, uuid, text) to service_role;

-- The TV's poll. status is one of: waiting, paired (with the new device),
-- expired (ask for a new code), unknown (no such code), slow_down.
create or replace function public.kit_tv_claim(p_secret_hash text, p_device_token_hash text)
returns table (status text, device_id uuid, device_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tv_pairing_codes%rowtype;
  v_device uuid;
begin
  select * into v_row from public.tv_pairing_codes c where c.secret_hash = p_secret_hash for update;
  if not found or v_row.status in ('claimed', 'replaced') then
    return query select 'unknown'::text, null::uuid, null::text;
    return;
  end if;
  if v_row.last_polled_at is not null and v_row.last_polled_at > pg_catalog.now() - interval '1 second' then
    return query select 'slow_down'::text, null::uuid, null::text;
    return;
  end if;

  update public.tv_pairing_codes
    set poll_count = poll_count + 1, last_polled_at = pg_catalog.now()
    where id = v_row.id;

  if v_row.status = 'approved'
    and pg_catalog.now() < greatest(v_row.expires_at, v_row.approved_at + interval '2 minutes')
    and coalesce(public.kit_staff_role_for(v_row.approved_by), 'pending') in ('admin', 'host')
  then
    insert into public.tv_devices (name, token_hash, created_by)
      values (v_row.device_name, p_device_token_hash, v_row.approved_by)
      returning id into v_device;
    update public.tv_pairing_codes
      set status = 'claimed', claimed_at = pg_catalog.now(), device_id = v_device
      where id = v_row.id;
    return query select 'paired'::text, v_device, v_row.device_name;
    return;
  end if;

  if v_row.status = 'waiting' and v_row.expires_at > pg_catalog.now() and v_row.poll_count < 400 then
    return query select 'waiting'::text, null::uuid, null::text;
    return;
  end if;

  update public.tv_pairing_codes c
    set status = 'expired'
    where c.id = v_row.id and c.status in ('waiting', 'approved');
  return query select 'expired'::text, null::uuid, null::text;
end;
$$;
revoke all on function public.kit_tv_claim(text, text) from public, anon, authenticated;
grant execute on function public.kit_tv_claim(text, text) to service_role;

create or replace function public.kit_tv_device_seen(p_token_hash text)
returns table (id uuid, name text, created_at timestamptz, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tv_devices d
    set last_seen_at = pg_catalog.now()
    where d.token_hash = p_token_hash
      and d.revoked_at is null
      and (d.last_seen_at is null or d.last_seen_at < pg_catalog.now() - interval '1 minute');
  return query
    select d.id, d.name, d.created_at, d.last_seen_at
    from public.tv_devices d
    where d.token_hash = p_token_hash and d.revoked_at is null;
end;
$$;
revoke all on function public.kit_tv_device_seen(text) from public, anon, authenticated;
grant execute on function public.kit_tv_device_seen(text) to service_role;

create or replace function public.kit_tv_list_devices(p_include_revoked boolean default false)
returns table (
  id uuid,
  name text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.name, d.created_by, u.email::text, d.created_at, d.last_seen_at, d.revoked_at
  from public.tv_devices d
  left join auth.users u on u.id = d.created_by
  where p_include_revoked or d.revoked_at is null
  order by d.revoked_at is not null, d.created_at desc
$$;
revoke all on function public.kit_tv_list_devices(boolean) from public, anon, authenticated;
grant execute on function public.kit_tv_list_devices(boolean) to service_role;

-- The device's name, or null when there is no such live device.
create or replace function public.kit_tv_revoke(p_device uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_user is null or coalesce(public.kit_staff_role_for(p_user), 'pending') <> 'admin' then
    raise exception 'kit_tv_not_admin' using errcode = '42501';
  end if;
  update public.tv_devices
    set revoked_at = pg_catalog.now(), revoked_by = p_user
    where id = p_device and revoked_at is null
    returning name into v_name;
  return v_name;
end;
$$;
revoke all on function public.kit_tv_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kit_tv_revoke(uuid, uuid) to service_role;

create or replace function public.kit_tv_prune_pairing()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes integer;
  v_attempts integer;
  v_devices integer;
begin
  delete from public.tv_pairing_codes where created_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_codes = row_count;
  delete from public.tv_pairing_attempts where occurred_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_attempts = row_count;
  delete from public.tv_devices where revoked_at < pg_catalog.now() - interval '12 months';
  get diagnostics v_devices = row_count;
  return jsonb_build_object('codes', v_codes, 'attempts', v_attempts, 'revoked_devices', v_devices);
end;
$$;
revoke all on function public.kit_tv_prune_pairing() from public, anon, authenticated;
grant execute on function public.kit_tv_prune_pairing() to service_role;
