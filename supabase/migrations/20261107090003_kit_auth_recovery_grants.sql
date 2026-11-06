-- @anchor-nights/kit auth 04: password-recovery grants.
--
-- Standard section 10 (password reset, server-state recovery grant); spec S1.4.
--
--   * /auth/confirm (a POST) verifies the emailed recovery token, then mints a
--     grant: 256 random bits in an httpOnly cookie on /auth for 10 minutes,
--     with only the SHA-256 hash stored here.
--   * Minting a grant, or a new reset request for the email, invalidates every
--     outstanding grant for that user.
--   * The reset action claims the grant with one conditional UPDATE (hash,
--     user, unexpired, unconsumed), so it is single use with one winner. An
--     ordinary session has no grant and so cannot reset a password this way.
--   * Service role only. Rollback: drop the functions, then the table.

create table if not exists public.recovery_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create index if not exists recovery_grants_live_by_user on public.recovery_grants (user_id)
  where consumed_at is null and invalidated_at is null;

alter table public.recovery_grants enable row level security;
revoke all on table public.recovery_grants from public, anon, authenticated;
grant select, insert, update on table public.recovery_grants to service_role;

create or replace function public.kit_mint_recovery_grant(p_user uuid, p_token_hash text, p_ttl_seconds integer default 600)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 600 then
    raise exception 'kit_invalid_ttl' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and u.deleted_at is null) then
    raise exception 'kit_unknown_user' using errcode = 'P0002';
  end if;

  update public.recovery_grants
    set invalidated_at = pg_catalog.now()
    where user_id = p_user and consumed_at is null and invalidated_at is null;

  insert into public.recovery_grants (user_id, token_hash, expires_at)
    values (p_user, p_token_hash, pg_catalog.now() + make_interval(secs => p_ttl_seconds))
    returning expires_at into v_expires;
  return v_expires;
end;
$$;
revoke all on function public.kit_mint_recovery_grant(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.kit_mint_recovery_grant(uuid, text, integer) to service_role;

-- True exactly once per grant.
create or replace function public.kit_claim_recovery_grant(p_user uuid, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recovery_grants
    set consumed_at = pg_catalog.now()
    where token_hash = p_token_hash
      and user_id = p_user
      and consumed_at is null
      and invalidated_at is null
      and expires_at > pg_catalog.now();
  return found;
end;
$$;
revoke all on function public.kit_claim_recovery_grant(uuid, text) from public, anon, authenticated;
grant execute on function public.kit_claim_recovery_grant(uuid, text) to service_role;

-- A new reset request: whatever grant was outstanding for the address dies.
create or replace function public.kit_invalidate_recovery_grants_for_email(p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.recovery_grants g
    set invalidated_at = pg_catalog.now()
    from auth.users u
    where u.id = g.user_id
      and lower(u.email) = lower(btrim(p_email))
      and g.consumed_at is null
      and g.invalidated_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.kit_invalidate_recovery_grants_for_email(text) from public, anon, authenticated;
grant execute on function public.kit_invalidate_recovery_grants_for_email(text) to service_role;
