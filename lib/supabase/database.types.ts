export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          contract_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          payout_id: string | null
          reason: string | null
        }
        Insert: {
          action: string
          admin_id: string
          contract_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          payout_id?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          contract_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          payout_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string
          display_order: number
          icon_url: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          color: string
          display_order?: number
          icon_url?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          color?: string
          display_order?: number
          icon_url?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          category_id: string
          corridor_id: string | null
          created_at: string
          created_by: string
          description: string | null
          icon_url: string | null
          id: string
          is_featured: boolean
          is_recurring: boolean
          launch_stage: string
          location: Json
          settled_at: string | null
          settled_outcome: boolean | null
          slug: string
          status: string
          title: string
          total_volume_mxn: number
          total_volume_usd: number
          trigger_condition: Json
          trigger_deadline: string | null
          trigger_type: string
        }
        Insert: {
          category_id: string
          corridor_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          icon_url?: string | null
          id?: string
          is_featured?: boolean
          is_recurring?: boolean
          launch_stage?: string
          location?: Json
          settled_at?: string | null
          settled_outcome?: boolean | null
          slug: string
          status?: string
          title: string
          total_volume_mxn?: number
          total_volume_usd?: number
          trigger_condition?: Json
          trigger_deadline?: string | null
          trigger_type: string
        }
        Update: {
          category_id?: string
          corridor_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          is_featured?: boolean
          is_recurring?: boolean
          launch_stage?: string
          location?: Json
          settled_at?: string | null
          settled_outcome?: boolean | null
          slug?: string
          status?: string
          title?: string
          total_volume_mxn?: number
          total_volume_usd?: number
          trigger_condition?: Json
          trigger_deadline?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_corridor_id_fkey"
            columns: ["corridor_id"]
            isOneToOne: false
            referencedRelation: "corridors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      corridors: {
        Row: {
          baseline_duration_s: number | null
          created_at: string
          dest_lat: number
          dest_lng: number
          id: string
          name: string
          origin_lat: number
          origin_lng: number
          path_polyline: string | null
          road: string
          slug: string
          window_end: string
          window_start: string
        }
        Insert: {
          baseline_duration_s?: number | null
          created_at?: string
          dest_lat: number
          dest_lng: number
          id?: string
          name: string
          origin_lat: number
          origin_lng: number
          path_polyline?: string | null
          road: string
          slug: string
          window_end: string
          window_start: string
        }
        Update: {
          baseline_duration_s?: number | null
          created_at?: string
          dest_lat?: number
          dest_lng?: number
          id?: string
          name?: string
          origin_lat?: number
          origin_lng?: number
          path_polyline?: string | null
          road?: string
          slug?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      coverage_tiers: {
        Row: {
          base_probability: number
          contract_id: string
          current_capacity_usd: number
          id: string
          last_priced_at: string | null
          max_capacity_usd: number
          max_payouts: number
          name: string
          payout_mxn: number
          payout_usd: number
          premium_mxn: number
          premium_usd: number
          pricing_inputs: Json | null
        }
        Insert: {
          base_probability?: number
          contract_id: string
          current_capacity_usd?: number
          id?: string
          last_priced_at?: string | null
          max_capacity_usd?: number
          max_payouts?: number
          name: string
          payout_mxn?: number
          payout_usd?: number
          premium_mxn?: number
          premium_usd?: number
          pricing_inputs?: Json | null
        }
        Update: {
          base_probability?: number
          contract_id?: string
          current_capacity_usd?: number
          id?: string
          last_priced_at?: string | null
          max_capacity_usd?: number
          max_payouts?: number
          name?: string
          payout_mxn?: number
          payout_usd?: number
          premium_mxn?: number
          premium_usd?: number
          pricing_inputs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_tiers_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      hedger_positions: {
        Row: {
          contract_id: string
          coverage_period_days: number | null
          currency: string
          expires_at: string
          id: string
          last_payout_date: string | null
          payment_intent_id: string | null
          payment_provider: string
          payout_amount_mxn: number
          payout_amount_usd: number
          payouts_made: number
          payouts_remaining: number | null
          premium_paid_mxn: number
          premium_paid_usd: number
          purchased_at: string
          reserved_usd: number | null
          status: string
          tier_id: string
          user_id: string
        }
        Insert: {
          contract_id: string
          coverage_period_days?: number | null
          currency: string
          expires_at: string
          id?: string
          last_payout_date?: string | null
          payment_intent_id?: string | null
          payment_provider: string
          payout_amount_mxn?: number
          payout_amount_usd?: number
          payouts_made?: number
          payouts_remaining?: number | null
          premium_paid_mxn?: number
          premium_paid_usd?: number
          purchased_at?: string
          reserved_usd?: number | null
          status?: string
          tier_id: string
          user_id: string
        }
        Update: {
          contract_id?: string
          coverage_period_days?: number | null
          currency?: string
          expires_at?: string
          id?: string
          last_payout_date?: string | null
          payment_intent_id?: string | null
          payment_provider?: string
          payout_amount_mxn?: number
          payout_amount_usd?: number
          payouts_made?: number
          payouts_remaining?: number | null
          premium_paid_mxn?: number
          premium_paid_usd?: number
          purchased_at?: string
          reserved_usd?: number | null
          status?: string
          tier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hedger_positions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedger_positions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "coverage_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedger_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_interest: {
        Row: {
          contract_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_interest_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_interest_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          contract_id: string | null
          created_at: string
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          contract_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          contract_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oracle_readings: {
        Row: {
          contract_id: string
          id: string
          read_at: string
          reading_type: string
          source: string
          trigger_met: boolean
          value: Json
        }
        Insert: {
          contract_id: string
          id?: string
          read_at?: string
          reading_type: string
          source: string
          trigger_met?: boolean
          value?: Json
        }
        Update: {
          contract_id?: string
          id?: string
          read_at?: string
          reading_type?: string
          source?: string
          trigger_met?: boolean
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "oracle_readings_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_mxn: number
          amount_usd: number
          completed_at: string | null
          contract_id: string
          created_at: string
          currency: string
          hedger_position_id: string
          id: string
          payment_provider: string
          status: string
          transfer_id: string | null
          trigger_day: string | null
        }
        Insert: {
          amount_mxn?: number
          amount_usd?: number
          completed_at?: string | null
          contract_id: string
          created_at?: string
          currency: string
          hedger_position_id: string
          id?: string
          payment_provider: string
          status?: string
          transfer_id?: string | null
          trigger_day?: string | null
        }
        Update: {
          amount_mxn?: number
          amount_usd?: number
          completed_at?: string | null
          contract_id?: string
          created_at?: string
          currency?: string
          hedger_position_id?: string
          id?: string
          payment_provider?: string
          status?: string
          transfer_id?: string | null
          trigger_day?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payouts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_hedger_position_id_fkey"
            columns: ["hedger_position_id"]
            isOneToOne: false
            referencedRelation: "hedger_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_history: {
        Row: {
          bs_inputs: Json
          bs_output: Json
          calculated_at: string
          contract_id: string
          id: string
          premium_usd_after: number
          premium_usd_before: number
          tier_id: string
        }
        Insert: {
          bs_inputs?: Json
          bs_output?: Json
          calculated_at?: string
          contract_id: string
          id?: string
          premium_usd_after?: number
          premium_usd_before?: number
          tier_id: string
        }
        Update: {
          bs_inputs?: Json
          bs_output?: Json
          calculated_at?: string
          contract_id?: string
          id?: string
          premium_usd_after?: number
          premium_usd_before?: number
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_history_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_history_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "coverage_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          conekta_customer_id: string | null
          created_at: string
          full_name: string | null
          id: string
          active_days: number
          last_seen_at: string | null
          notification_prefs: Json
          preferred_currency: string
          role: string
          stripe_customer_id: string | null
        }
        Insert: {
          conekta_customer_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          active_days?: number
          last_seen_at?: string | null
          notification_prefs?: Json
          preferred_currency?: string
          role?: string
          stripe_customer_id?: string | null
        }
        Update: {
          conekta_customer_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          active_days?: number
          last_seen_at?: string | null
          notification_prefs?: Json
          preferred_currency?: string
          role?: string
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      provider_positions: {
        Row: {
          actual_return_mxn: number | null
          actual_return_usd: number | null
          capital_deposited_mxn: number
          capital_deposited_usd: number
          contract_id: string
          currency: string
          deposited_at: string
          expected_return_mxn: number
          expected_return_usd: number
          id: string
          payment_intent_id: string | null
          payment_provider: string
          settled_at: string | null
          status: string
          tier_id: string
          user_id: string
        }
        Insert: {
          actual_return_mxn?: number | null
          actual_return_usd?: number | null
          capital_deposited_mxn?: number
          capital_deposited_usd?: number
          contract_id: string
          currency: string
          deposited_at?: string
          expected_return_mxn?: number
          expected_return_usd?: number
          id?: string
          payment_intent_id?: string | null
          payment_provider: string
          settled_at?: string | null
          status?: string
          tier_id: string
          user_id: string
        }
        Update: {
          actual_return_mxn?: number | null
          actual_return_usd?: number | null
          capital_deposited_mxn?: number
          capital_deposited_usd?: number
          contract_id?: string
          currency?: string
          deposited_at?: string
          expected_return_mxn?: number
          expected_return_usd?: number
          id?: string
          payment_intent_id?: string | null
          payment_provider?: string
          settled_at?: string | null
          status?: string
          tier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_positions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_positions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "coverage_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_contract_volume: {
        Args: { p_amount: number; p_contract_id: string }
        Returns: undefined
      }
      increment_tier_capacity: {
        Args: { p_amount: number; p_tier_id: string }
        Returns: undefined
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
