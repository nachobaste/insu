// lib/supabase/database.types.ts
// Hand-crafted to match the 9-table schema (Supabase CLI requires auth token)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          role: string
          preferred_currency: string
          stripe_customer_id: string | null
          conekta_customer_id: string | null
          created_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          role?: string
          preferred_currency?: string
          stripe_customer_id?: string | null
          conekta_customer_id?: string | null
          created_at?: string
        }
        Update: {
          full_name?: string | null
          role?: string
          preferred_currency?: string
          stripe_customer_id?: string | null
          conekta_customer_id?: string | null
        }
      }
      categories: {
        Row: {
          id: string
          name: string
          slug: string
          color: string
          icon_url: string | null
          display_order: number
        }
        Insert: {
          id?: string
          name: string
          slug: string
          color: string
          icon_url?: string | null
          display_order?: number
        }
        Update: {
          name?: string
          slug?: string
          color?: string
          icon_url?: string | null
          display_order?: number
        }
      }
      contracts: {
        Row: {
          id: string
          slug: string
          title: string
          description: string | null
          category_id: string
          status: string
          trigger_type: string
          trigger_condition: Json
          trigger_deadline: string
          location: Json
          icon_url: string | null
          total_volume_usd: number
          total_volume_mxn: number
          is_featured: boolean
          settled_outcome: boolean | null
          created_by: string
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id?: string
          slug: string
          title: string
          description?: string | null
          category_id: string
          status?: string
          trigger_type: string
          trigger_condition?: Json
          trigger_deadline: string
          location?: Json
          icon_url?: string | null
          total_volume_usd?: number
          total_volume_mxn?: number
          is_featured?: boolean
          settled_outcome?: boolean | null
          created_by: string
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          slug?: string
          title?: string
          description?: string | null
          category_id?: string
          status?: string
          trigger_type?: string
          trigger_condition?: Json
          trigger_deadline?: string
          location?: Json
          icon_url?: string | null
          total_volume_usd?: number
          total_volume_mxn?: number
          is_featured?: boolean
          settled_outcome?: boolean | null
          settled_at?: string | null
        }
      }
      coverage_tiers: {
        Row: {
          id: string
          contract_id: string
          name: string
          premium_usd: number
          payout_usd: number
          premium_mxn: number
          payout_mxn: number
          max_capacity_usd: number
          current_capacity_usd: number
          base_probability: number
          last_priced_at: string | null
          pricing_inputs: Json | null
        }
        Insert: {
          id?: string
          contract_id: string
          name: string
          premium_usd?: number
          payout_usd?: number
          premium_mxn?: number
          payout_mxn?: number
          max_capacity_usd?: number
          current_capacity_usd?: number
          base_probability?: number
          last_priced_at?: string | null
          pricing_inputs?: Json | null
        }
        Update: {
          name?: string
          premium_usd?: number
          payout_usd?: number
          premium_mxn?: number
          payout_mxn?: number
          max_capacity_usd?: number
          current_capacity_usd?: number
          base_probability?: number
          last_priced_at?: string | null
          pricing_inputs?: Json | null
        }
      }
      hedger_positions: {
        Row: {
          id: string
          user_id: string
          contract_id: string
          tier_id: string
          premium_paid_usd: number
          payout_amount_usd: number
          premium_paid_mxn: number
          payout_amount_mxn: number
          currency: string
          payment_provider: string
          payment_intent_id: string | null
          status: string
          purchased_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          user_id: string
          contract_id: string
          tier_id: string
          premium_paid_usd?: number
          payout_amount_usd?: number
          premium_paid_mxn?: number
          payout_amount_mxn?: number
          currency: string
          payment_provider: string
          payment_intent_id?: string | null
          status?: string
          purchased_at?: string
          expires_at: string
        }
        Update: {
          status?: string
          payment_intent_id?: string | null
        }
      }
      provider_positions: {
        Row: {
          id: string
          user_id: string
          contract_id: string
          tier_id: string
          capital_deposited_usd: number
          capital_deposited_mxn: number
          currency: string
          payment_provider: string
          payment_intent_id: string | null
          expected_return_usd: number
          actual_return_usd: number | null
          expected_return_mxn: number
          actual_return_mxn: number | null
          status: string
          deposited_at: string
          settled_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          contract_id: string
          tier_id: string
          capital_deposited_usd?: number
          capital_deposited_mxn?: number
          currency: string
          payment_provider: string
          payment_intent_id?: string | null
          expected_return_usd?: number
          actual_return_usd?: number | null
          expected_return_mxn?: number
          actual_return_mxn?: number | null
          status?: string
          deposited_at?: string
          settled_at?: string | null
        }
        Update: {
          status?: string
          actual_return_usd?: number | null
          actual_return_mxn?: number | null
          settled_at?: string | null
        }
      }
      oracle_readings: {
        Row: {
          id: string
          contract_id: string
          source: string
          reading_type: string
          value: Json
          trigger_met: boolean
          read_at: string
        }
        Insert: {
          id?: string
          contract_id: string
          source: string
          reading_type: string
          value?: Json
          trigger_met?: boolean
          read_at?: string
        }
        Update: {
          trigger_met?: boolean
        }
      }
      payouts: {
        Row: {
          id: string
          contract_id: string
          hedger_position_id: string
          amount_usd: number
          amount_mxn: number
          currency: string
          payment_provider: string
          transfer_id: string | null
          status: string
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          contract_id: string
          hedger_position_id: string
          amount_usd?: number
          amount_mxn?: number
          currency: string
          payment_provider: string
          transfer_id?: string | null
          status?: string
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          transfer_id?: string | null
          status?: string
          completed_at?: string | null
        }
      }
      pricing_history: {
        Row: {
          id: string
          contract_id: string
          tier_id: string
          bs_inputs: Json
          bs_output: Json
          premium_usd_before: number
          premium_usd_after: number
          calculated_at: string
        }
        Insert: {
          id?: string
          contract_id: string
          tier_id: string
          bs_inputs?: Json
          bs_output?: Json
          premium_usd_before?: number
          premium_usd_after?: number
          calculated_at?: string
        }
        Update: {
          bs_inputs?: Json
          bs_output?: Json
          premium_usd_before?: number
          premium_usd_after?: number
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
