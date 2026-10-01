export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * 'pending' is a signed-up account that has not been approved. It can reach
 * nothing: not /admin, not /host, no RPC and no row through RLS. An admin
 * promotes it to 'host' or 'admin' deliberately. New accounts land here, so
 * anything that treats "has a session" as "is staff" is a hole.
 */
export type UserRole = 'admin' | 'host' | 'pending'
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

/**
 * One row from list_unsettled_snowball_games: a finished snowball game, outside
 * a test night, that ended on or after 2026-10-01 00:00 Europe/London and has
 * no settlement record. Defined in
 * supabase/migrations/20261001000300_jackpot_components.sql.
 */
export interface UnsettledSnowballGameRow {
  game_id: string
  game_name: string
  game_index: number
  ended_at: string
  session_id: string
  session_name: string
  session_start_date: string | null
}

/** A claim verdict, as stored in game_states.claim_result. */
export type ClaimResult = 'valid' | 'invalid' | 'late'

/**
 * What finish_game returns. Defined in
 * supabase/migrations/20261001000100_night_lifecycle.sql.
 */
export interface FinishGameResult {
  game_state: Database['public']['Tables']['game_states']['Row']
  /** The session is completed after this call (every game finished, now or before). */
  session_completed: boolean
}

/**
 * begin_claim_check outcomes. ok is false only for attempt_mismatch: another
 * attempt is being checked, and attempt_id is the one to adopt.
 */
export type BeginClaimCheckCode = 'started' | 'already_started' | 'replaced' | 'attempt_mismatch'

/**
 * set_claim_draft outcomes. 'saved' and 'stale_seq' (ignored, the stored draft
 * returned unchanged) are ok; every other code is a refusal that wrote nothing.
 */
export type SetClaimDraftCode =
  | 'saved'
  | 'stale_seq'
  | 'not_paused'
  | 'attempt_mismatch'
  | 'verdict_already_given'
  | 'stale_attempt'
  | 'number_out_of_range'
  | 'duplicate_numbers'
  | 'too_many_numbers'

/**
 * check_claim outcomes. The three verdicts and 'missing_last_ball' (numbers
 * stored as the draft, no verdict, the host decides) are ok; the rest are
 * refusals that wrote nothing. A retry once a verdict exists returns that
 * verdict when the numbers match, in any order.
 */
export type CheckClaimCode =
  | ClaimResult
  | 'missing_last_ball'
  | 'not_paused'
  | 'attempt_mismatch'
  | 'stale_attempt'
  | 'verdict_already_given'
  | 'number_out_of_range'
  | 'duplicate_numbers'
  | 'wrong_count'

/**
 * The jsonb every claim function returns. Defined in
 * supabase/migrations/20261001000200_claim_attempts.sql. Guard failures
 * (unauthorized, not_controller, not_in_progress, on_break, attempt_required,
 * game_state_not_found, unknown_stage) are raised as errors instead.
 */
export interface ClaimRpcResult<C extends string> {
  /** False when the call was refused and wrote nothing. */
  ok: boolean
  code: C
  /** The attempt on the row after the call; on attempt_mismatch, the one to adopt. */
  attempt_id: string | null
  /** The stored claim, in tap order. */
  claim_numbers: number[] | null
  claim_result: ClaimResult | null
  /** The stored draft sequence. A phone adopting an attempt continues from here. */
  claim_draft_seq: number
  game_state: Database['public']['Tables']['game_states']['Row']
}

export interface CheckClaimRpcResult extends ClaimRpcResult<CheckClaimCode> {
  /** The stored numbers that have not been called, in tap order. */
  invalid_numbers: number[]
  /** The last ball called, or null when none has been. */
  last_number: number | null
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
          /** When the first game of the night started. Set by start_game; a re-open keeps it; reset clears it. */
          started_at: string | null
          /** Stamped by trigger on the transition to completed, cleared on leaving it. Null for nights before 2026-10-01. */
          completed_at: string | null
          /** Bumped by trigger on every update. Drop a session snapshot older than the one held. */
          state_version: number
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
          started_at?: string | null
          completed_at?: string | null
          state_version?: number
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
          started_at?: string | null
          completed_at?: string | null
          state_version?: number
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
          /**
           * Idempotency key of the most recent successful call. Deliberately not
           * mirrored into game_states_public: it is a host concern and no public
           * surface reads it.
           */
          last_call_request_id: string | null
          updated_at: string
          state_version: number // Monotonic counter bumped on every update; used to order Realtime/polling snapshots
          /**
           * The claim being checked (20261001000200_claim_attempts.sql). Every
           * claim_* column is written only by begin_claim_check, set_claim_draft,
           * check_claim and the bound undo in void_last_number: the
           * guard_claim_fields trigger refuses a direct write while paused and
           * clears them all whenever the game is not paused. That is why none of
           * them is in Insert or Update.
           */
          claim_attempt_id: string | null
          /** The stage index when the check started; a different stage makes the attempt stale. */
          claim_stage_index: number | null
          /** The ball count when the check started, moved down by the bound undo. */
          claim_call_count: number | null
          /** The highest draft sequence stored. */
          claim_draft_seq: number
          /** The attempt has used its one undo. */
          claim_undo_used: boolean
          /** The claimed numbers in tap order. Public, mirrored to game_states_public. */
          claim_numbers: number[] | null
          /** The server verdict. Public, mirrored to game_states_public. */
          claim_result: ClaimResult | null
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
          /** Mirror of game_states.claim_numbers: the claim the TV and phones show, in tap order. */
          claim_numbers: number[] | null
          /** Mirror of game_states.claim_result. */
          claim_result: ClaimResult | null
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
          claim_numbers?: number[] | null
          claim_result?: ClaimResult | null
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
          claim_numbers?: number[] | null
          claim_result?: ClaimResult | null
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
          /**
           * The ORDINARY prize pool of this row, in pence: what the ordinary
           * prize text is worth, before any snowball jackpot text was appended.
           * 0 for a jackpot-only description; null when the prize is not money.
           * Read-only from the app: maintained entirely by the
           * winners_prize_share_sync trigger.
           */
          prize_amount_pence: number | null
          /**
           * What this winner actually gets, in pence. Equal to the amount for a
           * single winner; an even split with the odd penny to the earliest
           * recorded winner when a stage is tied. Null for a voided win and for
           * a prize that is not money. THIS is the number to total a payout
           * with: prize_amount_pence counts a shared prize once per winner.
           */
          prize_share_pence: number | null
          /**
           * The snowball jackpot this winner shared in, in pence: the pot under
           * the pot lock when the win was recorded. Null when the row is not a
           * jackpot winner, and on jackpot rows from before 2026-10-01 that no
           * settlement record vouches for ("jackpot amount not recorded").
           */
          jackpot_pool_pence: number | null
          /**
           * This winner's share of the jackpot: the pool split between the
           * non-void jackpot winners of the stage, odd penny to the earliest.
           * Maintained by the winners_prize_share_sync trigger, so it is not in
           * Insert or Update. A winner's total is prize_share_pence (now the
           * ordinary prize only) plus this.
           */
          jackpot_share_pence: number | null
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
          jackpot_pool_pence?: number | null
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
          jackpot_pool_pence?: number | null
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
          /**
           * Idempotency key for one intended ball. A retry carrying the key of a
           * call that already committed returns the state unchanged instead of
           * drawing a second ball. Mint it on the tap and hold it across retries
           * of that tap; a fresh key per attempt removes the protection entirely.
           * See supabase/migrations/20260825080606_call_next_number_idempotency.sql.
           */
          p_client_request_id?: string | null
        }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      /**
       * Undoes the last ball. Unpaused, only p_game_id is needed, as before.
       * Paused for a claim, it is the one undo an attempt may make: pass the
       * attempt and the ball count the host saw. Raises paused_for_validation
       * (no attempt given), attempt_mismatch, verdict_already_given or
       * already_undone. See 20261001000200_claim_attempts.sql.
       */
      void_last_number: {
        Args: {
          p_game_id: string
          p_attempt_id?: string | null
          p_expected_count?: number | null
        }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      /**
       * Starts, re-opens or takes over a game, under the session lock then the
       * game_states lock. Raises night_ended, other_game_in_progress,
       * invalid_sequence, game_not_found, session_not_found, and for the cash
       * jackpot amount invalid_cash_jackpot, cash_jackpot_not_allowed and
       * cash_jackpot_stage_count. Cookie client only.
       * See 20261001000100_night_lifecycle.sql.
       */
      start_game: {
        Args: {
          p_game_id: string
          /** A permutation of 1 to 90, shuffled with crypto. Needed for a fresh start. */
          p_number_sequence?: number[] | null
          /**
           * The cash jackpot in pounds, at most two decimals, for a fresh start
           * of a 'jackpot' game only; written as its one stage's prize text
           * ("£125 Cash Jackpot") in the same transaction. Null on every other
           * start, which leaves the prizes alone.
           */
          p_cash_jackpot_amount?: number | null
        }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      /**
       * Completes a game, and the session when every game is completed.
       * Idempotent. Raises not_controller, not_in_progress, game_not_found,
       * session_not_found, game_state_not_found.
       */
      finish_game: {
        Args: { p_game_id: string }
        Returns: FinishGameResult
      }
      /** Ends the night. Idempotent. Raises game_in_progress, session_not_found. */
      end_night: {
        Args: { p_session_id: string }
        Returns: Database['public']['Tables']['sessions']['Row']
      }
      /** Starts (or adopts, or with p_new_claimant replaces) a claim check. */
      begin_claim_check: {
        Args: {
          p_game_id: string
          p_attempt_id: string
          p_new_claimant?: boolean
        }
        Returns: ClaimRpcResult<BeginClaimCheckCode>
      }
      /** Stores the live draft for the TV and phones. */
      set_claim_draft: {
        Args: {
          p_game_id: string
          p_attempt_id: string
          p_numbers: number[]
          p_seq: number
        }
        Returns: ClaimRpcResult<SetClaimDraftCode>
      }
      /** The server verdict on a claim. */
      check_claim: {
        Args: {
          p_game_id: string
          p_attempt_id: string
          p_numbers: number[]
          p_reject_as_late?: boolean
        }
        Returns: CheckClaimRpcResult
      }
      /** How many numbers a stage needs: Line 5, Two Lines 10, Full House 15, else null. */
      required_claim_count: {
        Args: { p_stage: string }
        Returns: number | null
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
           * Idempotency key for one claim attempt. Pass the same value on a
           * retry of the same claim; pass a fresh one for the next claim,
           * including a tie. From 20261001000400_claim_enforcement.sql this
           * must be the claim attempt id given to begin_claim_check, with a
           * 'valid' verdict from check_claim, or a new winner is refused
           * (claim_not_checked, attempt_mismatch, stale_attempt,
           * claim_not_valid). The only exemption is a manual snowball award
           * inside the open jackpot window.
           */
          p_client_request_id?: string | null
        }
        Returns: Database['public']['Tables']['game_states']['Row']
      }
      /**
       * Writes only winners.prize_given, so a host can tick a prize as handed
       * over without gaining is_void. Returns the persisted value. Raises
       * winner_void for a voided winner (20261001000300_jackpot_components.sql).
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
       * needs the cookie-based client, never the service-role client. Raises
       * game_not_completed unless the game is completed
       * (20261001000300_jackpot_components.sql).
       */
      settle_snowball_pot: {
        Args: { p_game_id: string }
        Returns: SnowballSettlementRow[]
      }
      /**
       * The finished snowball games whose pot never settled, newest first: the
       * host dashboard's Settle list. Reads the admin-only settlement history
       * for a host and returns games only. One night, or every night when
       * p_session_id is null. Read only; raises only unauthorized.
       */
      list_unsettled_snowball_games: {
        Args: { p_session_id?: string | null }
        Returns: UnsettledSnowballGameRow[]
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
