/**
 * The tables a browser may write, and what keeps each one safe.
 *
 * ONE LIST, READ BY TWO TESTS. `tests/db/write-grants.test.ts` asserts that
 * nothing outside it has a write policy and that every guard named here still
 * exists; `tests/db/rls-matrix.test.ts` asserts the same set from the other
 * direction while it builds the published matrix. They were two hand-maintained
 * copies for one commit, which is the shape this repository has paid for
 * repeatedly — `CRON_JOBS` written three times, `LOGGABLE_REASONS` written
 * twice — so it is one list before it has a chance to drift.
 *
 * It is not a test file: importing one `.test.ts` from another makes the suite
 * decide which ran first.
 *
 * EVERY ENTRY NAMES MORE THAN ONE GUARD NOW, AND THAT CHANGE IS THE POINT.
 * `guard` was singular, which quietly asked each table to nominate its single
 * best defence — and the answer for `bookings` was a trigger, which is the one
 * kind of guard that can be rebuilt wrongly. Production spent weeks running a
 * copy of `enforce_booking_immutability` missing three blocks, applied to the
 * live database only, where nothing in this repository could see it; with
 * `authenticated` holding UPDATE on every column through Supabase's default
 * privilege, that trigger was the whole barrier. A column grant is refused by
 * the planner before a row is considered and has no stale copy anywhere, so it
 * goes FIRST and the trigger stays behind it. `guards` is a list because
 * defence in depth is a list.
 */

/** How a table that a browser may write is kept safe. */
export type Guard =
  /** A BEFORE trigger refuses the write. Carries the sentence a person reads. */
  | { kind: "trigger"; name: string }
  /**
   * `authenticated` holds the named columns and nothing else, per verb. A verb
   * the table has a policy for must be declared here, or the test fails: an
   * undeclared verb is the hole this shape exists to close.
   */
  | { kind: "column-grant"; insert?: string[]; update?: string[] }
  /** The policy is there and inert — no column privilege backs it. */
  | { kind: "no-grant" }
  /** The policy validates the row going in and the row coming out. */
  | { kind: "policy-both-sides" }
  | { kind: "open-by-design"; because: string };

/*
 * `notifications` WAS HERE AND IS NOT ANY MORE. Its policy granted UPDATE on all
 * seven columns of a person's own rows and nothing in the product used it —
 * `markBookingRead` writes `read_at` under the service role, and
 * `lib/notify/in-app.ts` inserts the same way. `20260928000001` drops it, so a
 * browser has no write on that table at all and the "no entry for a table that
 * cannot be written any more" case in `write-grants.test.ts` is what caught the
 * entry left behind here.
 */
export const ALLOWED: Record<string, { verbs: string[]; guards: Guard[]; note: string }> = {
  /*
   * THE NOTE HERE USED TO READ "no column here confers anything" AND IT HAD
   * STOPPED BEING TRUE. That was written when the table held a label and an
   * area; four columns have been added since and all four are the server's —
   * `lat`/`lng` (the ward centroid, a ranking input, so a customer who could
   * move their own pin could move themselves up every distance sort),
   * `upheld_no_shows` (their own no-show history: writable means erasable) and
   * `first_confirmed_at` (what the trip-confirmation risk rule reads). The
   * policy checks `profile_id = auth.uid()` on both sides, which is faultless
   * and has nothing to say about WHICH column is being written. That is the
   * `profiles` hole one table over, and `20261011000004` closes it.
   */
  addresses: {
    verbs: ["INSERT", "UPDATE"],
    guards: [
      {
        kind: "column-grant",
        insert: [
          "area_key",
          "city",
          "directions_note",
          "label",
          "landmark",
          "profile_id",
          "tole",
          "ward_number",
        ],
        update: ["is_default"],
      },
      { kind: "policy-both-sides" },
    ],
    note: "the form's own fields; the centroid and the risk history are the server's",
  },

  /*
   * The table with the most privileged columns in the product, and the reason
   * `enforce_booking_immutability` exists: "Customers cancel their own open
   * bookings" validated `customer_id` and `status`, which left `quoted_max`,
   * `final_amount` and `provider_id` writable from a browser. On INSERT the
   * status is pinned to `pending` by `enforce_booking_transition` and the band
   * floor is written server-side by `freeze_booking_band`.
   *
   * AND THE TRIGGER IS BEFORE UPDATE ONLY, so until `20261011000004` nothing
   * had ever guarded an INSERT column: a hand-crafted POST could have inserted
   * a booking already `payment_status = 'paid'` carrying a `platform_fee`,
   * which `/admin/revenue` sums.
   */
  bookings: {
    verbs: ["INSERT", "UPDATE"],
    guards: [
      {
        kind: "column-grant",
        insert: [
          "address_id",
          "band_asked_at",
          "band_slug",
          "band_source",
          "category_slug",
          "customer_id",
          "description",
          "first_choice_provider_id",
          "locale",
          "payment_method",
          "photo_url",
          "provider_id",
          "quote_model",
          "quoted_max",
          "quoted_min",
          "reference",
          "scheduled_for",
          "terms_version",
          "triage_log_id",
          "urgency",
        ],
        // `cancellation_fee` is deliberately absent — see the migration.
        update: [
          "cancellation_reason",
          "cancelled_by",
          "cancelled_by_role",
          "provider_id",
          "status",
        ],
      },
      { kind: "trigger", name: "bookings_enforce_immutability" },
    ],
    note: "money, assignment and every stamp are the server's, not the browser's",
  },

  /*
   * The hole this file exists because of. Three columns, and they are the three
   * a browser legitimately writes: two in onboarding, one on /account.
   */
  profiles: {
    verbs: ["UPDATE"],
    guards: [
      {
        kind: "column-grant",
        update: ["full_name", "hide_from_activity", "preferred_language"],
      },
    ],
    note: "role, id, phone and created_at are unwritable from any session",
  },

  /*
   * A DOOR NOBODY USED. `using` pins the old row to a draft and `with check`
   * only validates `profile_id`, so the policy alone would have let an applicant
   * approve their own application — which is why
   * `enforce_application_immutability` was written. But every write against this
   * table goes through `createAdminClient()` (`lib/data/applications.ts`,
   * `verification.ts`, `review.ts`): there is not one `createClient()` call
   * against it in the product. So `20261011000004` grants the browser nothing
   * and the policies are inert, the planner refusing before they are consulted —
   * the same finding as `notifications`, one table over. The trigger stays as
   * what would refuse `status` and `risk_score` if a grant were ever handed
   * back.
   */
  provider_applications: {
    verbs: ["INSERT", "UPDATE"],
    guards: [
      { kind: "no-grant" },
      { kind: "trigger", name: "enforce_application_immutability" },
    ],
    note: "no browser writes this; status and risk_score are the server's",
  },

  /*
   * The join form, open to `anon` on purpose: somebody who is not signed in has
   * to be able to tell us they want to work.
   *
   * "AND NO COLUMN ON IT GRANTS ANYTHING" IS WHAT THIS NOTE USED TO SAY, which
   * was the `addresses` mistake again. `status` was grantable, and
   * `startApplication` moves a lead on with `.eq("status", "new")` — so a lead
   * posted already marked `contacted` is a real applicant who silently never
   * enters the queue a person works through. `id` and `created_at` went with it:
   * a caller-chosen `created_at` sorts wherever it likes in that queue.
   *
   * The UPDATE privilege went too. It was inert — there is no UPDATE policy,
   * and there must never be one, because an open form's update policy would let
   * any stranger rewrite any other stranger's lead — but
   * `lib/data/provider-leads.ts` carries a comment saying this table grants
   * "INSERT and nothing else", and that comment is the recorded reason the
   * duplicate is handled in TypeScript rather than by an upsert. It is true now.
   */
  provider_leads: {
    verbs: ["INSERT"],
    guards: [
      {
        kind: "column-grant",
        insert: [
          "area_key",
          "category_slug",
          "full_name",
          "locale",
          "note",
          "phone",
          "years_experience",
        ],
      },
      { kind: "open-by-design", because: "anybody may ask to join" },
    ],
    note: "the form's own seven fields; status and the stamps are the server's",
  },
};
