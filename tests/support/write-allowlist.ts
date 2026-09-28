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
 */

/** How a table that a browser may write is kept safe. */
export type Guard =
  | { kind: "trigger"; name: string }
  | { kind: "column-grant"; columns: string[] }
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
export const ALLOWED: Record<string, { verbs: string[]; guard: Guard; note: string }> = {
  /*
   * The policy checks `profile_id = auth.uid()` on the row going in AND the row
   * coming out, so an address cannot be moved to somebody else or taken from
   * them. Nothing on the table confers power beyond its owner's own data, and
   * `enforce_booking_address_ownership` re-asks the question at booking time.
   */
  addresses: {
    verbs: ["INSERT", "UPDATE"],
    guard: { kind: "policy-both-sides" },
    note: "own rows; no column here confers anything",
  },

  /*
   * The table with the most privileged columns in the product, and the reason
   * `enforce_booking_immutability` exists: "Customers cancel their own open
   * bookings" validated `customer_id` and `status`, which left `quoted_max`,
   * `final_amount` and `provider_id` writable from a browser. On INSERT the
   * status is pinned to `pending` by `enforce_booking_transition` and the band
   * floor is written server-side by `freeze_booking_band`.
   */
  bookings: {
    verbs: ["INSERT", "UPDATE"],
    guard: { kind: "trigger", name: "bookings_enforce_immutability" },
    note: "money and assignment columns are the trigger's, not the browser's",
  },

  /*
   * The hole this file exists because of. Three columns, and they are the three
   * a browser legitimately writes: two in onboarding, one on /account.
   */
  profiles: {
    verbs: ["UPDATE"],
    guard: {
      kind: "column-grant",
      columns: ["full_name", "hide_from_activity", "preferred_language"],
    },
    note: "role, id, phone and created_at are unwritable from any session",
  },

  /*
   * `using` pins the old row to a draft, but `with check` only validates
   * `profile_id` — so the policy alone would let an applicant approve their own
   * application. The trigger is what refuses `status`, `risk_score`,
   * `submitted_at` and a change of hands.
   */
  provider_applications: {
    verbs: ["INSERT", "UPDATE"],
    guard: { kind: "trigger", name: "enforce_application_immutability" },
    note: "status and risk_score are the server's",
  },

  /*
   * The join form, open to `anon` on purpose: somebody who is not signed in has
   * to be able to tell us they want to work. Insert only, and no column on it
   * grants anything — a lead is read by a person.
   */
  provider_leads: {
    verbs: ["INSERT"],
    guard: { kind: "open-by-design", because: "anybody may ask to join" },
    note: "insert only; a lead confers nothing until a person acts on it",
  },
};
