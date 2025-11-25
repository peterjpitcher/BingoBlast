-- Add active_game_id to sessions table
-- Run this in your Supabase SQL Editor to fix the "column sessions.active_game_id does not exist" error.

ALTER TABLE public.sessions 
ADD COLUMN active_game_id uuid REFERENCES public.games(id);
