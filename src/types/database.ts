export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'host'
export type SessionStatus = 'draft' | 'ready' | 'running' | 'completed'
export type GameType = 'standard' | 'snowball'
export type GameStatus = 'not_started' | 'in_progress' | 'completed'
export type WinStage = 'Line' | 'Two Lines' | 'Full House'

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
          call_delay_seconds: number
          on_break: boolean
          paused_for_validation: boolean
          display_win_type: string | null // 'line', 'two_lines', 'full_house', 'snowball'
          display_win_text: string | null // e.g., "Line Winner!"
          display_winner_name: string | null // Optional: "Dave - Table 6"
          started_at: string | null
          ended_at: string | null
          last_call_at: string | null
          updated_at: string
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
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
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
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
        }
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
          is_snowball_jackpot: boolean
          is_void: boolean
          void_reason: string | null
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
          is_snowball_jackpot?: boolean
          is_void?: boolean
          void_reason?: string | null
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
          is_snowball_jackpot?: boolean
          is_void?: boolean
          void_reason?: string | null
          created_at?: string
        }
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
      }
      snowball_pot_history: {
        Row: {
          id: string
          snowball_pot_id: string
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
          change_type?: string | null
          old_val_max?: number | null
          new_val_max?: number | null
          old_val_jackpot?: number | null
          new_val_jackpot?: number | null
          changed_by?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
