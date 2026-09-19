import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Every guard clause, what it protects, and what breaks without it.
 *
 * WHY THIS FILE EXISTS. Three times now a `create or replace` has taken a
 * version nobody intended:
 *
 *   1. `enforce_booking_immutability` lost EVERY settlement check when it was
 *      rebuilt in a migration from a stale copy. No code changed. Nothing
 *      failed. Five of the dropped columns happened to have behavioural tests
 *      and that is the only reason anybody found out.
 *   2. The same function, rebuilt from memory while adding the duration block,
 *      would have dropped the `provider_serves` coverage check and broken every
 *      release path. Caught by reading the live definition before applying.
 *   3. `enforce_slot_capacity`, rewritten for durations, DID drop the advisory
 *      lock. The race test went red.
 *
 * All three were luck: a test happened to cover the clause that went. Luck is
 * not a guard, and the classes of clause it does not cover are exactly the ones
 * nobody thinks to test — a lock, an early return, an ordering.
 *
 * SUBSTRINGS, NOT A SNAPSHOT OF THE BODY. A snapshot fails on every comment
 * edit, gets re-blessed reflexively, and within a month nobody reads the diff.
 * A named fragment fails only when the guard actually goes, and the failure
 * carries `protects` and `ifMissing` so whoever hits it learns why rather than
 * deleting a line to get green.
 *
 * WHAT IT CATCHES AND WHAT IT DOES NOT. The harness replays every migration
 * from scratch, so this catches a MIGRATION FILE that drops a clause — which is
 * what happened all three times. It does NOT catch production drifting from the
 * migrations: this suite holds no production credentials and should not. That
 * is what the read-back after `apply_migration` is for, and it stays a
 * per-migration step.
 */

type Guard = {
  /** One sentence a non-author can read. */
  protects: string;
  /** What breaks without it. The real incident, where there was one. */
  ifMissing: string;
  /** Fragments that must all appear in the live definition. */
  clauses: string[];
};

const GUARDS: Record<string, Guard[]> = {
  enforce_slot_capacity: [
    {
      protects: "One professional cannot be in two houses at once.",
      ifMissing:
        "Two transactions claiming two jobs for the same person at the same moment each see zero taken under read committed, both pass, and both commit. THIS ONE WAS ACTUALLY DROPPED rewriting the function for durations.",
      clauses: ["pg_advisory_xact_lock", "hashtextextended"],
    },
    {
      protects: "Each job is measured by its own length, on both sides.",
      ifMissing:
        "Back to a fixed window: a four-hour job from ten and a short job at one stop colliding, and the second customer finds out on the day.",
      clauses: [
        "public.booking_working_minutes(\n    new.estimated_working_minutes",
        "b.estimated_working_minutes",
      ],
    },
    {
      protects: "The cap, including probation and the overbooking seat.",
      ifMissing: "Any number of jobs in one window.",
      clauses: ["public.booking_slot_capacity", "taken >= allowed"],
    },
    {
      protects:
        "A job already legally held is not re-judged on its way to completed.",
      ifMissing:
        "Settling a payment on a row somebody was allowed to overbook raises.",
      clauses: ["tg_op = 'UPDATE'", "is not distinct from old.provider_id"],
    },
  ],

  enforce_booking_immutability: [
    {
      protects: "The server's own writes pass through; a browser's do not.",
      ifMissing:
        "Either every service-role write is refused, or nothing is guarded at all.",
      clauses: ["caller uuid := auth.uid()", "if caller is null then"],
    },
    {
      protects: "Prices and payment state are not typed from a browser.",
      ifMissing:
        "A customer pays Rs 100 for a Rs 4,000 job with every server-side check agreeing. ALL OF THESE WERE DROPPED ONCE by a rebuild from a stale copy.",
      clauses: [
        "new.quoted_min is distinct from old.quoted_min",
        "new.final_amount is distinct from old.final_amount",
        "new.commission_basis is distinct from old.commission_basis",
        "new.payout_due_at is distinct from old.payout_due_at",
        "new.payment_status is distinct from old.payment_status",
      ],
    },
    {
      protects: "A professional is only assigned to work they actually cover.",
      ifMissing:
        "A job in a ward they do not serve, or a trade they do not work. NEARLY DROPPED rebuilding this function from memory.",
      clauses: ["public.provider_serves"],
    },
    {
      protects: "A refused job is not offered straight back to the refuser.",
      ifMissing:
        "The customer's replacement list contains the person who just said no.",
      clauses: ["public.booking_refusals"],
    },
    {
      protects: "How long a job takes is not a browser's to set.",
      ifMissing:
        "A customer shortens their own job and takes somebody else's slot, or lengthens it and holds a professional's week.",
      clauses: [
        "new.band_slug is distinct from old.band_slug",
        "new.provider_estimated_working_minutes is distinct from old.provider_estimated_working_minutes",
      ],
    },
    {
      protects: "A corrected price is agreed through the app, not written.",
      ifMissing:
        "A professional stamps the customer's own approval on a price the customer never saw.",
      clauses: [
        "new.provider_band_slug is distinct from old.provider_band_slug",
        "new.band_change_approved_at is distinct from old.band_change_approved_at",
      ],
    },
    {
      protects: "Whether anybody pays for a return visit is not a browser's.",
      ifMissing:
        "A customer flips `billable` and has a free job for the asking; a professional flips it the other way and bills for a redo of their own defect.",
      clauses: [
        "new.billable is distinct from old.billable",
        "new.guarantee_claim_id is distinct from old.guarantee_claim_id",
      ],
    },
  ],

  /*
   * MOSTLY a status machine — checked by the claim-status tests and by
   * `check:transitions`, which parses the TS/SQL pair — and it was listed as
   * UNGUARDED for that reason. It is not only that. The two clauses below are
   * data-integrity rules about the return visit, of exactly the kind this
   * manifest exists for, and neither is expressible as a transition.
   */
  enforce_guarantee_visit: [
    {
      protects:
        "A free redo is never charged for at the door, and never charged for afterwards.",
      ifMissing:
        "Either a professional bills a customer who is already in their own house with no real choice, or the charge arrives at settlement for work nobody agreed to pay for. Both are the failure this whole design exists to prevent.",
      clauses: [
        "old.started_at is not null",
        "new.band_change_approved_at is null",
      ],
    },
    {
      protects: "A chargeable visit is never laundered back into a free one.",
      ifMissing:
        "A bill the customer accepted is erased, which is also the obvious way to make an ordinary job look covered.",
      clauses: ["old.billable and not new.billable"],
    },
    {
      protects: "Ordinary bookings are untouched by any of it.",
      ifMissing:
        "A guard that reached past guarantee visits would refuse every settlement in the product.",
      clauses: ["new.guarantee_claim_id is null"],
    },
  ],

  enforce_claim_transition: [
    {
      protects: "A claim is not repointed at a second return visit.",
      ifMissing:
        "The old visit is orphaned — still accepted, still holding one of the professional's capacity seats, on a claim that no longer references it. THE UNIQUE COLUMN DOES NOT STOP THIS: it only stops two claims sharing one visit, which is a different mistake. Found by a test written against my own wrong assertion that it did.",
      clauses: [
        "new.visit_booking_id <> old.visit_booking_id",
        "already has a return visit",
      ],
    },
    {
      protects:
        "A released claim drops its visit, which is why the guard above cannot be 'never changes once set'.",
      ifMissing:
        "Either a released claim keeps pointing at a visit its professional is not doing, or the repoint guard is written as an absolute and refuses every legitimate hand-back.",
      clauses: ["new.visit_booking_id := null"],
    },
  ],

  enforce_booking_address_ownership: [
    {
      protects: "Nobody books a job at an address they do not own.",
      ifMissing:
        "A stranger sends a professional to any address in the database.",
      clauses: ["owner <> new.customer_id", "somebody else"],
    },
    {
      protects:
        "NO SERVICE-ROLE BYPASS. This rule has no legitimate exception, so unlike every other guard here it does not read auth.uid() at all.",
      ifMissing:
        "A bypass added 'for the server' becomes the hole, because no path needs one.",
      clauses: [],
      // Asserted as an absence below rather than a presence.
    },
  ],

  enforce_booking_transition: [
    {
      protects: "Only the moves the status machine allows.",
      ifMissing: "A cancelled booking walks back to in_progress.",
      clauses: ["public.booking_transition_allowed"],
    },
    {
      protects:
        "Going back to the pool clears the stamps of the assignment that lapsed.",
      ifMissing:
        "An accepted_at on a booking nobody has accepted — a lie a report repeats.",
      clauses: [
        "new.accepted_at := null",
        "new.en_route_at := null",
        "new.provider_id := null",
      ],
    },
  ],

  enforce_survey_quote: [
    {
      protects: "A booking cannot change how it is priced.",
      ifMissing:
        "A survey job flips to a band and the 2x overcharge ceiling is measured off a figure nobody agreed to. This check was UNREACHABLE once, sitting below the band early return.",
      clauses: ["new.quote_model is distinct from old.quote_model"],
    },
    {
      protects: "Work cannot start on a surveyed job nobody approved.",
      ifMissing:
        "The ceiling is measured off a price the customer never saw.",
      clauses: [
        "new.status = 'in_progress'",
        "The customer has not agreed to this price",
      ],
    },
  ],

  freeze_booking_band: [
    {
      protects:
        "A survey booking gets no floor of ours invented at insert.",
      ifMissing:
        "movers-packers' stale 5,000 category row lands on the booking as band_min — the exact invented figure the survey-pricing phase existed to keep off one. THIS WAS LOST AND SHIPPED: the function was rebuilt from 20260913000003 when the live definition came from 20260916000001, because there are three definitions in the tree and filename order decides. Nothing pinned it, which is why it is pinned now.",
      clauses: [
        "if new.quote_model = 'survey'",
        "new.band_min := null",
      ],
    },
    {
      protects:
        "A surveyed floor writes through the UPDATE pin when the survey lands.",
      ifMissing:
        "The frozen null outlives the survey that replaced it, so a surveyed job never gets our floor at all and category_pricing_signals cannot ask whether the quote was right.",
      clauses: [
        "old.band_min is null",
        "new.band_min := new.quoted_min",
      ],
    },
  ],

  enforce_price_correction: [
    {
      protects:
        "The customer's own statement is never overwritten by the professional's correction.",
      ifMissing:
        "A correction edits band_slug and the only evidence of the disagreement is gone. That evidence is how we later learn, per product, how far our published ranges sit from the work — the same reason provider_estimated_working_minutes sits beside estimated_working_minutes.",
      clauses: [
        "new.band_slug is distinct from old.band_slug",
        "does not rewrite what the customer said",
      ],
    },
    {
      protects: "A corrected product carries a reason.",
      ifMissing:
        "A price moves with no sentence attached and a dispute has one side on the record. Same rule final_amount_reason keeps.",
      clauses: ["A corrected product needs a reason"],
    },
    {
      protects:
        "A correction cannot price the job below what the customer said it was.",
      ifMissing:
        "The anti-under-reporting design reopens through a different door: the fee is charged on max(final_amount, quoted_min), so a professional who cannot report a smaller NUMBER names a cheaper PRODUCT instead.",
      clauses: [
        "corrected_high < stated_low",
        "below what the customer said it was",
      ],
    },
    {
      protects: "An agreed price is frozen.",
      ifMissing:
        "The 2x ceiling moves out from under an approval the customer gave for a different product.",
      clauses: [
        "old.band_change_approved_at is not null",
        "An agreed price cannot be rewritten",
      ],
    },
    {
      protects: "Work cannot start on a correction nobody answered.",
      ifMissing:
        "The re-narrowed price arrives at SETTLEMENT instead — a professional standing in somebody's kitchen naming a new number, which is the exact position lib/payments/pricing.ts exists to keep people out of.",
      clauses: [
        "new.status = 'in_progress'",
        "The customer has not answered the corrected price",
      ],
    },
  ],

  sync_booking_days: [
    {
      protects:
        "A guessed span never takes days out of a professional's week or a customer's home.",
      ifMissing:
        "Four days of real bookable capacity held on an invented number, invisibly, indistinguishable from a measurement.",
      clauses: ["duration_source <> 'invented'"],
    },
    {
      protects: "The professional's own span is evidence and passes the gate.",
      ifMissing:
        "A painter who says 'this is four days' still gets booked for something else on Wednesday.",
      clauses: ["new.provider_estimated_elapsed_days is not null"],
    },
  ],

  record_booking_duration: [
    {
      protects:
        "A completion too fast to be work is refused as evidence, and the refusal is recorded.",
      ifMissing:
        "Every completed booking in production ran three to twenty-nine SECONDS. Recording those writes measured-looking zeros into the column the researched durations are meant to grow from.",
      clauses: [
        "floor_minutes constant integer := 10",
        "new.duration_implausible_at := now()",
      ],
    },
  ],

  sync_booking_duration: [
    {
      protects: "No product means no estimate.",
      ifMissing:
        "A booking carries a length derived from a product it is not for.",
      clauses: ["new.estimated_working_minutes := null"],
    },
    {
      protects: "Frozen at booking time.",
      ifMissing:
        "Re-timing a sub-band silently restates how long a job somebody already booked was supposed to take — the figure an overrun is judged against.",
      clauses: ["new.band_slug is not distinct from old.band_slug"],
    },
  ],

  enforce_site_capacity: [
    {
      protects:
        "One trade at a time in one home, and a DIFFERENT trade is deliberately allowed.",
      ifMissing:
        "Dropping the address match blocks unrelated homes; dropping the trade match blocks an electrician behind a painter.",
      clauses: ["other.address_id = (", "other.category_slug = ("],
    },
  ],

  record_provider_release: [
    {
      protects:
        "Withdrawing and declining are different facts and are counted separately.",
      ifMissing:
        "Ranking cannot tell somebody who took a job and dropped it from somebody who never took it. REBUILT FROM MEMORY once and both counters were lost; caught before it landed.",
      clauses: ["'withdrawn'", "'declined'", "withdrawals", "declines"],
    },
    {
      protects:
        "A customer widening, and an honest overrun on an offered job, are not refusals.",
      ifMissing:
        "A professional who was merely slow is recorded as having said no, and is kept off the customer's replacement list.",
      clauses: [
        "new.widened_by_customer_at is distinct from old.widened_by_customer_at",
        "new.overbook_missed_at is distinct from old.overbook_missed_at",
      ],
    },
  ],

  sync_booking_quote_floor: [
    {
      protects: "A settled quote is history and history is not rewritten.",
      ifMissing: "A hand-off restates a figure money has already moved against.",
      clauses: ["old.final_amount is not null", "old.completed_at is not null"],
    },
    {
      protects: "The floor is clamped into the category band.",
      ifMissing:
        "A multi-trade professional's rate writes quoted_min above quoted_max and the table's own check refuses the write.",
      clauses: ["least(greatest(band_low"],
    },
  ],

  security_events_are_append_only: [
    {
      protects: "The audit log cannot be edited by anybody, service role included.",
      ifMissing: "A log the application can edit proves nothing.",
      clauses: ["append-only", "insufficient_privilege"],
    },
  ],

  enforce_survey_visit_fee: [
    {
      protects: "No trip, no fee.",
      ifMissing:
        "The surveyor fee becomes farmable without anybody leaving the house.",
      clauses: ["No arrival was recorded", "public.booking_arrivals"],
    },
    {
      protects: "The monthly cap counts APPROVED rows only.",
      ifMissing:
        "A queue of honest declines blocks a real claim, punishing the surveyor for the length of our queue.",
      clauses: ["f.status = 'approved'", "approved >= cap"],
    },
    {
      protects: "A fee decision needs a person.",
      ifMissing:
        "The automatic payout this whole table exists to prevent, wearing a status.",
      clauses: ["new.decided_by is null"],
    },
  ],
};

/**
 * Raising `security definer` functions with nothing to assert, and why.
 *
 * The inverse test below requires every one of them to be here or in GUARDS,
 * so a guard added without an entry fails rather than going unnoticed.
 */
const UNGUARDED: Record<string, string> = {
  refuse_rewrite:
    "A one-line 'this table is append-only' used by three tables. Its whole body is the guard, and `security_events_are_append_only` already pins that shape.",
  enforce_application_immutability:
    "Covered behaviourally end to end in provider-applications.test.ts, which asserts each refused field by attempting it.",
  enforce_claim_eligibility:
    "Covered behaviourally in guarantee-claims.test.ts: two per booking, one open at a time, finished and settled only.",
  enforce_payment_transition:
    "Same: a status machine, parsed by check:transitions against lib/payments.",
  enforce_confirmation_integrity:
    "Covered behaviourally in trip-protection tests.",
  enforce_visit_review_stamp:
    "One stamp, covered behaviourally by the visit-review tests.",
  freeze_quote_after_work:
    "Covered by quote-floor.test.ts, which attempts the rewrite after work starts.",
};

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

async function source(name: string): Promise<string> {
  const { rows } = await pg.admin.query(
    `select prosrc from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  expect(rows, `public.${name} does not exist`).toHaveLength(1);
  return rows[0].prosrc as string;
}

describe("every guard clause is still in the function that needs it", () => {
  for (const [name, guards] of Object.entries(GUARDS)) {
    for (const guard of guards) {
      if (guard.clauses.length === 0) continue;
      it(`${name}: ${guard.protects}`, async () => {
        const src = await source(name);
        for (const clause of guard.clauses) {
          expect(
            src.includes(clause),
            `public.${name} no longer contains:\n\n    ${clause}\n\n` +
              `PROTECTS: ${guard.protects}\n` +
              `WITHOUT IT: ${guard.ifMissing}\n\n` +
              `If the guard genuinely moved, update the clause here in the same ` +
              `commit. If it was lost to a rewrite, put it back — that has ` +
              `happened three times.`,
          ).toBe(true);
        }
      });
    }
  }

  /*
   * ASSERTED AS AN ABSENCE, which is the only guard here shaped that way.
   * Booking at an address you do not own has NO legitimate exception, so this
   * function deliberately never reads `auth.uid()`. A bypass added "for the
   * server" would be the hole, because no path needs one.
   */
  it("enforce_booking_address_ownership has no service-role bypass", async () => {
    const src = await source("enforce_booking_address_ownership");
    expect(
      src.includes("auth.uid()"),
      "enforce_booking_address_ownership now reads auth.uid(). That is a " +
        "service-role bypass on a rule with no legitimate exception: no path " +
        "books a job at an address its customer does not own.",
    ).toBe(false);
  });
});

describe("the manifest cannot go stale", () => {
  /*
   * THE INVERSE, and it is what stops this file describing a past version of
   * the schema. Every raising `security definer` function in `public` must be
   * named in GUARDS or admitted in UNGUARDED with a reason. A guard added
   * without an entry fails here — the same shape as the column-list assertion
   * in booking-rls.test.ts, which stays: that one covers which COLUMNS are
   * guarded, this one covers which CLAUSES survive a rewrite.
   */
  it("names every raising security-definer function in public", async () => {
    const { rows } = await pg.admin.query(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and p.prosrc like '%raise exception%'
        order by p.proname`,
    );

    const live = rows.map((r) => r.proname as string);
    const named = new Set([...Object.keys(GUARDS), ...Object.keys(UNGUARDED)]);
    const unnamed = live.filter((name) => !named.has(name));

    expect(
      unnamed,
      `these raise an exception but appear in neither GUARDS nor UNGUARDED: ` +
        `${unnamed.join(", ")}. Add the clauses that must survive a rewrite, ` +
        `or say in UNGUARDED why nothing here needs pinning.`,
    ).toEqual([]);
  });

  it("lists nothing that has since been deleted", async () => {
    const { rows } = await pg.admin.query(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );
    const live = new Set(rows.map((r) => r.proname as string));

    for (const name of [...Object.keys(GUARDS), ...Object.keys(UNGUARDED)]) {
      expect(live.has(name), `public.${name} no longer exists`).toBe(true);
    }
  });

  /*
   * A guard that is not attached to its table guards nothing, and a rebuild
   * drops a trigger as easily as it drops a line.
   */
  it("keeps every guarded trigger function attached to a trigger", async () => {
    const { rows } = await pg.admin.query(
      `select p.proname, count(t.oid) as triggers
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         left join pg_trigger t on t.tgfoid = p.oid and not t.tgisinternal
        where n.nspname = 'public' and p.proname = any($1)
        group by p.proname`,
      [Object.keys(GUARDS)],
    );

    for (const row of rows) {
      // booking_working_minutes-style helpers are not in GUARDS; everything
      // that is, is a trigger function.
      expect(
        Number(row.triggers),
        `public.${row.proname} is not attached to any trigger`,
      ).toBeGreaterThan(0);
    }
  });
});
