/**
 * The eight long-form documents, matching the check constraint on
 * `content_documents.slug`. Named once here rather than written out at each of the four
 * places below, which is how the four-slug version came to be four copies.
 * `DOCUMENT_SLUGS` in `lib/content/documents.ts` is the other copy and a test compares
 * both against the migration.
 */
export type ContentDocumentSlug =
  | "terms"
  | "privacy"
  | "refunds"
  | "standards"
  | "help"
  | "help/complaint"
  | "about"
  | "contact";

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
/**
 * The availability column AS STORED. The state a customer is shown is wider
 * (`on_job`, `busy`) and is computed by `providerState` in lib/provider from
 * this plus two timestamps — this file describes the database, so it keeps the
 * narrow union the check constraint actually enforces.
 */
export type Availability = "now" | "today" | "scheduled";
export type IdDocumentStatus = "verified" | "pending" | "not_submitted";
export type VerificationCheck = "id" | "background" | "skill";
/**
 * Named here rather than imported from `lib/booking` and `lib/config`, because
 * this file describes the database and must not depend on the application. The
 * pair is checked: `npm run check:transitions` compares the claim machine in
 * TypeScript against `claim_transition_allowed` in SQL.
 */
export type ClaimStatusName =
  | "open"
  | "dispatched"
  | "attended"
  | "resolved"
  | "withdrawn"
  | "rejected";
export type ClaimVerdictName =
  | "sameFault"
  | "differentProblem"
  | "nothingWrong"
  | "customerCaused";

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
          /**
           * The customer has asked not to appear in the homepage activity strip.
           *
           * NOT NULLABLE, and false is a preference nobody has expressed rather
           * than a measurement — the one place rule 6 does not bite, because
           * "has not opted out" is a true statement about somebody who has not.
           *
           * It is also one of exactly three columns a browser may write; see
           * `20260927000005_profiles_column_grants.sql` for the other two and
           * for what a session can no longer touch.
           */
          hide_from_activity: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone?: string | null;
          preferred_language?: PreferredLanguage;
          role?: UserRole;
          hide_from_activity?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          phone?: string | null;
          preferred_language?: PreferredLanguage;
          role?: UserRole;
          hide_from_activity?: boolean;
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
          pricing_source: string;
          pricing_checked_at: string | null;
          pricing_note: string | null;
          pricing_confidence: string;
          pricing_model: string;
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
          pricing_source?: string;
          pricing_checked_at?: string | null;
          pricing_note?: string | null;
          pricing_confidence?: string;
          pricing_model?: string;
          icon: string;
          sort_order: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      category_price_revisions: {
        Row: {
          id: string;
          category_slug: string;
          decision: "approved" | "rejected";
          /** The band published when the decision was taken, kept rather than joined. */
          old_min: number;
          old_max: number;
          /** Equal to old_* on a rejection: nothing was written. */
          new_min: number;
          new_max: number;
          /** What the data asked for — what a rejection is about, and what suppression keys on. */
          proposed_min: number;
          proposed_max: number;
          sample: number;
          winsorised: number;
          capped: boolean;
          actor_id: string | null;
          reason: string;
          decided_at: string;
        };
        Insert: {
          id?: string;
          category_slug: string;
          decision: "approved" | "rejected";
          old_min: number;
          old_max: number;
          new_min: number;
          new_max: number;
          proposed_min: number;
          proposed_max: number;
          sample: number;
          winsorised: number;
          capped: boolean;
          actor_id?: string | null;
          reason: string;
          decided_at?: string;
        };
        /** Append-only: `refuse_rewrite()` refuses UPDATE and DELETE for every caller. */
        Update: never;
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
          /**
           * Trust lives on the address, not the account. See
           * lib/abuse/address-trust.ts.
           */
          upheld_no_shows: number;
          first_confirmed_at: string | null;
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
          upheld_no_shows?: number;
          first_confirmed_at?: string | null;
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
          quoted_min: number | null;
          quoted_max: number | null;
          /** The category band's floor as published when this was booked. */
          /**
           * NULL ON A SURVEY BOOKING. `20260916000001_survey_quotes.sql`
           * dropped the not-null when movers stopped carrying a band, and this
           * file was not updated with it — so every reader believed a figure
           * was always there. `Number(null)` is 0, which is the exact shape of
           * bug the survey phase existed to prevent.
           */
          band_min: number | null;
          /** The approved band revision in force at quote time. Null: none on record — the band came from the launch research, or the quote was a survey. Never backfilled. */
          band_revision_id: string | null;
          /** What a past no-show trip added to this bill. NULL = not considered, 0 = considered and nothing owed. */
          trip_debt_added_rupees: number | null;
          final_amount: number | null;
          payment_method: string;
          payment_status: string;
          triage_log_id: string | null;
          locale: string;
          /** Null means the booking predates versioning — never version 1. */
          terms_version: number | null;
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
          /**
           * What the parts cost, as the professional stated it.
           *
           * NULL IS "NOBODY SAID", NEVER ZERO — rule 6. A job with no parts
           * records 0; every booking from before the column, and every one
           * where the box was left blank, is null. Only a stated figure can
           * come off a guarantee refund ceiling.
           */
          materials_rupees: number | null;
          /** Phase 10: protect the trip, not the booking. */
          confirmation_required: boolean;
          confirmed_at: string | null;
          confirmation_hold_until: string | null;
          cancelled_by_role: string | null;
          cancellation_fee: number;
          first_choice_provider_id: string | null;
          quote_model: string;
          surveyed_at: string | null;
          quote_expires_at: string | null;
          quote_approved_at: string | null;
          quote_declined_at: string | null;
          overbook_offered_by: string | null;
          overbook_missed_at: string | null;
          provider_visit_reviewed_at: string | null;
          /*
           * How long the job takes, and which of three answers to that.
           * `band_slug` names the product; the estimate is copied from it by
           * a trigger; the provider's own figure sits BESIDE ours rather than
           * over it, because estimate-against-actual per product is the only
           * thing that ever makes the researched durations better.
           */
          band_slug: string | null;
          band_source: string | null;
          /** When the card put its product question. Set on asking, not answering. */
          band_asked_at: string | null;
          /**
           * The product the professional says it actually is, after seeing the
           * job. Stored beside the customer's statement, never over it, and
           * only in force once they have agreed to it.
           */
          provider_band_slug: string | null;
          provider_band_at: string | null;
          provider_band_reason: string | null;
          band_change_approved_at: string | null;
          band_change_declined_at: string | null;
          /**
           * The return visit, and whether anybody pays for it.
           *
           * `billable` is TRUE on every ordinary booking — the column defaults
           * that way and a check constraint refuses a free booking that is not
           * a guarantee visit. The visit still carries the parent's band,
           * because that band is what the professional's time is worth and
           * what the customer is charged if the verdict says the fault was not
           * ours.
           */
          guarantee_claim_id: string | null;
          billable: boolean;
          estimated_working_minutes: number | null;
          estimated_elapsed_days: number | null;
          provider_estimated_working_minutes: number | null;
          provider_estimated_elapsed_days: number | null;
          actual_working_minutes: number | null;
          duration_implausible_at: string | null;
          overbook_offered_at: string | null;
          opened_at: string | null;
          reassigned_at: string | null;
          commission_basis: number | null;
          commission_floor_waived: boolean;
          customer_reported_amount: number | null;
          amount_mismatch_at: string | null;
          /**
           * How a disagreement over the cash figure was settled.
           *
           * `amount_settled_source` is null until somebody decides — that is
           * the rule-6 distinction between "nobody has looked" and "decided
           * in the customer's favour", so nothing here carries a default.
           * `amount_mismatch_at` set with `..._resolved_at` null is the open
           * set the admin queue reads.
           */
          amount_mismatch_resolved_at: string | null;
          amount_mismatch_resolved_by: string | null;
          amount_mismatch_note: string | null;
          amount_settled_source: "customer" | "provider" | "adjudicated" | null;
          payout_due_at: string | null;
          /**
           * The professional's own money, deferred rather than deducted.
           *
           * NULL is "no hold applies" — a short guarantee window, or a job
           * settled before the column existed. `0` would mean held and rounded
           * to nothing, which is a different fact. Both holdback columns are
           * null together or set together; `bookings_holdback_shape` enforces
           * it.
           */
          payout_holdback_rupees: number | null;
          payout_holdback_until: string | null;
          /**
           * The customer stopped waiting and opened the job to everybody.
           * NOT a refusal: nothing is counted against the professional and
           * they may still claim it.
           */
          widened_by_customer_at: string | null;
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
          /**
           * Null only on a `quote_model = 'survey'` booking, which has no band
           * until somebody has been to look — and `bookings_band_only_null_for_survey`
           * is what makes that impossible anywhere else.
           */
          quoted_min?: number | null;
          quoted_max?: number | null;
          /** Filled by `freeze_booking_band` when omitted, so never required. */
          band_min?: number | null;
          band_revision_id?: string | null;
          trip_debt_added_rupees?: number | null;
          final_amount?: number | null;
          payment_method?: string;
          payment_status?: string;
          triage_log_id?: string | null;
          locale?: string;
          terms_version?: number | null;
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
          materials_rupees?: number | null;
          confirmation_required?: boolean;
          confirmed_at?: string | null;
          confirmation_hold_until?: string | null;
          cancelled_by_role?: string | null;
          cancellation_fee?: number;
          first_choice_provider_id?: string | null;
          quote_model?: string;
          surveyed_at?: string | null;
          quote_expires_at?: string | null;
          quote_approved_at?: string | null;
          quote_declined_at?: string | null;
          overbook_offered_by?: string | null;
          overbook_missed_at?: string | null;
          provider_visit_reviewed_at?: string | null;
          band_slug?: string | null;
          band_source?: string | null;
          band_asked_at?: string | null;
          provider_band_slug?: string | null;
          provider_band_at?: string | null;
          provider_band_reason?: string | null;
          band_change_approved_at?: string | null;
          band_change_declined_at?: string | null;
          guarantee_claim_id?: string | null;
          billable?: boolean;
          estimated_working_minutes?: number | null;
          estimated_elapsed_days?: number | null;
          provider_estimated_working_minutes?: number | null;
          provider_estimated_elapsed_days?: number | null;
          actual_working_minutes?: number | null;
          duration_implausible_at?: string | null;
          overbook_offered_at?: string | null;
          opened_at?: string | null;
          reassigned_at?: string | null;
          commission_basis?: number | null;
          commission_floor_waived?: boolean;
          customer_reported_amount?: number | null;
          amount_mismatch_at?: string | null;
          amount_mismatch_resolved_at?: string | null;
          amount_mismatch_resolved_by?: string | null;
          amount_mismatch_note?: string | null;
          amount_settled_source?: "customer" | "provider" | "adjudicated" | null;
          payout_due_at?: string | null;
          payout_holdback_rupees?: number | null;
          payout_holdback_until?: string | null;
          widened_by_customer_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [];
      };
      survey_visit_fees: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          outcome: string;
          amount: number;
          status: string;
          decided_by: string | null;
          decided_at: string | null;
          decision_note: string | null;
          counts_for_month: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          outcome: string;
          amount: number;
          status?: string;
          decided_by?: string | null;
          decided_at?: string | null;
          decision_note?: string | null;
          /** Set from `created_at` by `enforce_survey_visit_fee`. */
          counts_for_month?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["survey_visit_fees"]["Insert"]
        >;
        Relationships: [];
      };
      customer_visit_flags: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          customer_id: string;
          flag: string;
          submitted_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          customer_id: string;
          flag: string;
          submitted_at?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["customer_visit_flags"]["Insert"]
        >;
        Relationships: [];
      };
      commission_appeals: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          reason: string;
          status: string;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          reason: string;
          status?: string;
          resolved_by?: string | null;
          resolved_at?: string | null;
          resolution_note?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["commission_appeals"]["Insert"]
        >;
        Relationships: [];
      };
      cron_runs: {
        Row: {
          id: string;
          job: string;
          started_at: string;
          finished_at: string | null;
          ok: boolean | null;
          summary: Record<string, unknown> | null;
          error: string | null;
        };
        Insert: {
          job: string;
          started_at?: string;
          finished_at?: string | null;
          ok?: boolean | null;
          summary?: unknown;
          error?: string | null;
        };
        /* Append-only in the database, service role included. */
        Update: never;
        Relationships: [];
      };
      security_events: {
        Row: {
          id: number;
          at: string;
          actor_id: string | null;
          actor_role: string;
          kind: string;
          subject_type: string | null;
          subject_id: string | null;
          detail: Record<string, unknown>;
          request_ip: string | null;
          user_agent: string | null;
        };
        Insert: {
          at?: string;
          actor_id?: string | null;
          actor_role?: string;
          kind: string;
          subject_type?: string | null;
          subject_id?: string | null;
          detail?: Record<string, unknown>;
          request_ip?: string | null;
          user_agent?: string | null;
        };
        /* Append-only in the database. There is no legitimate update. */
        Update: never;
        Relationships: [];
      };
      provider_documents: {
        Row: {
          id: string;
          provider_id: string | null;
          profile_id: string;
          kind: string;
          storage_path: string;
          mime_type: string;
          byte_size: number;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          rejection_reason: string | null;
          uploaded_at: string;
          delete_after: string | null;
          application_id: string | null;
          expires_on: string | null;
          capture_quality: number | null;
        };
        Insert: {
          id?: string;
          provider_id?: string | null;
          profile_id: string;
          kind: string;
          storage_path: string;
          mime_type: string;
          byte_size: number;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          uploaded_at?: string;
          delete_after?: string | null;
          application_id?: string | null;
          expires_on?: string | null;
          capture_quality?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["provider_documents"]["Insert"]
        >;
        Relationships: [];
      };

      /* ---- Phase 10: provider onboarding ---- */

      /* ---- Phase 10: customer-side fraud ---- */

      booking_arrivals: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          arrived_at: string;
          coarse_lat: number | null;
          coarse_lng: number | null;
          gave_up_at: string | null;
          waited_minutes: number;
          contact_attempts: number;
          /** Object key in the private arrival-photos bucket. Null: none offered. */
          photo_path: string | null;
          /** Camera clock minus our receipt time, signed. Null: not recorded. */
          exif_skew_minutes: number | null;
          /* Judgements with their evidence. Null is "not checked", never "clean". */
          duplicate_verdict:
            | "unseen"
            | "retry"
            | "flag"
            | "reject"
            | "not-compared"
            | null;
          duplicate_distance: number | null;
          freshness_verdict:
            | "fresh"
            | "stale"
            | "no-capture-time"
            | "not-checked"
            | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          arrived_at?: string;
          coarse_lat?: number | null;
          coarse_lng?: number | null;
          gave_up_at?: string | null;
          waited_minutes?: number;
          contact_attempts?: number;
          photo_path?: string | null;
          exif_skew_minutes?: number | null;
          duplicate_verdict?:
            | "unseen"
            | "retry"
            | "flag"
            | "reject"
            | "not-compared"
            | null;
          duplicate_distance?: number | null;
          freshness_verdict?:
            | "fresh"
            | "stale"
            | "no-capture-time"
            | "not-checked"
            | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["booking_arrivals"]["Insert"]
        >;
        Relationships: [];
      };

      content_strings: {
        Row: {
          id: string;
          message_key: string;
          locale: "en" | "ne";
          value: string;
          tier: "money" | "safety" | "legal" | "staff" | "none";
          updated_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_key: string;
          locale: "en" | "ne";
          value: string;
          tier: "money" | "safety" | "legal" | "staff" | "none";
          updated_by?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_strings"]["Insert"]>;
        Relationships: [];
      };

      content_string_revisions: {
        Row: {
          id: string;
          message_key: string;
          locale: "en" | "ne";
          /** Null means there was no override — the key was reading from the JSON. */
          previous_value: string | null;
          new_value: string;
          tier: string;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          message_key: string;
          locale: "en" | "ne";
          previous_value?: string | null;
          new_value: string;
          tier: string;
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["content_string_revisions"]["Insert"]
        >;
        Relationships: [];
      };

      content_documents: {
        Row: {
          slug: ContentDocumentSlug;
          /** Null until somebody publishes a version. */
          live_version: number | null;
          updated_at: string;
        };
        Insert: {
          slug: ContentDocumentSlug;
          live_version?: number | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_documents"]["Insert"]>;
        Relationships: [];
      };

      content_document_versions: {
        Row: {
          id: string;
          slug: ContentDocumentSlug;
          version: number;
          body_en: string;
          body_ne: string;
          effective_from: string;
          published_by: string | null;
          published_at: string;
        };
        Insert: {
          id?: string;
          slug: ContentDocumentSlug;
          version: number;
          body_en: string;
          body_ne: string;
          /* Defaults to now() since 20261004000004 — the publish path cannot set it. */
          effective_from?: string;
          published_by?: string | null;
          published_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["content_document_versions"]["Insert"]
        >;
        Relationships: [];
      };

      booking_photos: {
        Row: {
          id: string;
          booking_id: string;
          storage_path: string;
          position: number;
          taken_at: string | null;
          hash: string | null;
          duplicate_verdict:
            | "unseen"
            | "retry"
            | "flag"
            | "reject"
            | "not-compared"
            | null;
          duplicate_distance: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          storage_path: string;
          position: number;
          taken_at?: string | null;
          hash?: string | null;
          duplicate_verdict?:
            | "unseen"
            | "retry"
            | "flag"
            | "reject"
            | "not-compared"
            | null;
          duplicate_distance?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_photos"]["Insert"]>;
        Relationships: [];
      };

      photo_hashes: {
        Row: {
          id: string;
          hash: string;
          kind: "arrival" | "booking" | "claim";
          booking_id: string | null;
          account_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          hash: string;
          kind: "arrival" | "booking" | "claim";
          booking_id?: string | null;
          account_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["photo_hashes"]["Insert"]>;
        Relationships: [];
      };

      content_document_working_copies: {
        Row: {
          slug: ContentDocumentSlug;
          body_en: string;
          body_ne: string;
          updated_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          slug: ContentDocumentSlug;
          body_en: string;
          body_ne: string;
          updated_by?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["content_document_working_copies"]["Insert"]
        >;
        Relationships: [];
      };

      booking_contact_attempts: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          channel: "call" | "whatsapp";
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          channel: "call" | "whatsapp";
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["booking_contact_attempts"]["Insert"]
        >;
        Relationships: [];
      };

      no_show_claims: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          customer_id: string;
          status: string;
          trip_rupees_paid: number;
          debt_rupees: number;
          customer_disputed_at: string | null;
          customer_note: string | null;
          decided_by: string | null;
          decided_at: string | null;
          decision_reason: string | null;
          seconds_on_evidence: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          customer_id: string;
          status?: string;
          trip_rupees_paid?: number;
          debt_rupees?: number;
          customer_disputed_at?: string | null;
          customer_note?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          decision_reason?: string | null;
          seconds_on_evidence?: number | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["no_show_claims"]["Insert"]
        >;
        Relationships: [];
      };

      customer_risk: {
        Row: {
          profile_id: string;
          no_shows: number;
          false_addresses: number;
          completed_jobs: number;
          trip_debt_rupees: number;
          /** Set while the customer is disputing the debt. Nothing is recovered while it is set. */
          trip_debt_disputed_at: string | null;
          trip_debt_dispute_note: string | null;
          banned_at: string | null;
          banned_reason: string | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          no_shows?: number;
          false_addresses?: number;
          completed_jobs?: number;
          trip_debt_rupees?: number;
          trip_debt_disputed_at?: string | null;
          trip_debt_dispute_note?: string | null;
          banned_at?: string | null;
          banned_reason?: string | null;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["customer_risk"]["Insert"]
        >;
        Relationships: [];
      };


      provider_applications: {
        Row: {
          id: string;
          profile_id: string;
          full_name: string | null;
          full_name_ne: string | null;
          date_of_birth: string | null;
          trades: string[];
          years_experience: number | null;
          service_areas: string[];
          citizenship_number: string | null;
          pan_number: string | null;
          payout_method: string | null;
          payout_account: string | null;
          /** Null means we never asked — it postdates three applications. */
          payout_account_name: string | null;
          payout_bank_name: string | null;
          step: number;
          status: string;
          risk_score: number | null;
          submitted_at: string | null;
          device_fingerprint: string | null;
          locale: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          full_name?: string | null;
          full_name_ne?: string | null;
          date_of_birth?: string | null;
          trades?: string[];
          years_experience?: number | null;
          service_areas?: string[];
          citizenship_number?: string | null;
          pan_number?: string | null;
          payout_method?: string | null;
          payout_account?: string | null;
          payout_account_name?: string | null;
          payout_bank_name?: string | null;
          step?: number;
          status?: string;
          risk_score?: number | null;
          submitted_at?: string | null;
          device_fingerprint?: string | null;
          locale?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["provider_applications"]["Insert"]
        >;
        Relationships: [];
      };

      application_match_keys: {
        Row: {
          id: string;
          application_id: string;
          kind: string;
          key_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          kind: string;
          key_hash: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["application_match_keys"]["Insert"]
        >;
        Relationships: [];
      };

      application_consents: {
        Row: {
          id: string;
          application_id: string;
          profile_id: string;
          consent_version: string;
          scope: string[];
          granted_at: string;
          request_ip: string | null;
          user_agent: string | null;
          withdrawn_at: string | null;
        };
        Insert: {
          id?: string;
          application_id: string;
          profile_id: string;
          consent_version: string;
          scope: string[];
          granted_at?: string;
          request_ip?: string | null;
          user_agent?: string | null;
          withdrawn_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["application_consents"]["Insert"]
        >;
        Relationships: [];
      };

      application_references: {
        Row: {
          id: string;
          application_id: string;
          name: string;
          phone: string;
          relationship: string | null;
          outcome: string;
          contacted_by: string | null;
          contacted_at: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          name: string;
          phone: string;
          relationship?: string | null;
          outcome?: string;
          contacted_by?: string | null;
          contacted_at?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["application_references"]["Insert"]
        >;
        Relationships: [];
      };

      application_assessments: {
        Row: {
          id: string;
          application_id: string;
          category_slug: string;
          assessor_id: string;
          assessed_at: string;
          method: string;
          result: string;
          notes: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          category_slug: string;
          assessor_id: string;
          assessed_at?: string;
          method?: string;
          result: string;
          notes: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["application_assessments"]["Insert"]
        >;
        Relationships: [];
      };

      application_decisions: {
        Row: {
          id: string;
          application_id: string;
          decision: string;
          decided_by: string;
          decided_at: string;
          reason: string;
          reason_ne: string | null;
          internal_note: string | null;
          risk_score_at_decision: number | null;
          seconds_on_evidence: number | null;
        };
        Insert: {
          id?: string;
          application_id: string;
          decision: string;
          decided_by: string;
          decided_at?: string;
          reason: string;
          reason_ne?: string | null;
          internal_note?: string | null;
          risk_score_at_decision?: number | null;
          seconds_on_evidence?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["application_decisions"]["Insert"]
        >;
        Relationships: [];
      };
      booking_refusals: {
        Row: {
          id: string;
          booking_id: string;
          provider_id: string;
          kind: string;
          /** Free text, as the professional typed it. */
          reason: string | null;
          /**
           * The same refusal from a closed set, so it can be counted.
           *
           * NULL is "not recorded" — every row predating the column, and every
           * professional who skipped the question — never "no reason". A stated
           * preference rather than a judgement, and not a ranking input:
           * `booking_refusals_reason_code_known` holds the set, and
           * `REFUSAL_REASON_CODES` in lib/provider/fit.ts is the same list in
           * TypeScript.
           */
          reason_code: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          provider_id: string;
          kind?: string;
          reason?: string | null;
          reason_code?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["booking_refusals"]["Insert"]
        >;
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
      /**
       * Where a professional is paid.
       *
       * NO BROWSER REACHES THIS TABLE — `anon` and `authenticated` are revoked
       * outright rather than filtered by a policy, so every read is
       * service-role and audited. The type exists because the payout run and
       * the admin screen will reach it through `createAdminClient()`.
       *
       * `Update` is deliberately narrow: the immutability trigger refuses a
       * change to anything else for every caller, service role included. A
       * destination is replaced by retiring it and inserting a new row, so a
       * payout can always name the address that was live when it was sent.
       */
      payout_destinations: {
        Row: {
          id: string;
          provider_id: string;
          kind: "bank" | "esewa" | "khalti";
          /** Never rendered whole — `maskAccountRef` decides how much shows. */
          account_ref: string;
          account_name: string;
          bank_name: string | null;
          created_at: string;
          /** The 72-hour takeover window, stamped at insert. */
          usable_from: string;
          /** Null means nobody has confirmed it yet, not that no payout went. */
          first_payout_confirmed_at: string | null;
          first_payout_confirmed_by: string | null;
          retired_at: string | null;
        };
        Insert: {
          id?: string;
          provider_id: string;
          kind: "bank" | "esewa" | "khalti";
          account_ref: string;
          account_name: string;
          bank_name?: string | null;
          created_at?: string;
          usable_from: string;
          first_payout_confirmed_at?: string | null;
          first_payout_confirmed_by?: string | null;
          retired_at?: string | null;
        };
        Update: {
          first_payout_confirmed_at?: string | null;
          first_payout_confirmed_by?: string | null;
          retired_at?: string | null;
        };
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
      provisioned_accounts: {
        Row: {
          phone: string;
          role: string;
          label: string;
          provider_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          note: string | null;
        };
        Insert: {
          phone: string;
          role: string;
          label: string;
          provider_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          note?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["provisioned_accounts"]["Insert"]
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
          /** Probation. See lib/verification/probation.ts. */
          standing: "provisional" | "established";
          approved_at: string | null;
          application_id: string | null;
          /**
           * Removal, and it is not the same state as `is_active = false`.
           * "Taking a break" and "removed for cause" must not be one column,
           * or one gets undone as if it were the other.
           */
          removed_at: string | null;
          /**
           * Closed for dormancy — twelve months with no completed job while
           * carrying a guarantee balance.
           *
           * NOT `removed_at`, which is step 5 of the enforcement ladder and
           * records a finding against somebody. Returning from a dormant
           * close means re-applying, which is allowed.
           */
          closed_at: string | null;
          closed_reason: "dormant" | null;
          removal_reason: string | null;
          /**
           * While this is in the future the listing reads "available now".
           * Set by the professional, expired by the clock — there is no sweep,
           * so there is no job that can stop running. See lib/provider.
           */
          available_until: string | null;
          /** Self-declared, with an end. Never counted against anybody. */
          busy_until: string | null;
          /** System-maintained by a trigger on bookings. Never writable by a professional. */
          on_job_since: string | null;
          /** What they typed, before the band clamped it. Never read per person. */
          base_rate_requested: number | null;
          /**
           * How many people turn up. Null means one, which is every listing
           * until an admin has seen a firm with more than one van. It is not
           * "how many jobs they may juggle" — that is the job's own length,
           * which the booking carries.
           */
          crew_count: number | null;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          available_until?: string | null;
          busy_until?: string | null;
          on_job_since?: string | null;
          base_rate_requested?: number | null;
          crew_count?: number | null;
          display_name: string;
          bio?: string;
          photo_url?: string | null;
          service_areas?: string[];
          years_experience?: number;
          is_verified?: boolean;
          verified_at?: string | null;
          standing?: "provisional" | "established";
          approved_at?: string | null;
          application_id?: string | null;
          removed_at?: string | null;
          closed_at?: string | null;
          closed_reason?: "dormant" | null;
          removal_reason?: string | null;
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
      guarantee_claims: {
        Row: {
          id: string;
          booking_id: string;
          customer_id: string;
          provider_id: string | null;
          category_slug: string;
          status: ClaimStatusName;
          description: string;
          visit_booking_id: string | null;
          attending_provider_id: string | null;
          verdict: ClaimVerdictName | null;
          verdict_note: string | null;
          /**
           * Did the parts themselves fail, rather than the workmanship?
           *
           * Recorded by the attending professional. Null is "not asked or not
           * answered" and is NOT false: only an explicit false lets the parts
           * cost come off the refund ceiling.
           */
          parts_failed: boolean | null;
          payer: "provider" | "customer" | null;
          refund_rupees: number;
          /** A refund requires a person. No verdict fills this in. */
          refund_decided_by: string | null;
          closed_reason: string | null;
          /** Set when the attending professional handed the visit back. */
          released_at: string | null;
          opened_at: string;
          dispatched_at: string | null;
          attended_at: string | null;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          booking_id: string;
          customer_id: string;
          provider_id?: string | null;
          category_slug: string;
          status?: ClaimStatusName;
          description: string;
          visit_booking_id?: string | null;
          attending_provider_id?: string | null;
          verdict?: ClaimVerdictName | null;
          verdict_note?: string | null;
          parts_failed?: boolean | null;
          payer?: "provider" | "customer" | null;
          refund_rupees?: number;
          refund_decided_by?: string | null;
          closed_reason?: string | null;
          released_at?: string | null;
          opened_at?: string;
          dispatched_at?: string | null;
          attended_at?: string | null;
          closed_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["guarantee_claims"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "guarantee_claims_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          id: string;
          provider_id: string;
          /** The ISO week this settles, `[start, end)`. `payoutPeriod` derives it. */
          period_start: string;
          period_end: string;
          status: "draft" | "approved" | "sent" | "confirmed" | "failed";
          /** What this run put into their account. Never negative. */
          earnings_rupees: number;
          commission_rupees: number;
          /** The whole position being paid. The only figure that may be negative. */
          net_rupees: number;
          tax_withheld_rupees: number;
          destination_id: string | null;
          held_reason: "cooling" | "unconfirmed" | "no_destination" | "negative" | null;
          external_reference: string | null;
          failure_reason: string | null;
          /**
           * The professional's `provider_ledger` row count when this was drafted.
           *
           * A count is a sound cursor because that table is append-only — the
           * trigger refuses UPDATE and DELETE for every caller — so a different
           * number means rows arrived and the figures no longer have a ledger
           * behind them.
           */
          ledger_rows_at_draft: number;
          created_at: string;
          approved_at: string | null;
          approved_by: string | null;
          sent_at: string | null;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          provider_id: string;
          period_start: string;
          period_end: string;
          status?: "draft" | "approved" | "sent" | "confirmed" | "failed";
          earnings_rupees?: number;
          commission_rupees?: number;
          net_rupees: number;
          tax_withheld_rupees?: number;
          destination_id?: string | null;
          held_reason?: "cooling" | "unconfirmed" | "no_destination" | "negative" | null;
          external_reference?: string | null;
          failure_reason?: string | null;
          ledger_rows_at_draft?: number;
          created_at?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          sent_at?: string | null;
          settled_at?: string | null;
        };
        Update: Partial<{
          status: "draft" | "approved" | "sent" | "confirmed" | "failed";
          earnings_rupees: number;
          commission_rupees: number;
          net_rupees: number;
          tax_withheld_rupees: number;
          destination_id: string | null;
          held_reason: "cooling" | "unconfirmed" | "no_destination" | "negative" | null;
          external_reference: string | null;
          failure_reason: string | null;
          ledger_rows_at_draft: number;
          approved_at: string | null;
          approved_by: string | null;
          sent_at: string | null;
          settled_at: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "payouts_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_destination_id_fkey";
            columns: ["destination_id"];
            isOneToOne: false;
            referencedRelation: "payout_destinations";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_ledger: {
        Row: {
          id: string;
          provider_id: string;
          claim_id: string | null;
          booking_id: string | null;
          /**
           * Which part of a payout this row is about.
           *
           * A booking pays once unless its guarantee window runs long, in which
           * case a quarter waits 30 days and it pays twice — so a recovery is
           * unique per `(booking_id, tranche)`, not per booking. Every row
           * written before the column is `'main'`, which is a record of what
           * happened rather than an inference: payouts were undivided then.
           */
          tranche: "main" | "holdback";
          kind:
            | "redo_debt"
            | "recovery"
            | "write_off"
            | "earning"
            | "commission_due"
            | "payout"
            | "payout_reversal"
            | "tax_withheld"
            | "trip_compensation";
          /**
           * The remittance this row belongs to.
           *
           * Set on `payout` and `payout_reversal`, which cover a PERIOD rather
           * than a booking and therefore have no `(booking_id, tranche)` key to
           * be unique on. Null on every booking-keyed kind.
           */
          payout_id: string | null;
          amount_rupees: number;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          provider_id: string;
          claim_id?: string | null;
          booking_id?: string | null;
          payout_id?: string | null;
          tranche?: "main" | "holdback";
          kind:
            | "redo_debt"
            | "recovery"
            | "write_off"
            | "earning"
            | "commission_due"
            | "payout"
            | "payout_reversal"
            | "tax_withheld"
            | "trip_compensation";
          amount_rupees: number;
          note?: string | null;
          created_at?: string;
        };
        /** Append-only. The trigger refuses UPDATE for every caller. */
        Update: never;
        Relationships: [
          {
            foreignKeyName: "provider_ledger_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
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
          /**
           * How many replies have actually been TIMED.
           *
           * The denominator `hasResponse` reads, and the reason
           * `avg_response_minutes` alone cannot be trusted: that column defaults
           * to 120, which is exactly the scoring ceiling, so an untimed listing
           * is indistinguishable from one measured at two hours without this.
           */
          response_samples: number;
          jobs_accepted: number;
          withdrawals: number;
          overbook_offers: number;
          overbook_misses: number;
          offers_made: number;
          offers_answered: number;
          declines: number;
          last_withdrawal_at: string | null;
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
          response_samples?: number;
          jobs_accepted?: number;
          withdrawals?: number;
          overbook_offers?: number;
          overbook_misses?: number;
          offers_made?: number;
          offers_answered?: number;
          declines?: number;
          last_withdrawal_at?: string | null;
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
          booking_id: string | null;
          customer_id: string | null;
          submitted_at: string | null;
          published_at: string | null;
          window_closes_at: string | null;
          reply_text: string | null;
          replied_at: string | null;
          excluded_from_average_at: string | null;
          excluded_by: string | null;
          excluded_reason: string | null;
        };
        Insert: {
          id?: string;
          provider_id: string;
          author_name: string;
          rating: number;
          comment: string;
          created_at?: string;
          booking_id?: string | null;
          customer_id?: string | null;
          submitted_at?: string | null;
          published_at?: string | null;
          window_closes_at?: string | null;
          reply_text?: string | null;
          replied_at?: string | null;
          excluded_from_average_at?: string | null;
          excluded_by?: string | null;
          excluded_reason?: string | null;
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
          /**
           * Why the answer came from the path it did.
           *
           * NULL IS "NOT RECORDED", never "no reason": every row written before
           * the column has it, and `fallbackCause` reports those as
           * `notRecorded` rather than inferring the key was missing.
           */
          reason: string | null;
          hazard: string | null;
          /**
           * What each detector independently said, before one of them won.
           *
           * `hazard` above is the OUTCOME — the text guard wins when both
           * fire, so it cannot express agreement. Null in either of these is
           * "not recorded", never "no hazard": a row written before the
           * columns existed has null in both.
           */
          text_hazard: string | null;
          /* A judgement with its reason, never a score. Null is "no photo, or the
             model did not say" — never "the photo was fine". Not backfilled. */
          photo_relevance: "related" | "unrelated" | "unclear" | null;
          photo_relevance_reason: string | null;
          vision_hazard: string | null;
          band: string | null;
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
          reason?: string | null;
          hazard?: string | null;
          text_hazard?: string | null;
          photo_relevance?: "related" | "unrelated" | "unclear" | null;
          photo_relevance_reason?: string | null;
          vision_hazard?: string | null;
          band?: string | null;
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
          band?: string | null;
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
      /**
       * The open jobs this professional's trade and wards cover.
       *
       * The same function the open-jobs policy calls, so the board and the
       * policy cannot drift — see 20260925000001_open_job_ids.sql.
       */
      open_job_ids: {
        Args: Record<string, never>;
        Returns: { id: string }[];
      };
      /** Redo debt still owed, netted and floored at zero. */
      provider_outstanding: {
        Args: { target: string };
        Returns: number;
      };
      /**
       * Signed net money position: positive means we owe them.
       *
       * `recovery` counts on BOTH accounts — see `CROSS_KINDS` — because it is two
       * facts at once: money they were owed, spent on the debt they owed us.
       * Service-role only; `authenticated` was revoked in 20260930000001 after it
       * let any signed-in caller read any professional's position.
       */
      provider_balance: {
        Args: { target: string };
        Returns: number;
      };
      /**
       * Change somebody's role and say which path did it.
       *
       * `profiles_record_role_change` writes the audit row for every path; this
       * is how a path names itself, through two transaction-local settings the
       * trigger reads in the same transaction. `security invoker` and revoked
       * from every browser role — a way to record a role change, never a way to
       * obtain one. See 20260928000001_role_change_audit.sql.
       */
      set_profile_role: {
        Args: {
          target: string;
          new_role: string;
          via: string;
          actor: string | null;
        };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
