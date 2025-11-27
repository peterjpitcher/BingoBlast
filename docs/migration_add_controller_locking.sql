-- Migration: Add Controller Locking columns to game_states

ALTER TABLE public.game_states
ADD COLUMN controlling_host_id uuid REFERENCES auth.users(id),
ADD COLUMN controller_last_seen_at timestamptz;

-- Note: Existing RLS policies for 'update' on game_states should already cover these new columns
-- if they just allow 'update' generally.
-- However, logically we might want to restrict who can update these specific columns.
-- For v1, relying on the server actions (which we've protected with role checks) is sufficient.
