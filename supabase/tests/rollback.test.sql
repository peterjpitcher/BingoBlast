-- Suite F: the rollback scripts in supabase/rollback/, tested.
--
-- run.sh calls this file with -v phase=... at five points:
--   snapshot   -v label=baseline  before M1 is applied
--   snapshot   -v label=m3        after M3, before M2b
--   enforced                      after M2b: today's record call is refused
--   compare    -v label=m3        after rolling back M2b: it records again
--   compare    -v label=baseline  after rolling back M3, M2a and M1
--
-- A snapshot records, for every function in public, pg_get_functiondef (body,
-- arguments, return type, language, security, search_path), its ACL as a
-- sorted list of grantee:privilege, and its comment, plus every trigger on a
-- public table. A compare fails on any difference in either direction, so a
-- rollback that leaves a function behind, forgets one, restores a body with a
-- changed character, or restores it with a different grant, is caught.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

create schema if not exists test_meta;

create table if not exists test_meta.defs (label text, kind text, name text, def text);

create or replace function test_meta.snapshot() returns table (kind text, name text, def text)
language sql stable as $$
  select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 't'
  union all
  select 'acl', p.oid::regprocedure::text,
         (select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
                            || ':' || a.privilege_type, ',' order by 1)
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 't'
  union all
  select 'comment', p.oid::regprocedure::text, coalesce(obj_description(p.oid, 'pg_proc'), '(none)')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 't'
  union all
  select 'trigger', c.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal
$$;

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- A fresh in-progress game with ten balls called and the host paused for a
-- claim, the way today's host screen leaves it before recordWinner.
create or replace function pg_temp.paused_game(p_game_id uuid, p_index int) returns void
language plpgsql as $$
begin
  insert into public.games (id, session_id, game_index, name, type, stage_sequence, prizes)
  values (p_game_id, 'e7200000-0000-4000-8000-000000000002', p_index, 'Rollback probe', 'standard',
          '["Line"]', '{"Line": "£10 Cash"}');
  insert into public.game_states (game_id, number_sequence, called_numbers, numbers_called_count,
                                  status, paused_for_validation, controlling_host_id, controller_last_seen_at)
  values (p_game_id, (select jsonb_agg(n order by n) from generate_series(1, 90) n),
          (select jsonb_agg(n order by n) from generate_series(1, 10) n), 10,
          'in_progress', true, 'e7000000-0000-4000-8000-000000000001', now());
end;
$$;

-- Today's recordWinner call: named arguments, a claim key, no claim check.
create or replace function pg_temp.old_record(p_game_id uuid, p_key uuid) returns text
language sql as $$
  select pg_temp.err(format(
    $q$select public.record_winner_atomic(p_session_id => 'e7200000-0000-4000-8000-000000000002',
         p_game_id => %L, p_stage => 'Line', p_prize_description => '£10 Cash', p_prize_given => false,
         p_force_snowball_jackpot => false, p_snowball_eligible => false, p_client_request_id => %L)$q$,
    p_game_id, p_key));
$$;

select set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000001', false);

select :'phase' = 'snapshot' as is_snapshot,
       :'phase' = 'enforced' as is_enforced,
       :'phase' = 'compare' and :'label' = 'm3' as is_compare_m3,
       :'phase' = 'compare' and :'label' = 'baseline' as is_compare_baseline \gset

\if :is_snapshot

delete from test_meta.defs where label = :'label';
insert into test_meta.defs (label, kind, name, def)
select :'label', s.kind, s.name, s.def from test_meta.snapshot() s;

\elif :is_enforced

select pg_temp.paused_game('e7300000-0000-4000-8000-000000000005', 5);

-- One statement per step in a DO block, so each check sees what the call did.
do $$
declare v text;
begin
  v := pg_temp.old_record('e7300000-0000-4000-8000-000000000005', 'e7400000-0000-4000-8000-000000000020');
  perform t('staged :: once M2b is applied, today''s record call without a checked claim is refused',
            v = 'attempt_mismatch'
              and not exists (select 1 from public.winners
                               where client_request_id = 'e7400000-0000-4000-8000-000000000020'),
            coalesce(v, 'recorded'));
end $$;

\else

with expected as (
  select kind, name, def from test_meta.defs where label = :'label'
), actual as (
  select kind, name, def from test_meta.snapshot()
), diff as (
  select coalesce(e.kind, a.kind) || ' ' || coalesce(e.name, a.name)
         || case when e.name is null then ' (left behind)'
                 when a.name is null then ' (missing)'
                 else ' (changed)' end as what
    from expected e
    full join actual a on a.kind = e.kind and a.name = e.name
   where e.name is null or a.name is null or a.def is distinct from e.def
)
select t('rollback :: every function, ACL, comment and trigger is exactly as it was at ' || :'label',
         (select count(*) = 0 from diff)
           and (select count(*) > 0 from test_meta.defs where label = :'label'),
         (select coalesce(string_agg(what, ' | ' order by what), '(identical)') from diff));

\if :is_compare_m3
do $$
declare v text;
begin
  v := pg_temp.old_record('e7300000-0000-4000-8000-000000000005', 'e7400000-0000-4000-8000-000000000021');
  perform t('staged :: after the M2b rollback, today''s record call records again',
            v is null and exists (select 1 from public.winners
                                   where client_request_id = 'e7400000-0000-4000-8000-000000000021'),
            coalesce(v, 'recorded'));
end $$;
\endif

\if :is_compare_baseline
select pg_temp.paused_game('e7300000-0000-4000-8000-000000000006', 6);
update public.game_states set paused_for_validation = false
 where game_id = 'e7300000-0000-4000-8000-000000000006';
select t('staged :: after the full rollback, void_last_number takes one argument and undoes a ball',
         (select (public.void_last_number(p_game_id => 'e7300000-0000-4000-8000-000000000006')).numbers_called_count = 9),
         'count did not go from 10 to 9');
update public.game_states set paused_for_validation = true
 where game_id = 'e7300000-0000-4000-8000-000000000006';
do $$
declare v text;
begin
  v := pg_temp.old_record('e7300000-0000-4000-8000-000000000006', 'e7400000-0000-4000-8000-000000000022');
  perform t('staged :: after the full rollback, today''s record call records',
            v is null and exists (select 1 from public.winners
                                   where client_request_id = 'e7400000-0000-4000-8000-000000000022'),
            coalesce(v, 'recorded'));
end $$;
select t('staged :: after the full rollback, the lifecycle, claim and settle-list functions are gone',
         to_regproc('public.start_game') is null and to_regproc('public.finish_game') is null
           and to_regproc('public.end_night') is null and to_regproc('public.begin_claim_check') is null
           and to_regproc('public.check_claim') is null and to_regproc('public.set_claim_draft') is null
           and to_regproc('public.list_unsettled_snowball_games') is null,
         'a function survived the rollback');
select t('staged :: after the full rollback, a jackpot-only row counts its jackpot as the prize again, as pre-M3',
         (select prize_amount_pence = 8000 and prize_share_pence = 8000 from public.winners
           where client_request_id = 'e7400000-0000-4000-8000-000000000001'),
         (select 'amount=' || coalesce(prize_amount_pence::text, 'null') from public.winners
           where client_request_id = 'e7400000-0000-4000-8000-000000000001'));
\endif

\endif
