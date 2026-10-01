-- Suite F fixtures: data as production holds it BEFORE the 2026-10-01
-- migrations, loaded into a replay that stops at 20260929103018. M1, M2a and M3
-- are then applied on top of it, which is the only way to test what their
-- backfills do to history rather than to an empty table.
--
-- Run via supabase/tests/run.sh, never against a real project.

insert into auth.users (id, email) values
  ('e7000000-0000-4000-8000-000000000001', 'staged-host@example.invalid');
update public.profiles set role = 'host' where id = 'e7000000-0000-4000-8000-000000000001';

insert into public.snowball_pots (
  id, name, base_max_calls, base_jackpot_amount, calls_increment, jackpot_increment,
  current_max_calls, current_jackpot_amount
) values ('e7600000-0000-4000-8000-000000000001', 'Staged pot', 40, 20, 2, 20, 50, 100.00);

-- A night that finished before started_at existed.
insert into public.sessions (id, name, status) values
  ('e7200000-0000-4000-8000-000000000001', 'Historic night', 'completed');

insert into public.games (id, session_id, game_index, name, type, stage_sequence, snowball_pot_id, prizes) values
  ('e7300000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 1, 'Settled jackpot', 'snowball',
   '["Full House"]', 'e7600000-0000-4000-8000-000000000001', '{}'),
  ('e7300000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 2, 'Unsettled jackpot', 'snowball',
   '["Full House"]', 'e7600000-0000-4000-8000-000000000001', '{"Full House": "£10 Cash"}'),
  ('e7300000-0000-4000-8000-000000000003', 'e7200000-0000-4000-8000-000000000001', 3, 'Plain tie', 'standard',
   '["Line"]', null, '{"Line": "£5 Cash"}');

insert into public.game_states (game_id, number_sequence, called_numbers, numbers_called_count, status, started_at, ended_at)
select g.id, (select jsonb_agg(n order by n) from generate_series(1, 90) n),
       (select jsonb_agg(n order by n) from generate_series(1, 30) n), 30, 'completed',
       g.started, g.started + interval '40 minutes'
  from (values
          ('e7300000-0000-4000-8000-000000000001'::uuid, '2026-07-01 19:40:00+01'::timestamptz),
          ('e7300000-0000-4000-8000-000000000002'::uuid, '2026-07-01 20:30:00+01'::timestamptz),
          ('e7300000-0000-4000-8000-000000000003'::uuid, '2026-07-01 21:15:00+01'::timestamptz)
       ) as g(id, started);

-- Winners exactly as the pre-M3 record_winner_atomic wrote them. The settled
-- jackpot's pot amount is recorded by its jackpot_won settlement; the other's is
-- not recorded anywhere.
insert into public.winners (session_id, game_id, stage, winner_name, prize_description,
                            call_count_at_win, is_snowball_eligible, is_snowball_jackpot, client_request_id) values
  ('e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', 'Full House', 'Anonymous',
   'Snowball Jackpot £80', 30, true, true, 'e7400000-0000-4000-8000-000000000001'),
  ('e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000002', 'Full House', 'Anonymous',
   '£10 Cash + Snowball Jackpot £60', 30, true, true, 'e7400000-0000-4000-8000-000000000002'),
  ('e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000003', 'Line', 'Anonymous',
   '£5 Cash', 30, false, false, 'e7400000-0000-4000-8000-000000000003'),
  ('e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000003', 'Line', 'Anonymous',
   '£5 Cash', 30, false, false, 'e7400000-0000-4000-8000-000000000004');

insert into public.snowball_pot_history (snowball_pot_id, game_id, change_type,
                                         old_val_max, new_val_max, old_val_jackpot, new_val_jackpot)
values ('e7600000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', 'jackpot_won',
        44, 40, 80.00, 20.00);

-- A night that is ready for tonight, for today's host flow.
insert into public.sessions (id, name, status) values
  ('e7200000-0000-4000-8000-000000000002', 'Tonight', 'ready');
insert into public.games (id, session_id, game_index, name, type, stage_sequence, prizes) values
  ('e7300000-0000-4000-8000-000000000004', 'e7200000-0000-4000-8000-000000000002', 1, 'Game 1', 'standard',
   '["Line", "Two Lines", "Full House"]', '{"Line": "£10 Cash", "Two Lines": "£20 Cash", "Full House": "£50 Cash"}');
