-- Add explicit Jackpot game type for session setup
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'game_type'
      and e.enumlabel = 'jackpot'
  ) then
    alter type public.game_type add value 'jackpot';
  end if;
end $$;
