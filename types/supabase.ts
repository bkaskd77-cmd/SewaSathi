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
export type Availability = "now" | "today" | "scheduled";
export type IdDocumentStatus = "verified" | "pending" | "not_submitted";
export type VerificationCheck = "id" | "background" | "skill";

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
      categories: {
        Row: {
          slug: string;
          name_en: string;
          name_ne: string;
          descriptor: string;
          descriptor_ne: string;
          description: string;
          description_ne: string;
          cta_label: string;
          cta_label_ne: string;
          base_price_min: number;
          base_price_max: number;
          icon: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          slug: string;
          name_en: string;
          name_ne: string;
          descriptor: string;
          descriptor_ne: string;
          description: string;
          description_ne: string;
          cta_label: string;
          cta_label_ne: string;
          base_price_min: number;
          base_price_max: number;
          icon: string;
          sort_order: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      addresses: {
        Row: {
          id: string;
          profile_id: string;
          label: string;
          area_key: string;
          city: string;
          ward_number: number;
          tole: string;
          landmark: string;
          directions_note: string | null;
          lat: number | null;
          lng: number | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          label?: string;
          area_key: string;
          city: string;
          ward_number: number;
          tole: string;
          landmark: string;
          directions_note?: string | null;
          lat?: number | null;
          lng?: number | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["addresses"]["Insert"]>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          reference: string;
          customer_id: string;
          provider_id: string | null;
          category_slug: string;
          address_id: string;
          description: string;
          photo_url: string | null;
          urgency: string;
          scheduled_for: string | null;
          status: string;
          quoted_min: number;
          quoted_max: number;
          final_amount: number | null;
          payment_method: string;
          payment_status: string;
          triage_log_id: string | null;
          locale: string;
          created_at: string;
          updated_at: string;
          accepted_at: string | null;
          en_route_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          no_provider_found_at: string | null;
          cancelled_by: string | null;
          cancellation_reason: string | null;
          platform_fee: number | null;
          provider_earning: number | null;
          commission_bps: number | null;
          final_amount_reason: string | null;
          final_amount_approved_at: string | null;
          cancelled_by_role: string | null;
          cancellation_fee: number;
        };
        Insert: {
          id?: string;
          reference: string;
          customer_id: string;
          provider_id?: string | null;
          category_slug: string;
          address_id: string;
          description: string;
          photo_url?: string | null;
          urgency?: string;
          scheduled_for?: string | null;
          status?: string;
          quoted_min: number;
          quoted_max: number;
          final_amount?: number | null;
          payment_method?: string;
          payment_status?: string;
          triage_log_id?: string | null;
          locale?: string;
          created_at?: string;
          updated_at?: string;
          accepted_at?: string | null;
          en_route_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          no_provider_found_at?: string | null;
          cancelled_by?: string | null;
          cancellation_reason?: string | null;
          platform_fee?: number | null;
          provider_earning?: number | null;
          commission_bps?: number | null;
          final_amount_reason?: string | null;
          final_amount_approved_at?: string | null;
          cancelled_by_role?: string | null;
          cancellation_fee?: number;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [];
      };
      booking_status_history: {
        Row: {
          id: string;
          booking_id: string;
          from_status: string | null;
          to_status: string;
          changed_by: string | null;
          changed_by_role: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          from_status?: string | null;
          to_status: string;
          changed_by?: string | null;
          changed_by_role?: string;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["booking_status_history"]["Insert"]
        >;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          booking_id: string;
          method: string;
          amount: number;
          currency: string;
          status: string;
          our_reference: string;
          provider_txn_id: string | null;
          raw_response: Json | null;
          failure_reason: string | null;
          initiated_at: string | null;
          settled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          method: string;
          amount: number;
          currency?: string;
          status?: string;
          our_reference: string;
          provider_txn_id?: string | null;
          raw_response?: Json | null;
          failure_reason?: string | null;
          initiated_at?: string | null;
          settled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [];
      };
      refunds: {
        Row: {
          id: string;
          payment_id: string;
          amount: number;
          reason: string;
          status: string;
          requested_by: string | null;
          requested_by_role: string;
          provider_txn_id: string | null;
          raw_response: Json | null;
          created_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          payment_id: string;
          amount: number;
          reason: string;
          status?: string;
          requested_by?: string | null;
          requested_by_role?: string;
          provider_txn_id?: string | null;
          raw_response?: Json | null;
          created_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["refunds"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          profile_id: string;
          booking_id: string | null;
          kind: string;
          params: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          booking_id?: string | null;
          kind: string;
          params?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      provider_contacts: {
        Row: {
          provider_id: string;
          phone: string;
          updated_at: string;
        };
        Insert: {
          provider_id: string;
          phone: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["provider_contacts"]["Insert"]
        >;
        Relationships: [];
      };
      provider_leads: {
        Row: {
          id: string;
          full_name: string;
          phone: string;
          category_slug: string;
          area_key: string;
          years_experience: number;
          note: string | null;
          locale: string;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          phone: string;
          category_slug: string;
          area_key: string;
          years_experience: number;
          note?: string | null;
          locale?: string;
          status?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["provider_leads"]["Insert"]
        >;
        Relationships: [];
      };
      providers: {
        Row: {
          id: string;
          profile_id: string | null;
          display_name: string;
          bio: string;
          photo_url: string | null;
          service_areas: string[];
          years_experience: number;
          is_verified: boolean;
          verified_at: string | null;
          id_document_status: IdDocumentStatus;
          checks: VerificationCheck[];
          availability: Availability;
          /** Generated column — availability = 'now'. Never written directly. */
          is_available: boolean;
          is_active: boolean;
          base_rate: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          display_name: string;
          bio?: string;
          photo_url?: string | null;
          service_areas?: string[];
          years_experience?: number;
          is_verified?: boolean;
          verified_at?: string | null;
          id_document_status?: IdDocumentStatus;
          checks?: VerificationCheck[];
          availability?: Availability;
          is_active?: boolean;
          base_rate: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["providers"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "providers_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_categories: {
        Row: { provider_id: string; category_slug: string };
        Insert: { provider_id: string; category_slug: string };
        Update: Partial<{ provider_id: string; category_slug: string }>;
        Relationships: [
          {
            foreignKeyName: "provider_categories_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_categories_category_slug_fkey";
            columns: ["category_slug"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["slug"];
          },
        ];
      };
      provider_stats: {
        Row: {
          provider_id: string;
          rating_avg: number;
          rating_count: number;
          jobs_completed: number;
          completion_rate: number;
          avg_response_minutes: number;
          last_active_at: string | null;
          updated_at: string;
        };
        Insert: {
          provider_id: string;
          rating_avg?: number;
          rating_count?: number;
          jobs_completed?: number;
          completion_rate?: number;
          avg_response_minutes?: number;
          last_active_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["provider_stats"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "provider_stats_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_reviews: {
        Row: {
          id: string;
          provider_id: string;
          author_name: string;
          rating: number;
          comment: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          provider_id: string;
          author_name: string;
          rating: number;
          comment: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["provider_reviews"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "provider_reviews_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
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
