-- Fix RLS policies to allow Hosts to run games
-- 1. Allow Hosts to update sessions (required to set status='running' and active_game_id)
CREATE POLICY "Hosts can update sessions" ON public.sessions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'host')
);

-- 2. Allow Hosts to insert game_states (required when starting a game for the first time)
-- The existing policy was: "Admins can insert/delete game state"
-- We need to allow INSERT for hosts too. DELETE should probably remain Admin only.
CREATE POLICY "Hosts can insert game state" ON public.game_states FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'host')
);
