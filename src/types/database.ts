export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'host'
export type SessionStatus = 'draft' | 'ready' | 'running' | 'completed'
export type GameType = 'standard' | 'snowball' | 'jackpot'
export type GameStatus = 'not_started' | 'in_progress' | 'completed'
export type WinStage = 'Line' | 'Two Lines' | 'Full House'

/**
 * What settle_snowball_pot did. Only 'settled' moved the pot. The other three
 * all mean the pot is already correct and nothing needed doing, so none of them
 * is a failure the host should see.
 */
export type SnowballSettlementOutcome =
  | 'settled'
  | 'already_settled'
  | 'not_snowball'
  | 'test_session'

/**
 * One row from settle_snowball_pot. Defined in
 * supabase/migrations/20260730065531_atomic_snowball_settlement.sql.
 *
 * settlement is null unless this call actually moved the pot. Every other field
 * is null on the 'not_snowball' and 'test_session' outcomes.
 */
export interface SnowballSettlementRow {
  outcome: SnowballSettlementOutcome
  settlement: 'reset' | 'rollover' | null
  pot_id: string | null
  new_max_calls: number | null
  new_jackpot_amount: number | null
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          role: UserRole
          created_at: string
        }
        Insert: {
          id: string
          email?: string | null
          role?: UserRole
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          role?: UserRole
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      sessions: {
        Row: {
          id: string
          name: string
          start_date: string
          notes: string | null
          status: SessionStatus
          is_test_session: boolean
          created_by: string | null
          active_game_id: string | null // New
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          start_date?: string
          notes?: string | null
          status?: SessionStatus
          is_test_session?: boolean
          created_by?: string | null
          active_game_id?: string | null // New
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          start_date?: string
          notes?: string | null
          status?: SessionStatus
          is_test_session?: boolean
          created_by?: string | null
          active_game_id?: string | null // New
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sessions_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sessions_active_game_id_fkey'
            columns: ['active_game_id']
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
        ]
      }
      games: {
        Row: {
          id: string
          session_id: string
          game_index: number
          name: string
          type: GameType
          stage_sequence: WinStage[]
          background_colour: string
          prizes: { [key: string]: string }
          notes: string | null
          snowball_pot_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          game_index: number
          name: string
          type?: GameType
          stage_sequence?: WinStage[]
          background_colour?: string
          prizes?: { [key: string]: string }
          notes?: string | null
          snowball_pot_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          game_index?: number
          name?: string
          type?: GameType
          stage_sequence?: WinStage[]
          background_colour?: string
          prizes?: { [key: string]: string }
          notes?: string | null
          snowball_pot_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'games_session_id_fkey'
            columns: ['session_id']
            referencedRelation: 'sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'games_snowball_pot_id_fkey'
            columns: ['snowball_pot_id']
            referencedRelation: 'snowball_pots'
            referencedColumns: ['id']
          },
        ]
      }
      game_states: {
        Row: {
          id: string
          game_id: string
          number_sequence: number[] | null
          called_numbers: number[]
          numbers_called_count: number
          current_stage_index: number
          status: GameStatus
          call_delay_seconds: number // Public reveal delay in seconds, not a host call gap (that is HOST_MIN_CALL_GAP_MS)
          on_break: boolean
          paused_for_validation: boolean
          display_win_type: string | null // 'line', 'two_lines', 'full_house', 'snowball'
          display_win_text: string | null // e.g., "Line Winner!"
          display_winner_name: string | null // Optional: "Dave - Table 6"
          controlling_host_id: string | null // New: ID of the host controlling the game
          controller_last_seen_at: string | null // New: Timestamp of last heartbeat
          started_at: string | null
          ended_at: string | null
          last_call_at: string | null
          updated_at: string
          state_version: number // Monotonic counter bumped on every update; used to order Realtime/polling snapshots
        }
        Insert: {
          id?: string
          game_id: string
          number_sequence?: number[] | null
          called_numbers?: number[]
          numbers_called_count?: number
          current_stage_index?: number
          status?: GameStatus
          call_delay_seconds?: number
          on_break?: boolean
          paused_for_validation?: boolean
          display_win_type?: string | null
          display_win_text?: string | null
          display_winner_name?: string | null
          controlling_host_id?: string | null
          controller_last_seen_at?: string | null
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
          state_version?: number
        }
        Update: {
          id?: string
          game_id?: string
          number_sequence?: number[] | null
          called_numbers?: number[]
          numbers_called_count?: number
          current_stage_index?: number
          status?: GameStatus
          call_delay_seconds?: number
          on_break?: boolean
          paused_for_validation?: boolean
          display_win_type?: string | null
          display_win_text?: string | null
          display_winner_name?: string | null
          controlling_host_id?: string | null
          controller_last_seen_at?: string | null
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
          state_version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'game_states_game_id_fkey'
            columns: ['game_id']
            referencedRelation: 'games'
            referencedColumns: ['id']
            isOneToOne: true
          },
          {
            foreignKeyName: 'game_states_controlling_host_id_fkey'
            columns: ['controlling_host_id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      game_states_public: {
        Row: {
          game_id: string
          called_numbers: number[]
          numbers_called_count: number
          current_stage_index: number
          status: GameStatus
          call_delay_seconds: number // Public reveal delay in seconds, not a host call gap
          on_break: boolean
          paused_for_validation: boolean
          display_win_type: string | null
          display_win_text: string | null
          display_winner_name: string | null
          started_at: string | null
          ended_at: string | null
          last_call_at: string | null
          updated_at: string
          state_version: number // Mirror of game_states.state_version; copied by sync trigger
        }
        Insert: {
          game_id: string
          called_numbers?: number[]
          numbers_called_count?: number
          current_stage_index?: number
          status?: GameStatus
          call_delay_seconds?: number
          on_break?: boolean
          paused_for_validation?: boolean
          display_win_type?: string | null
          display_win_text?: string | null
          display_winner_name?: string | null
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
          state_version?: number
        }
        Update: {
          game_id?: string
          called_numbers?: number[]
          numbers_called_count?: number
          current_stage_index?: number
          status?: GameStatus
          call_delay_seconds?: number
          on_break?: boolean
          paused_for_validation?: boolean
          display_win_type?: string | null
          display_win_text?: string | null
          display_winner_name?: string | null
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
          state_version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'game_states_public_game_id_fkey'
            columns: ['game_id']
            referencedRelation: 'games'
            referencedColumns: ['id']
            isOneToOne: true
          },
        ]
      }
      winners: {
        Row: {
          id: string
          session_id: string
          game_id: string
          stage: WinStage
          winner_name: string
          prize_description: string | null
          prize_given: boolean
          call_count_at_win: number | null
          is_snowball_eligible: boolean
          is_snowball_jackpot: boolean
          // Nullable in production, so typed honestly. Treat null as not void.
          // Never filter with `eq('is_void', false)`: it silently drops the null
          // rows, and a null-void jackpot winner would then roll the pot instead
          // of resetting it. Use `.not('is_void', 'is', true)`, which matches
          // `coalesce(is_void, false) = false` on the SQL side.
          is_void: boolean | null
          void_reason: string | null
          // Caller-supplied idempotency key, one per claim attempt. Unique where
          // not null, so a retried recordWinner cannot insert a second row for
          // the same claim while a genuine tie (a different key) still can. Null
          // on every row written before 20260730120000. Not player-identifying.
          client_request_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          game_id: string
          stage: WinStage
          winner_name: string
          prize_description?: string | null
          prize_given?: boolean
          call_count_at_win?: number | null
          is_snowball_eligible?: boolean
          is_snowball_jackpot?: boolean
          is_void?: boolean
          void_reason?: string | null
          client_request_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          game_id?: string
          stage?: WinStage
          winner_name?: string
          prize_description?: string | null
          prize_given?: boolean
          call_count_at_win?: number | null
          is_snowball_eligible?: boolean
          is_snowball_jackpot?: boolean
          is_void?: boolean
          void_reason?: string | null
          client_request_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'winners_session_id_fkey'
            columns: ['session_id']
            referencedRelation: 'sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'winners_game_id_fkey'
            columns: ['game_id']
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
        ]
      }
      snowball_pots: {
        Row: {
          id: string
          name: string
          base_max_calls: number
          base_jackpot_amount: number
          calls_increment: number
          jackpot_increment: number
          current_max_calls: number
          current_jackpot_amount: number
          last_awarded_at: string | null
          /** Set when the pot is retired. Archived pots are hidden and cannot take a new game. */
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          base_max_calls?: number
          base_jackpot_amount?: number
          calls_increment?: number
          jackpot_increment?: number
          current_max_calls: number
          current_jackpot_amount: number
          last_awarded_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          base_max_calls?: number
          base_jackpot_amount?: number
          calls_increment?: number
          jackpot_increment?: number
          current_max_calls?: number
          current_jackpot_amount?: number
          last_awarded_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      /**
       * Append-only record of every session reset: who, when, and what was
       * destroyed. Written only by reset_session_safe (security definer), and
       * readable by admins. There is no INSERT, UPDATE or DELETE policy, so the
       * Insert and Update shapes below exist only to satisfy the generic client
       * types and are never used.
       */
      session_reset_log: {
        Row: {
          id: string
          session_id: string
          /** Snapshotted, so the row still means something if the session is renamed or deleted. */
          session_name: string | null
          reset_by: string | null
          reset_at: string
          winners_deleted: number
          game_states_deleted: number
          /** The winners exactly as they were. Anonymous by policy, so no personal data. */
          winners_snapshot: unknown | null
        }
        Insert: {
          id?: string
          session_id: string
          session_name?: string | null
          reset_by?: string | null
          reset_at?: string
          winners_deleted?: number
          game_states_deleted?: number
          winners_snapshot?: unknown | null
        }
        Update: {
          id?: string
          session_id?: string
          session_name?: string | null
          reset_by?: string | null
          reset_at?: string
          winners_deleted?: number
          game_states_deleted?: number
          winners_snapshot?: unknown | null
        }
        Relationships: []
      }
      snowball_pot_history: {
        Row: {
          id: string
          snowball_pot_id: string
          // The game whose end settled the pot. Unique per pot where set, which
          // is what makes one settlement per game a database guarantee. Null on
          // rows written before the column existed and on manual adjustments.
          game_id: string | null
          change_type: string | null
          old_val_max: number | null
          new_val_max: number | null
          old_val_jackpot: number | null
          new_val_jackpot: number | null
          changed_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          snowball_pot_id: string
          game_id?: string | null
          change_type?: string | null
          old_val_max?: number | null
          new_val_max?: number | null
          old_val_jackpot?: number | null
          new_val_jackpot?: number | null
          changed_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          snowball_pot_id?: string
          game_id?: string | null
          change_type?: string | null
          old_val_max?: number | null
          new_val_max?: number | null
          old_val_jackpot?: number | null
          new_val_jackpot?: number | null
          changed_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'snowball_pot_history_snowball_pot_id_fkey'
            columns: ['snowball_pot_id']
            referencedRelation: 'snowball_pots'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'snowball_pot_history_changed_by_fkey'
            columns: ['changed_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'snowball_pot_history_game_id_fkey'
            columns: ['game_id']
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_is_admin: { Args: Record<string, never>; Returns: undefined }
      // Host hot-path mutations. Defined in
      // supabase/migrations/20260729231945_atomic_host_mutations.sql. All four are
      // security definer and read auth.uid(), so they must be called with the
      // cookie-based client, never the service-role client.
      assert_is_host: { Args: Record<string, never>; Returns: undefined }
      call_next_number: {
        Args: {
          p_game_id: string
          /** Host anti-double-tap window. Pass HOST_MIN_CALL_GAP_MS from src/lib/call-timing.ts. */
          p_min_gap_ms?: number
        }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      void_last_number: {
        Args: { p_game_id: string }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      record_winner_atomic: {
        Args: {
          p_session_id: string
          p_game_id: string
          p_stage: WinStage
          p_prize_description?: string | null
          p_prize_given?: boolean
          p_force_snowball_jackpot?: boolean
          p_snowball_eligible?: boolean
          /**
           * Idempotency key for one claim attempt, from newClaimRequestId() in
           * src/lib/claim-request-id.ts. Pass the same value on a retry of the
           * same claim; pass a fresh one for the next claim, including a tie.
           * Null omits the protection, so always send one.
           */
          p_client_request_id?: string | null
        }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      /**
       * Writes only winners.prize_given, so a host can tick a prize as handed
       * over without gaining is_void. Returns the persisted value.
       * Defined in supabase/migrations/20260730065446_host_can_mark_prize_given.sql.
       */
      set_winner_prize_given: {
        Args: {
          p_winner_id: string
          p_session_id: string
          p_prize_given: boolean
        }
        Returns: boolean
      }
      /**
       * Settles the snowball pot for a finished game in one transaction. Host
       * callable, which is why snowball_pots and snowball_pot_history keep
       * admin-only RLS. Also security definer and auth.uid()-reading, so it
       * needs the cookie-based client, never the service-role client.
       */
      settle_snowball_pot: {
        Args: { p_game_id: string }
        Returns: SnowballSettlementRow[]
      }
      delete_game_safe: { Args: { p_game_id: string }; Returns: undefined }
      delete_session_safe: { Args: { p_session_id: string }; Returns: undefined }
      /**
       * Wipes a session back to ready. Records what it destroyed in
       * session_reset_log first and returns that row, and refuses when the
       * session has already settled a snowball pot. See
       * supabase/migrations/20260825080604_session_reset_audit_and_guard.sql.
       */
      reset_session_safe: {
        Args: { p_session_id: string }
        Returns: Database['public']['Tables']['session_reset_log']['Row']
      }
      /**
       * Retires a snowball pot without deleting it or its history. Admin only,
       * refuses while a game on the pot is unfinished, idempotent on a retry.
       * See supabase/migrations/20260825080602_snowball_pot_archive_and_guards.sql.
       */
      archive_snowball_pot: {
        Args: { p_pot_id: string }
        Returns: Database['public']['Tables']['snowball_pots']['Row']
      }
      /**
       * Manual pot correction. Writes the pot and its audit row in one
       * transaction under a `for update` lock, and returns the persisted row so
       * a write that did not land is a real error. Replaces the old
       * three-round-trip admin path. See
       * supabase/migrations/20260825080603_atomic_manual_pot_adjustments.sql.
       */
      update_snowball_pot_safe: {
        Args: {
          p_pot_id: string
          p_name: string
          p_base_max_calls: number
          p_base_jackpot_amount: number
          p_calls_increment: number
          p_jackpot_increment: number
          p_current_max_calls: number
          p_current_jackpot_amount: number
        }
        Returns: Database['public']['Tables']['snowball_pots']['Row']
      }
      /** Returns the pot to its base figures, with an audit row, in one transaction. */
      reset_snowball_pot_safe: {
        Args: { p_pot_id: string }
        Returns: Database['public']['Tables']['snowball_pots']['Row']
      }
      update_game_safe: {
        Args: {
          p_game_id: string
          p_name: string
          p_game_index: number
          p_background_colour: string
          p_notes: string
          p_type: GameType
          p_snowball_pot_id: string | null
          p_stage_sequence: WinStage[]
          p_prizes: Partial<Record<WinStage, string>>
        }
        Returns: Database['public']['Tables']['games']['Row']
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
