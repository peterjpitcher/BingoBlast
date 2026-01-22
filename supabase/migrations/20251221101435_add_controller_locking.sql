-- Migration: Add Controller Locking columns to game_states

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_states' AND column_name = 'controlling_host_id') THEN
        ALTER TABLE public.game_states
        ADD COLUMN controlling_host_id uuid REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_states' AND column_name = 'controller_last_seen_at') THEN
        ALTER TABLE public.game_states
        ADD COLUMN controller_last_seen_at timestamptz;
    END IF;
END $$;

-- Note: Existing RLS policies for 'update' on game_states should already cover these new columns
-- if they just allow 'update' generally.
-- However, logically we might want to restrict who can update these specific columns.
-- For v1, relying on the server actions (which we've protected with role checks) is sufficient.
