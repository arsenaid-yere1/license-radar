export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      clinicians: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          practice_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          practice_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          practice_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "clinicians_practice_id_fkey";
            columns: ["practice_id"];
            isOneToOne: false;
            referencedRelation: "practices";
            referencedColumns: ["id"];
          },
        ];
      };
      credentials: {
        Row: {
          created_at: string;
          id: string;
          owner_clinician_id: string | null;
          owner_kind: string;
          practice_id: string;
          title: string;
          type: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          owner_clinician_id?: string | null;
          owner_kind: string;
          practice_id: string;
          title: string;
          type: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_clinician_id?: string | null;
          owner_kind?: string;
          practice_id?: string;
          title?: string;
          type?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "credentials_owner_fkey";
            columns: ["practice_id", "owner_clinician_id"];
            isOneToOne: false;
            referencedRelation: "clinicians";
            referencedColumns: ["practice_id", "id"];
          },
          {
            foreignKeyName: "credentials_practice_id_fkey";
            columns: ["practice_id"];
            isOneToOne: false;
            referencedRelation: "practices";
            referencedColumns: ["id"];
          },
        ];
      };
      policy_coverage: {
        Row: {
          clinician_id: string;
          credential_id: string;
          owner_kind: string;
          practice_id: string;
          type: string;
        };
        Insert: {
          clinician_id: string;
          credential_id: string;
          owner_kind?: string;
          practice_id: string;
          type?: string;
        };
        Update: {
          clinician_id?: string;
          credential_id?: string;
          owner_kind?: string;
          practice_id?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "policy_coverage_clinician_fkey";
            columns: ["practice_id", "clinician_id"];
            isOneToOne: false;
            referencedRelation: "clinicians";
            referencedColumns: ["practice_id", "id"];
          },
          {
            foreignKeyName: "policy_coverage_credential_fkey";
            columns: ["practice_id", "credential_id", "type", "owner_kind"];
            isOneToOne: false;
            referencedRelation: "credentials";
            referencedColumns: ["practice_id", "id", "type", "owner_kind"];
          },
          {
            foreignKeyName: "policy_coverage_practice_id_fkey";
            columns: ["practice_id"];
            isOneToOne: false;
            referencedRelation: "practices";
            referencedColumns: ["id"];
          },
        ];
      };
      practice_memberships: {
        Row: {
          created_at: string;
          id: string;
          practice_id: string;
          revoked_at: string | null;
          role: string;
          state: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          practice_id: string;
          revoked_at?: string | null;
          role: string;
          state?: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          practice_id?: string;
          revoked_at?: string | null;
          role?: string;
          state?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "practice_memberships_practice_id_fkey";
            columns: ["practice_id"];
            isOneToOne: false;
            referencedRelation: "practices";
            referencedColumns: ["id"];
          },
        ];
      };
      practices: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_user_id: string;
          timezone: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_user_id?: string;
          timezone: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_user_id?: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_practice_invitation: {
        Args: { p_token_digest: string };
        Returns: Json;
      };
      cancel_practice_invitation: {
        Args: { p_expected_version: number; p_invitation_id: string };
        Returns: Json;
      };
      change_practice_member_role: {
        Args: {
          p_expected_version: number;
          p_membership_id: string;
          p_role: string;
        };
        Returns: Json;
      };
      create_practice: {
        Args: { p_name: string; p_timezone: string };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          owner_user_id: string;
          timezone: string;
          updated_at: string;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "practices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_practice_clinician: {
        Args: { p_name: string; p_practice_id: string; p_request_id: string };
        Returns: Json;
      };
      create_practice_credential: {
        Args: {
          p_covered_clinician_ids: string[];
          p_owner_clinician_id: string;
          p_owner_kind: string;
          p_practice_id: string;
          p_request_id: string;
          p_title: string;
          p_type: string;
        };
        Returns: Json;
      };
      create_practice_invitation: {
        Args: {
          p_email: string;
          p_practice_id: string;
          p_role: string;
          p_token_digest: string;
        };
        Returns: Json;
      };
      get_practice_reminder_recipient: {
        Args: { p_practice_id: string };
        Returns: Json;
      };
      list_practice_register: {
        Args: { p_practice_id: string };
        Returns: Json;
      };
      list_practice_team: { Args: { p_practice_id: string }; Returns: Json };
      preview_practice_invitation: {
        Args: { p_token_digest: string };
        Returns: Json;
      };
      reissue_practice_invitation: {
        Args: {
          p_expected_version: number;
          p_invitation_id: string;
          p_token_digest: string;
        };
        Returns: Json;
      };
      revoke_practice_member: {
        Args: { p_expected_version: number; p_membership_id: string };
        Returns: Json;
      };
      set_practice_reminder_recipient: {
        Args: {
          p_expected_version: number;
          p_membership_id: string;
          p_practice_id: string;
        };
        Returns: Json;
      };
      update_practice: {
        Args: {
          p_expected_version: number;
          p_name: string;
          p_practice_id: string;
          p_timezone: string;
        };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          owner_user_id: string;
          timezone: string;
          updated_at: string;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "practices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
