-- @anchor-nights/kit pairing 01: paired TVs and their pairing codes.
--
-- Spec S3.1 and K5 (pairing). Apply after the kit auth migrations: the
-- functions in 02 use kit_staff_role_for() from auth 01.
--
--   * tv_devices: one row per paired screen. The TV holds an opaque 256-bit
--     device token in an httpOnly cookie; only its SHA-256 hash is stored
--     here. Revoking sets revoked_at, and the next request from that TV is
--     unpaired.
--   * tv_pairing_codes: the 6-digit code an unpaired TV shows, for 10
--     minutes, single use. The code is stored as a SHA-256 hash, and the TV
--     proves it is the screen that asked for the code with a second 256-bit
--     secret (its pairing cookie), also stored only as a hash. A host typing
--     the code approves it; the TV's next poll turns the approval into a
--     device. States: waiting -> approved -> claimed, with terminal expired,
--     burnt (5 wrong attempts were made while it was live) and replaced (the
--     same TV asked for a new code).
--   * tv_pairing_attempts: every code a host typed, right or wrong, with the
--     user and IP. Five wrong in 15 minutes locks that user, and that IP.
--   * Service role only: no API role can read or write any of the three, and
--     RLS is on with no policies as a second wall.
--   * IP addresses are kept 1 day on codes and 30 days on attempts
--     (kit_tv_prune_pairing in 02). Rollback: drop the functions, then the
--     three tables.

do $$
begin
  if to_regprocedure('public.kit_staff_role_for(uuid)') is null then
    raise exception 'kit pairing: apply the kit auth migrations first (public.kit_staff_role_for(uuid) is missing)';
  end if;
end $$;

create table if not exists public.tv_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 40),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  check (revoked_by is null or revoked_at is not null)
);

create index if not exists tv_devices_active on public.tv_devices (created_at)
  where revoked_at is null;

create table if not exists public.tv_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'waiting'
    check (status in ('waiting', 'approved', 'claimed', 'expired', 'burnt', 'replaced')),
  requested_ip text check (requested_ip is null or length(requested_ip) <= 64),
  wrong_attempts integer not null default 0 check (wrong_attempts between 0 and 5),
  poll_count integer not null default 0 check (poll_count >= 0),
  last_polled_at timestamptz,
  device_name text check (device_name is null or (device_name = btrim(device_name) and length(device_name) between 1 and 40)),
  approved_by uuid,
  approved_at timestamptz,
  device_id uuid references public.tv_devices (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (status not in ('approved', 'claimed') or (approved_by is not null and approved_at is not null and device_name is not null)),
  check (status <> 'claimed' or claimed_at is not null)
);

-- Two screens can never show the same live code, so a typed code names one TV.
create unique index if not exists tv_pairing_codes_one_live_per_code on public.tv_pairing_codes (code_hash)
  where status = 'waiting';
create index if not exists tv_pairing_codes_by_ip on public.tv_pairing_codes (requested_ip, created_at);

create table if not exists public.tv_pairing_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  ip text check (ip is null or length(ip) <= 64),
  outcome text not null check (outcome in ('paired', 'wrong')),
  occurred_at timestamptz not null default now()
);

create index if not exists tv_pairing_attempts_by_user on public.tv_pairing_attempts (user_id, occurred_at);
create index if not exists tv_pairing_attempts_by_ip on public.tv_pairing_attempts (ip, occurred_at);

alter table public.tv_devices enable row level security;
alter table public.tv_pairing_codes enable row level security;
alter table public.tv_pairing_attempts enable row level security;

revoke all on table public.tv_devices from public, anon, authenticated;
revoke all on table public.tv_pairing_codes from public, anon, authenticated;
revoke all on table public.tv_pairing_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.tv_devices to service_role;
grant select, insert, update, delete on table public.tv_pairing_codes to service_role;
grant select, insert, delete on table public.tv_pairing_attempts to service_role;
