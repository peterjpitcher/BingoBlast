-- Enable Realtime for sessions table
-- This is required for the Display view to automatically switch games when the Host starts one.

-- 1. Enable replication for the sessions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
  END IF;
END $$;

-- 2. (Optional but good practice) Verify game_states and game_states_public are enabled, as per schema
-- alter publication supabase_realtime add table public.game_states;
-- alter publication supabase_realtime add table public.game_states_public;
-- The above lines are commented out because they may already be enabled.
