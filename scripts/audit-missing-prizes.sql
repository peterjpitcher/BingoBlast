-- Usage: paste into Supabase SQL editor before each release. Empty result = ready.
-- Pre-deploy audit: list non-jackpot games with missing or blank stage prizes.
-- Run before promoting; manually fix any flagged rows in admin.
select
  g.id,
  g.name,
  g.type,
  stage
from public.games g
cross join lateral jsonb_array_elements_text(g.stage_sequence::jsonb) as stage
where g.type <> 'jackpot'
  and nullif(trim(coalesce(g.prizes ->> stage, '')), '') is null;
