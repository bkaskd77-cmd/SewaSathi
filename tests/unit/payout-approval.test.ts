import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three gates between a drafted figure and money leaving.
 *
 * WHY A UNIT TEST WITH A FAKE CLIENT. `tests/db/payout-run.test.ts` runs real
 * Postgres and proves the schema, the indexes and the identity the ledger has to
 * keep — and none of it can reach this module, because `createAdminClient()` is a
 * supabase-js client the db harness does not have. What lives here is everything
 * that decides whether a write happens at all:
 *
 *   NOTHING IS WRITTEN WHEN THE WRITE WOULD BE WRONG. Asserted by counting what the
 *   client was asked to do rather than by catching a rejection — a throw after a
 *   partial write catches identically and leaves a payout half-approved.
 *
 *   A STALE DRAFT IS RECOMPUTED, NOT APPROVED. The failure this prevents is the
 *   expensive one: a refund agreed between the draft and the approval, and a figure
 *   paid that the ledger no longer supports.
 *
 *   EVERY MONEY ACTION LEAVES A RECORD BEFORE IT ACTS. Remove the audit call and
 *   these go red.
 */

type Op = {
  table: string;
  op: "select" | "count" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

let ops: Op[] = [];
let answers: Record<
  string,
  Array<{ data: unknown; error: unknown; count?: number | null }>
> = {};
let rpcAnswers: number[] = [];
let audit: { kind: string; detail?: Record<string, unknown> }[] = [];

class Fake {
  private readonly entry: Op;

  constructor(table: string) {
    this.entry = { table, op: "select", filters: [] };
    ops.push(this.entry);
  }

  private note(column: string, value: unknown) {
    this.entry.filters.push([column, value]);
    return this;
  }

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.entry.op = "count";
    return this;
  }
  order() { return this; }
  limit() { return this; }
  eq(c: string, v: unknown) { return this.note(c, v); }
  is(c: string, v: unknown) { return this.note(c, v); }
  gt(c: string, v: unknown) { return this.note(c, v); }
  in(c: string, v: unknown) { return this.note(c, v); }
  not(c: string, _op: string, v: unknown) { return this.note(c, v); }

  insert(payload: Record<string, unknown>) {
    this.entry.op = "insert";
    this.entry.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.entry.op = "update";
    this.entry.payload = payload;
    return this;
  }

  private answer() {
    const queue = answers[this.entry.table] ?? [];
    return queue.shift() ?? { data: null, error: null, count: null };
  }

  maybeSingle() { return Promise.resolve(this.answer()); }
  single() { return Promise.resolve(this.answer()); }

  then<T>(
    resolve: (value: { data: unknown; error: unknown; count?: number | null }) => T,
  ) {
    return Promise.resolve(this.answer()).then(resolve);
  }
}

const client = {
  from: (table: string) => new Fake(table),
  rpc: (_name: string, _args: unknown) =>
    Promise.resolve({ data: rpcAnswers.shift() ?? 0, error: null }),
};

vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

vi.mock("@/lib/audit", () => ({
  recordSecurityEvent: async (event: {
    kind: string;
    detail?: Record<string, unknown>;
  }) => {
    audit.push(event);
  },
  recordDestinationAccess: async () => {},
}));

const PAYOUT = "11111111-a111-4111-8111-111111111111";
const LISTING = "22222222-b222-4222-8222-222222222222";
const DESTINATION = "33333333-c333-4333-8333-333333333333";
const ADMIN = "44444444-d444-4444-8444-444444444444";

function of(table: string): Op[] {
  return ops.filter((entry) => entry.table === table);
}

function writes(table: string): Op[] {
  return of(table).filter((entry) => entry.op === "insert" || entry.op === "update");
}

/** A draft as the database hands it back. */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYOUT,
    provider_id: LISTING,
    status: "draft",
    net_rupees: 4000,
    held_reason: null,
    ledger_rows_at_draft: 3,
    destination_id: DESTINATION,
    ...overrides,
  };
}

/** The live destination, ready, matching the draft. */
function destination(overrides: Record<string, unknown> = {}) {
  return {
    id: DESTINATION,
    provider_id: LISTING,
    account_ref: sealedRef,
    account_name: "Krishna Tamang",
    bank_name: "Nabil Bank",
    created_at: "2026-09-01T00:00:00.000Z",
    usable_from: "2026-09-04T00:00:00.000Z",
    first_payout_confirmed_at: "2026-09-10T00:00:00.000Z",
    retired_at: null,
    ...overrides,
  };
}

let sealedRef = "";

/** Everything the happy path needs queued, in the order the code asks for it. */
function queueApproval(options: { ledgerRows?: number } = {}) {
  answers.payouts = [{ data: draft(), error: null }];
  answers.payout_destinations = [{ data: destination(), error: null }];
  answers.provider_ledger = [
    { data: null, error: null, count: options.ledgerRows ?? 3 },
  ];
}

const fresh = () => new Date();
const stale = () => new Date(Date.now() - 60 * 60 * 1000);

beforeEach(async () => {
  ops = [];
  answers = {};
  rpcAnswers = [];
  audit = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

  const { sealSecret } = await import("@/lib/security/secret-box");
  sealedRef = sealSecret("9779841234567");
});

describe("a session that has not recently proved who it is", () => {
  it("refuses an approval and writes nothing", async () => {
    const { approvePayout } = await import("@/lib/data/payouts");
    queueApproval();

    const result = await approvePayout({
      payoutId: PAYOUT,
      adminId: ADMIN,
      reauthenticatedAt: stale(),
      reason: "Checked against the week",
    });

    expect(result).toEqual({ ok: false, reason: "notFresh" });
    expect(writes("payouts"), "nothing may be written").toEqual([]);
    expect(audit).toEqual([]);
  });

  it("refuses a refreshed-but-old session, which is the whole point of reading amr", async () => {
    /*
     * THE BUG THIS PINS. The gate used to read the token's `iat`, which Supabase
     * resets on every silent refresh — so a session that had been open for days but
     * was active a minute ago passed it. `amr` carries the moment somebody actually
     * proved who they were, so a refreshed-but-old session reads as old. Here that
     * is the only difference between the two stamps: `authenticatedAt` is what the
     * action passes in, and this asserts the refusal the fix produces.
     */
    const { authenticatedAt } = await import("@/lib/auth/step-up");
    const hoursAgo = (n: number) => Math.floor(Date.now() / 1000) - n * 3600;

    const refreshedJustNow = {
      iat: Math.floor(Date.now() / 1000),
      amr: [{ method: "otp", timestamp: hoursAgo(9) }],
    };

    const provedAt = authenticatedAt(refreshedJustNow);
    expect(provedAt, "amr, not iat").not.toBeNull();

    const { approvePayout } = await import("@/lib/data/payouts");
    queueApproval();

    const result = await approvePayout({
      payoutId: PAYOUT,
      adminId: ADMIN,
      reauthenticatedAt: provedAt,
      reason: "Checked against the week",
    });

    expect(result).toEqual({ ok: false, reason: "notFresh" });
  });

  it("refuses the send and the failure for the same reason", async () => {
    const { markPayoutSent, markPayoutFailed } = await import("@/lib/data/payouts");

    queueApproval();
    expect(
      await markPayoutSent({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: stale(),
        reference: "TXN-1",
        reason: "Sent from the bank",
      }),
    ).toEqual({ ok: false, reason: "notFresh" });

    queueApproval();
    expect(
      await markPayoutFailed({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: stale(),
        reason: "The bank bounced it",
      }),
    ).toEqual({ ok: false, reason: "notFresh" });

    expect(writes("payouts")).toEqual([]);
    expect(writes("provider_ledger")).toEqual([]);
  });
});

describe("a reason and a reference are required", () => {
  it("refuses an approval with nothing written in the box", async () => {
    const { approvePayout } = await import("@/lib/data/payouts");
    queueApproval();

    expect(
      await approvePayout({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reason: "ok",
      }),
    ).toEqual({ ok: false, reason: "needsReason" });
    expect(writes("payouts")).toEqual([]);
  });

  it("refuses a send with no transaction number", async () => {
    /*
     * The reference is the only thing that can answer "where did my money go"
     * afterwards, so a `sent` row without one is a claim with no evidence.
     */
    const { markPayoutSent } = await import("@/lib/data/payouts");
    queueApproval();

    expect(
      await markPayoutSent({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reference: "   ",
        reason: "Sent from the bank",
      }),
    ).toEqual({ ok: false, reason: "needsReference" });
    expect(writes("provider_ledger"), "no payout row").toEqual([]);
  });
});

describe("a draft whose ledger has moved", () => {
  it("is recomputed rather than approved", async () => {
    /*
     * A refund agreed or a recovery taken between the draft and the approval means
     * the figure no longer has a ledger behind it. The count moved, so nothing is
     * approved; the row is updated in place and the caller is told the new figure.
     */
    answers.payouts = [{ data: draft({ ledger_rows_at_draft: 3 }), error: null }];
    answers.payout_destinations = [{ data: destination(), error: null }];
    answers.provider_ledger = [{ data: null, error: null, count: 5 }];
    rpcAnswers = [2500];

    const { approvePayout } = await import("@/lib/data/payouts");
    const result = await approvePayout({
      payoutId: PAYOUT,
      adminId: ADMIN,
      reauthenticatedAt: fresh(),
      reason: "Weekly approval",
    });

    expect(result).toEqual({ ok: true, recomputed: true, net: 2500 });

    const updates = writes("payouts");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      net_rupees: 2500,
      ledger_rows_at_draft: 5,
    });
    // Recomputing is not approving: no status, no stamp, no name on it.
    expect(updates[0].payload).not.toHaveProperty("status");
    expect(audit, "nothing was approved, so nothing is recorded as approved").toEqual(
      [],
    );
  });

  it("is updated in place rather than failed, so the week is not blocked for ever", async () => {
    /*
     * `payouts_provider_period_idx` is unique on `(provider_id, period_start)`.
     * Failing a stale draft would leave that week unable to be drafted again, so the
     * recompute writes to the same row — which `enforce_payout_transition` permits
     * precisely while the status is still `draft`.
     */
    answers.payouts = [{ data: draft(), error: null }];
    answers.payout_destinations = [{ data: destination(), error: null }];
    answers.provider_ledger = [{ data: null, error: null, count: 9 }];
    rpcAnswers = [100];

    const { approvePayout } = await import("@/lib/data/payouts");
    await approvePayout({
      payoutId: PAYOUT,
      adminId: ADMIN,
      reauthenticatedAt: fresh(),
      reason: "Weekly approval",
    });

    const updates = writes("payouts");
    expect(updates[0].filters).toContainEqual(["id", PAYOUT]);
    expect(updates[0].filters, "only while still a draft").toContainEqual([
      "status",
      "draft",
    ]);
  });
});

describe("a destination that changed after the draft", () => {
  it("refuses the approval", async () => {
    /*
     * THE TAKEOVER THE COOLDOWN WOULD OTHERWISE MISS. A draft is created against a
     * confirmed destination; somebody then changes where the money goes, which
     * starts a fresh 72-hour window on the NEW row. Nothing in the draft mentions an
     * account, so without this re-check an approval and a send would release digits
     * for an address no window has elapsed on.
     */
    answers.payouts = [{ data: draft(), error: null }];
    answers.payout_destinations = [
      { data: destination({ id: "99999999-9999-4999-8999-999999999999" }), error: null },
    ];

    const { approvePayout } = await import("@/lib/data/payouts");
    expect(
      await approvePayout({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reason: "Weekly approval",
      }),
    ).toEqual({ ok: false, reason: "destinationChanged" });
    expect(writes("payouts")).toEqual([]);
  });

  it("refuses the send as well, because the approval may be days old", async () => {
    answers.payouts = [{ data: draft({ status: "approved" }), error: null }];
    answers.payout_destinations = [
      { data: destination({ usable_from: "2099-01-01T00:00:00.000Z" }), error: null },
    ];

    const { markPayoutSent } = await import("@/lib/data/payouts");
    expect(
      await markPayoutSent({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reference: "TXN-9",
        reason: "Sent from the bank",
      }),
    ).toEqual({ ok: false, reason: "destinationChanged" });
    expect(writes("provider_ledger"), "no payout row").toEqual([]);
  });

  it("refuses rather than guessing when the destination cannot be read", async () => {
    // Rule 6 on a gate rather than a screen: "we could not check" must not pass as
    // "we checked".
    answers.payouts = [{ data: draft(), error: null }];
    answers.payout_destinations = [{ data: null, error: { message: "boom" } }];

    const { approvePayout } = await import("@/lib/data/payouts");
    const result = await approvePayout({
      payoutId: PAYOUT,
      adminId: ADMIN,
      reauthenticatedAt: fresh(),
      reason: "Weekly approval",
    });

    expect(result.ok).toBe(false);
    expect(writes("payouts")).toEqual([]);
  });
});

describe("a held payout", () => {
  it("cannot be approved, whatever the reason it is held for", async () => {
    answers.payouts = [{ data: draft({ held_reason: "cooling" }), error: null }];

    const { approvePayout } = await import("@/lib/data/payouts");
    expect(
      await approvePayout({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reason: "Weekly approval",
      }),
    ).toEqual({ ok: false, reason: "held" });
    expect(writes("payouts")).toEqual([]);
  });
});

describe("what gets recorded, and when", () => {
  it("records the approval before it writes the status", async () => {
    queueApproval();

    const { approvePayout } = await import("@/lib/data/payouts");
    expect(
      await approvePayout({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reason: "Figures match the week",
      }),
    ).toEqual({ ok: true });

    expect(audit).toHaveLength(1);
    expect(audit[0].kind).toBe("payout.approved");
    expect(audit[0].detail).toMatchObject({
      payoutId: PAYOUT,
      net: 4000,
      reason: "Figures match the week",
    });

    const updates = writes("payouts");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      status: "approved",
      approved_by: ADMIN,
    });
  });

  it("records a send with its reference and writes the payout row", async () => {
    answers.payouts = [{ data: draft({ status: "approved" }), error: null }];
    answers.payout_destinations = [{ data: destination(), error: null }];

    const { markPayoutSent } = await import("@/lib/data/payouts");
    expect(
      await markPayoutSent({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reference: "TXN-77",
        reason: "Paid from Nabil",
      }),
    ).toEqual({ ok: true });

    expect(audit[0].kind).toBe("payout.sent");
    expect(audit[0].detail).toMatchObject({ reference: "TXN-77" });

    const ledger = writes("provider_ledger");
    expect(ledger).toHaveLength(1);
    expect(ledger[0].payload).toMatchObject({
      payout_id: PAYOUT,
      kind: "payout",
      amount_rupees: 4000,
    });
  });

  it("reverses a sent payout and never a drafted one", async () => {
    // From `sent`, a reversal; the `payout` row stays, because it is the evidence a
    // remittance was attempted.
    answers.payouts = [{ data: draft({ status: "sent" }), error: null }];

    const { markPayoutFailed } = await import("@/lib/data/payouts");
    expect(
      await markPayoutFailed({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reason: "The account was closed",
      }),
    ).toEqual({ ok: true });

    const ledger = writes("provider_ledger");
    expect(ledger).toHaveLength(1);
    expect(ledger[0].payload).toMatchObject({
      kind: "payout_reversal",
      amount_rupees: 4000,
    });

    // And from `draft`, nothing: no money moved, so there is nothing to take back.
    ops = [];
    audit = [];
    answers.payouts = [{ data: draft(), error: null }];

    expect(
      await markPayoutFailed({
        payoutId: PAYOUT,
        adminId: ADMIN,
        reauthenticatedAt: fresh(),
        reason: "Abandoned — their listing closed",
      }),
    ).toEqual({ ok: true });

    expect(writes("provider_ledger"), "nothing to reverse").toEqual([]);
  });

  it("confirms without a code, and says so by not asking for one", async () => {
    /*
     * A CODE FOR A WRITE THAT MOVES NOTHING is how people learn to tap through the
     * ones that do. Confirming records an answer that came from outside and changes
     * no figure, so it takes the audit row and no re-challenge — and the absence of
     * a `reauthenticatedAt` parameter is what makes that structural rather than a
     * convention.
     */
    answers.payouts = [{ data: draft({ status: "sent" }), error: null }];

    const { markPayoutConfirmed } = await import("@/lib/data/payouts");
    expect(
      await markPayoutConfirmed({ payoutId: PAYOUT, adminId: ADMIN }),
    ).toEqual({ ok: true });

    expect(audit[0].kind).toBe("admin.action");
    expect(audit[0].detail).toMatchObject({ action: "payout.confirmed" });
    expect(writes("payouts")[0].payload).toMatchObject({ status: "confirmed" });
  });
});
