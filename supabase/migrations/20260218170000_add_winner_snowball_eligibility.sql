alter table if exists public.winners
  add column if not exists is_snowball_eligible boolean not null default false;

comment on column public.winners.is_snowball_eligible is
  'Whether the winner is eligible to receive the snowball jackpot (attendance rule).';
