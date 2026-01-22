-- Add active_game_id to sessions table
-- Run this in your Supabase SQL Editor to fix the "column sessions.active_game_id does not exist" error.

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'active_game_id') THEN
        ALTER TABLE public.sessions 
        ADD COLUMN active_game_id uuid REFERENCES public.games(id);
    END IF; 
END $$;
