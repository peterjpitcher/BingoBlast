-- Migration: let a host mark a prize as given, without letting a host void a win.
--
-- The defect. toggleWinnerPrizeGiven in src/app/host/actions.ts updates
-- public.winners through the cookie-based client, so RLS applies to the
-- signed-in account. The live policy set on winners is:
--   "Read access for all"              select using (true)
--   "Hosts/Admins can create winners"  insert, role in ('admin', 'host')
--   "Admins can update winners"        update, role = 'admin'
-- For a host-role account that UPDATE therefore matched zero rows. The action
-- did not call .select(), so PostgREST returned no error and no rows, and the
-- action reported success. The host ticked "prize given", the screen agreed, and
-- nothing was written. Latent today only because production holds a single admin
-- profile and no hosts. It bites the first host account created.
--
-- Why a function rather than a broader UPDATE policy on winners. RLS cannot
-- scope an UPDATE to one column: a policy predicate sees the whole row and
-- WITH CHECK cannot compare against the old row. A permissive "hosts may update
-- winners" policy would therefore also hand a host is_void and void_reason. That
-- matters because a host holds a real JWT in the browser and can PATCH
-- /rest/v1/winners directly, walking straight past the admin-only refusal in
-- voidWinnerFromHost. The split is deliberate: voiding a win is a money
-- decision and stays with an admin, marking the prize handed over is
-- housekeeping done by whoever is holding the prize. This function writes
-- exactly one column, so that boundary survives.
--
-- winners UPDATE stays admin-only. Nothing here loosens it.
--
-- What this function does NOT check: whether the caller holds the controller
-- lock. That gate lives in requireController() in src/app/host/actions.ts and is
-- unchanged. A host calling this RPC directly could tick a prize on a game they
-- are not controlling. That is accepted: any host or admin is trusted staff, the
-- flag is housekeeping, and an admin could already do the same with a direct
-- PATCH under the existing policy.
--
-- Conventions follow 20260729120000_atomic_host_mutations.sql: plpgsql, security
-- definer, set search_path = public, row lock via "for update", revoke all from
-- public then grant execute to authenticated and service_role. Like every other
-- host RPC this goes through assert_is_host() and so reads auth.uid(): it must be
-- called with the cookie-based client, never the service-role client, where
-- auth.uid() is null and the call is rejected.
--
-- Error strings are a contract with mapHostRpcError in src/app/host/actions.ts.
-- Raised here: 'winner_not_found', 'wrong_session', 'invalid_prize_given', and
-- 'unauthorized: ...' from assert_is_host.

create or replace function public.set_winner_prize_given(
  p_winner_id uuid,
  p_session_id uuid,
  p_prize_given boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_prize_given boolean;
begin
  perform public.assert_is_host();

  if p_prize_given is null then
    raise exception 'invalid_prize_given';
  end if;

  -- The lock makes the existence and session prechecks binding for the update
  -- below, the same way the host hot-path functions do it.
  select session_id into v_session_id
  from public.winners
  where id = p_winner_id
  for update;

  if not found then
    raise exception 'winner_not_found';
  end if;

  if v_session_id is distinct from p_session_id then
    raise exception 'wrong_session';
  end if;

  update public.winners
  set prize_given = p_prize_given
  where id = p_winner_id
  returning prize_given into v_prize_given;

  -- Returning the persisted value rather than the argument is what makes a write
  -- that did not land visible to the caller. That is the point of this change:
  -- a silent false success on a money-adjacent flag is worse than an error.
  return coalesce(v_prize_given, false);
end;
$$;

-- anon is revoked explicitly, not just via public. Supabase carries default
-- privileges that grant EXECUTE on new public-schema functions to anon, and
-- "revoke from public" does not remove that separate grant: it is why several
-- existing host RPCs still show anon in their grantee list in production. Only a
-- signed-in host or admin has any business here, so name anon directly.
revoke all on function public.set_winner_prize_given(uuid, uuid, boolean) from public;
revoke all on function public.set_winner_prize_given(uuid, uuid, boolean) from anon;
grant execute on function public.set_winner_prize_given(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_winner_prize_given(uuid, uuid, boolean) to service_role;
