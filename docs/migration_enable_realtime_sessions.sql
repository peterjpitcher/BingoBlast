-- Enable Realtime for sessions table
-- This is required for the Display view to automatically switch games when the Host starts one.

-- 1. Enable replication for the sessions table
alter publication supabase_realtime add table public.sessions;

-- 2. (Optional but good practice) Verify game_states is also enabled, as per schema
-- alter publication supabase_realtime add table public.game_states; 
-- The above line is commented out because it was likely already run, but you can uncomment if unsure.
