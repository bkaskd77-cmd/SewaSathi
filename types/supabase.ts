/**
 * Database types.
 *
 * Hand-written to match supabase/migrations/ — the generator needs network
 * access to the project, which this environment does not have. Regenerate
 * (and let the generator win) with:
 *
 *   npx supabase gen types typescript --project-id sfjsoyzosprwpnrtynpp > types/supabase.ts
 *
 * If you change a migration, change this file in the same commit.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "customer" | "provider" | "admin";
export type PreferredLanguage = "en" | "ne";
export type Urgency = "emergency" | "soon" | "routine";
/** Which path produced a triage row — see supabase/migrations. */
export type TriageSource = "claude" | "cache" | "fallback";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          phone: string | null;
          preferred_language: PreferredLanguage;
          role: UserRole;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone?: string | null;
          preferred_language?: PreferredLanguage;
          role?: UserRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          phone?: string | null;
          preferred_language?: PreferredLanguage;
          role?: UserRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      triage_logs: {
        Row: {
          id: string;
          created_at: string;
          user_id: string | null;
          input_text: string | null;
          had_photo: boolean;
          category: string;
          urgency: Urgency;
          price_low: number;
          price_high: number;
          source: TriageSource;
          model: string | null;
          latency_ms: number | null;
          hazard: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          user_id?: string | null;
          input_text?: string | null;
          had_photo?: boolean;
          category: string;
          urgency: Urgency;
          price_low: number;
          price_high: number;
          source: TriageSource;
          model?: string | null;
          latency_ms?: number | null;
          hazard?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          user_id?: string | null;
          input_text?: string | null;
          had_photo?: boolean;
          category?: string;
          urgency?: Urgency;
          price_low?: number;
          price_high?: number;
          source?: TriageSource;
          model?: string | null;
          latency_ms?: number | null;
          hazard?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "triage_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
