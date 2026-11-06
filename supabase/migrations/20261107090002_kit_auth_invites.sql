-- @anchor-nights/kit auth 03: invite-only accounts.
--
-- Standard section 10 (sign-up, invite-only); spec S1.3.
--
--   * An admin issues an invite from the app. The token is 256 random bits
--     shown once as a link the admin copies (text or WhatsApp); only its
--     SHA-256 hash is stored. It lasts 7 days. Issuing again for the same
--     email cancels the older pending invite.
--   * States: pending -> accepting -> active, with terminal cancelled and
--     failed. One live (pending or accepting) invite per email. The claim is
--     one conditional UPDATE, so of two concurrent acceptances exactly one wins.
--   * The app creates the Auth user banned, then kit_complete_invite links the
--     profile with the invited role and marks the invite active in one
--     transaction, then the app unbans last. A failure on the way deletes the
--     still-banned user and marks the invite failed.
--   * Service role only: no API role can read or write the table.
--   * Rollback: drop the functions, then the table.

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320 and position('@' in email) > 1),
  role text not null check (role in ('admin', 'host')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepting', 'active', 'cancelled', 'failed')),
  invited_by uuid,
  user_id uuid,
  attempt_id uuid,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepting_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check (status <> 'accepting' or (accepting_at is not null and attempt_id is not null)),
  check (status <> 'active' or (accepted_at is not null and user_id is not null))
);

create unique index if not exists invites_one_live_per_email on public.invites (email)
  where status in ('pending', 'accepting');
create index if not exists invites_accepting_since on public.invites (accepting_at)
  where status = 'accepting';

alter table public.invites enable row level security;
revoke all on table public.invites from public, anon, authenticated;
grant select, insert, update on table public.invites to service_role;

create or replace function public.kit_issue_invite(
  p_email text,
  p_role text,
  p_token_hash text,
  p_invited_by uuid,
  p_ttl_seconds integer default 604800
)
returns table (id uuid, email text, role text, expires_at timestamptz, cancelled integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_cancelled integer;
begin
  if p_role not in ('admin', 'host') then
    raise exception 'kit_invalid_role' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 604800 then
    raise exception 'kit_invalid_ttl' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.deleted_at is null) then
    raise exception 'kit_invite_account_exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invites i where i.email = v_email and i.status = 'accepting') then
    raise exception 'kit_invite_in_progress' using errcode = 'P0001';
  end if;

  update public.invites i
    set status = 'cancelled', cancelled_at = pg_catalog.now()
    where i.email = v_email and i.status = 'pending';
  get diagnostics v_cancelled = row_count;

  return query
    insert into public.invites as i (email, role, token_hash, invited_by, expires_at)
    values (v_email, p_role, p_token_hash, p_invited_by, pg_catalog.now() + make_interval(secs => p_ttl_seconds))
    returning i.id, i.email, i.role, i.expires_at, v_cancelled;
end;
$$;
revoke all on function public.kit_issue_invite(text, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.kit_issue_invite(text, text, text, uuid, integer) to service_role;

-- Cancels a pending invite. Returns its email, or null when it was not pending.
create or replace function public.kit_cancel_invite(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.invites
    set status = 'cancelled', cancelled_at = pg_catalog.now()
    where id = p_id and status = 'pending'
    returning email
$$;
revoke all on function public.kit_cancel_invite(uuid) from public, anon, authenticated;
grant execute on function public.kit_cancel_invite(uuid) to service_role;

-- The single winner: moves a pending, unexpired invite to accepting under the
-- caller's attempt id. No row back means the link is no longer usable.
create or replace function public.kit_claim_invite(p_token_hash text, p_attempt uuid)
returns table (id uuid, email text, role text)
language sql
security definer
set search_path = ''
as $$
  update public.invites i
    set status = 'accepting', accepting_at = pg_catalog.now(), attempt_id = p_attempt
    where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > pg_catalog.now()
    returning i.id, i.email, i.role
$$;
revoke all on function public.kit_claim_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.kit_claim_invite(text, uuid) to service_role;

-- Records the banned Auth user made for this attempt, so reconciliation can
-- find and delete it if the attempt never finishes.
create or replace function public.kit_attach_invite_user(p_id uuid, p_attempt uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invites
    set user_id = p_user
    where id = p_id and attempt_id = p_attempt and status = 'accepting' and user_id is null;
  return found;
end;
$$;
revoke all on function public.kit_attach_invite_user(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.kit_attach_invite_user(uuid, uuid, uuid) to service_role;

-- Links the profile with the invited role and marks the invite active, in one
-- transaction. False means the attempt is no longer the live one.
create or replace function public.kit_complete_invite(p_id uuid, p_attempt uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select i.role into v_role
    from public.invites i
    where i.id = p_id and i.attempt_id = p_attempt and i.status = 'accepting' and i.user_id = p_user
    for update;
  if v_role is null then
    return false;
  end if;

  execute format(
    'insert into public.profiles (%1$I, role) values ($1, $2::%2$s) '
    'on conflict (%1$I) do update set role = excluded.role, deactivated_at = null',
    'id', public.kit_profile_role_type()
  ) using p_user, v_role;

  update public.invites
    set status = 'active', accepted_at = pg_catalog.now()
    where id = p_id;
  return true;
end;
$$;
revoke all on function public.kit_complete_invite(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.kit_complete_invite(uuid, uuid, uuid) to service_role;

create or replace function public.kit_fail_invite(p_id uuid, p_attempt uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invites
    set status = 'failed', failed_at = pg_catalog.now(), failure_reason = left(p_reason, 200)
    where id = p_id and attempt_id = p_attempt and status = 'accepting'
$$;
revoke all on function public.kit_fail_invite(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.kit_fail_invite(uuid, uuid, text) to service_role;

-- Attempts stuck in accepting (a crash between steps). The app's
-- reconciliation deletes each still-banned user and fails the invite.
create or replace function public.kit_stale_invites(p_older_than_seconds integer default 900)
returns table (id uuid, attempt_id uuid, user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.attempt_id, i.user_id, i.email
  from public.invites i
  where i.status = 'accepting'
    and i.accepting_at < pg_catalog.now() - make_interval(secs => greatest(p_older_than_seconds, 300))
  order by i.accepting_at
$$;
revoke all on function public.kit_stale_invites(integer) from public, anon, authenticated;
grant execute on function public.kit_stale_invites(integer) to service_role;
