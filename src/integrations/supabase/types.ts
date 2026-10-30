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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_memberships: {
        Row: {
          account_id: string
          available: boolean
          created_at: string
          display_name: string
          last_assigned_at: string | null
          role: string
          user_id: string
          whatsapp_phone: string
        }
        Insert: {
          account_id: string
          available?: boolean
          created_at?: string
          display_name?: string
          last_assigned_at?: string | null
          role?: string
          user_id: string
          whatsapp_phone?: string
        }
        Update: {
          account_id?: string
          available?: boolean
          created_at?: string
          display_name?: string
          last_assigned_at?: string | null
          role?: string
          user_id?: string
          whatsapp_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          ai_model: string
          auto_pause_bot: boolean
          brand: string
          brand_foreground: string
          business_hours: Json
          created_at: string
          created_by_user_id: string | null
          id: string
          initials: string
          name: string
          product: string
          qualification_rules: string
          setter_prompt: string
          standard_tags: string[]
          tagline: string
          template: string
          ticket_label: string
        }
        Insert: {
          ai_model?: string
          auto_pause_bot?: boolean
          brand: string
          brand_foreground: string
          business_hours?: Json
          created_at?: string
          created_by_user_id?: string | null
          id: string
          initials: string
          name: string
          product?: string
          qualification_rules?: string
          setter_prompt?: string
          standard_tags?: string[]
          tagline?: string
          template?: string
          ticket_label?: string
        }
        Update: {
          ai_model?: string
          auto_pause_bot?: boolean
          brand?: string
          brand_foreground?: string
          business_hours?: Json
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          initials?: string
          name?: string
          product?: string
          qualification_rules?: string
          setter_prompt?: string
          standard_tags?: string[]
          tagline?: string
          template?: string
          ticket_label?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          account_id: string
          created_at: string
          id: string
          input_tokens: number
          lead_id: string | null
          model: string
          output_tokens: number
          total_tokens: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          input_tokens?: number
          lead_id?: string | null
          model: string
          output_tokens?: number
          total_tokens?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          input_tokens?: number
          lead_id?: string | null
          model?: string
          output_tokens?: number
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          account_id: string
          at: string
          created_at: string
          id: string
          kind: string
          lead_id: string
          status: string
        }
        Insert: {
          account_id: string
          at: string
          created_at?: string
          id?: string
          kind?: string
          lead_id: string
          status?: string
        }
        Update: {
          account_id?: string
          at?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_enrollments: {
        Row: {
          account_id: string
          advisor_replied: boolean
          cancel_reason: string | null
          created_at: string
          current_node: string | null
          current_step: number
          flow_id: string
          id: string
          lead_id: string
          locked_until: string | null
          next_run_at: string
          replied: boolean
          status: string
          trigger_reason: string | null
        }
        Insert: {
          account_id: string
          advisor_replied?: boolean
          cancel_reason?: string | null
          created_at?: string
          current_node?: string | null
          current_step?: number
          flow_id: string
          id?: string
          lead_id: string
          locked_until?: string | null
          next_run_at?: string
          replied?: boolean
          status?: string
          trigger_reason?: string | null
        }
        Update: {
          account_id?: string
          advisor_replied?: boolean
          cancel_reason?: string | null
          created_at?: string
          current_node?: string | null
          current_step?: number
          flow_id?: string
          id?: string
          lead_id?: string
          locked_until?: string | null
          next_run_at?: string
          replied?: boolean
          status?: string
          trigger_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_enrollments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_enrollments_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          account_id: string
          allow_reentry: boolean
          active: boolean
          created_at: string
          id: string
          name: string
          steps: Json
          stop_on_reply: boolean
          trigger_type: string
          trigger_value: string
          trigger_config: Json
        }
        Insert: {
          account_id: string
          allow_reentry?: boolean
          active?: boolean
          created_at?: string
          id?: string
          name: string
          steps?: Json
          stop_on_reply?: boolean
          trigger_type?: string
          trigger_value?: string
          trigger_config?: Json
        }
        Update: {
          account_id?: string
          allow_reentry?: boolean
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          steps?: Json
          stop_on_reply?: boolean
          trigger_type?: string
          trigger_value?: string
          trigger_config?: Json
        }
        Relationships: [
          {
            foreignKeyName: "flows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          account_id: string
          body: string
          created_at: string
          id: string
          kind: string
          lead_id: string
        }
        Insert: {
          account_id: string
          body: string
          created_at?: string
          id?: string
          kind: string
          lead_id: string
        }
        Update: {
          account_id?: string
          body?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          account_id: string
          ad_id: string | null
          ad_name: string | null
          ai_summary: string | null
          assigned_to: string | null
          bot_active: boolean
          budget: number | null
          created_at: string
          ctwa_clid: string | null
          down_payment: number | null
          id: string
          intent: string | null
          name: string
          notes: string
          opt_out_reason: string | null
          opted_out_at: string | null
          outcome: string | null
          phone: string
          source: string
          stage: number
          tags: string[]
          term_months: number | null
        }
        Insert: {
          account_id: string
          ad_id?: string | null
          ad_name?: string | null
          ai_summary?: string | null
          assigned_to?: string | null
          bot_active?: boolean
          budget?: number | null
          created_at?: string
          ctwa_clid?: string | null
          down_payment?: number | null
          id?: string
          intent?: string | null
          name: string
          notes?: string
          opt_out_reason?: string | null
          opted_out_at?: string | null
          outcome?: string | null
          phone?: string
          source?: string
          stage?: number
          tags?: string[]
          term_months?: number | null
        }
        Update: {
          account_id?: string
          ad_id?: string | null
          ad_name?: string | null
          ai_summary?: string | null
          assigned_to?: string | null
          bot_active?: boolean
          budget?: number | null
          created_at?: string
          ctwa_clid?: string | null
          down_payment?: number | null
          id?: string
          intent?: string | null
          name?: string
          notes?: string
          opt_out_reason?: string | null
          opted_out_at?: string | null
          outcome?: string | null
          phone?: string
          source?: string
          stage?: number
          tags?: string[]
          term_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          account_id: string
          created_at: string
          id: string
          kind: string
          name: string
          storage_path: string | null
          url: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          storage_path?: string | null
          url: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          storage_path?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_applied_at: string | null
          ai_attempts: number
          ai_intent: string | null
          ai_last_error: string | null
          ai_processing_at: string | null
          ai_status: string
          body: string
          created_at: string
          id: string
          lead_id: string
          sender: string
          wa_message_id: string | null
          wa_status: string | null
        }
        Insert: {
          ai_applied_at?: string | null
          ai_attempts?: number
          ai_intent?: string | null
          ai_last_error?: string | null
          ai_processing_at?: string | null
          ai_status?: string
          body: string
          created_at?: string
          id?: string
          lead_id: string
          sender: string
          wa_message_id?: string | null
          wa_status?: string | null
        }
        Update: {
          ai_applied_at?: string | null
          ai_attempts?: number
          ai_intent?: string | null
          ai_last_error?: string | null
          ai_processing_at?: string | null
          ai_status?: string
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          sender?: string
          wa_message_id?: string | null
          wa_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          account_id: string
          body: string
          created_at: string
          id: string
          lead_id: string | null
          read_at: string | null
          title: string
          user_id: string
          wa_status: string | null
        }
        Insert: {
          account_id: string
          body: string
          created_at?: string
          id?: string
          lead_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
          wa_status?: string | null
        }
        Update: {
          account_id?: string
          body?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
          wa_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_channels: {
        Row: {
          access_token: string
          account_id: string
          app_secret: string
          enabled: boolean
          last_checked_at: string | null
          last_error: string | null
          phone_number_id: string
          updated_at: string
          verify_token: string
          waba_id: string
        }
        Insert: {
          access_token?: string
          account_id: string
          app_secret?: string
          enabled?: boolean
          last_checked_at?: string | null
          last_error?: string | null
          phone_number_id?: string
          updated_at?: string
          verify_token?: string
          waba_id?: string
        }
        Update: {
          access_token?: string
          account_id?: string
          app_secret?: string
          enabled?: boolean
          last_checked_at?: string | null
          last_error?: string | null
          phone_number_id?: string
          updated_at?: string
          verify_token?: string
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_channels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          account_id: string
          body: string
          category: string
          header_format: string | null
          language: string
          name: string
          params: string[]
          synced_at: string
        }
        Insert: {
          account_id: string
          body?: string
          category?: string
          header_format?: string | null
          language: string
          name: string
          params?: string[]
          synced_at?: string
        }
        Update: {
          account_id?: string
          body?: string
          category?: string
          header_format?: string | null
          language?: string
          name?: string
          params?: string[]
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_lead: {
        Args: { p_lead_id: string; p_round_robin: boolean; p_user_ids: string[] }
        Returns: string | null
      }
      claim_inbound_message: {
        Args: {
          p_expire_after?: string
          p_max_attempts?: number
          p_message_id: string
          p_stale_after?: string
        }
        Returns: string
      }
      has_account_role: {
        Args: { p_account_id: string; p_roles: string[] }
        Returns: boolean
      }
      is_account_member: { Args: { p_account_id: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
