import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How the money read shapes what it found.
 *
 * WHAT THIS COVERS THAT `tests/db/provider-money.test.ts` CANNOT. That file proves
 * the arithmetic against real Postgres — `provider_balance`, the debt, what a cash
 * job does. It cannot reach `providerMoney` itself, because that goes through
 * `createAdminClient` and the db harness has no supabase-js in front of it. So the
 * decisions this function makes about rows it has already fetched live here:
 *
 *   WHICH PAYOUT IS "CURRENT" versus history — keyed on
 *   `UNRESOLVED_PAYOUT_STATUSES`, so a sixth status cannot land in neither bucket.
 *   WHETHER A HELD QUARTER IS STILL NEWS — a release date in the past is money that
 *   has already joined a payout, and listing it as coming would promise it twice.
 *   WHETHER THERE IS ANYTHING TO SHOW AT ALL — `hasSettled`, which decides a
 *   sentence rather than a figure, and must not read as "you are owed nothing".
 *   AND THAT A FAILED READ IS NEVER ZEROES.
 */

type Op = { table: string; filters: Array<[string, unknown]> };

let ops: Op[] = [];
let answers: Record<string, { data: unknown; error: unknown }> = {};
let rpc: Record<string, number> = {};

class Fake {
  private readonly entry: Op;
  constructor(table: string) {
    this.entry = { table, filters: [] };
    ops.push(this.entry);
  }
  private note(c: string, v: unknown) {
    this.entry.filters.push([c, v]);
    return this;
  }
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  eq(c: string, v: unknown) { return this.note(c, v); }
  gt(c: string, v: unknown) { return this.note(c, v); }
  is(c: string, v: unknown) { return this.note(c, v); }
  in(c: string, v: unknown) { return this.note(c, v); }
  not(c: string, _o: string, v: unknown) { return this.note(c, v); }
  then<T>(resolve: (value: { data: unknown; error: unknown }) => T) {
    return Promise.resolve(
      answers[this.entry.table] ?? { data: [], error: null },
    ).then(resolve);
  }
}

const client = {
  from: (table: string) => new Fake(table),
  rpc: (name: string) => Promise.resolve({ data: rpc[name] ?? 0, error: null }),
};

vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
vi.mock("@/lib/audit", () => ({
  recordSecurityEvent: async () => {},
  recordDestinationAccess: async () => {},
}));

const PROVIDER = "11111111-e111-4111-8111-111111111111";
const DAY = 86_400_000;

function payoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-e222-4222-8222-222222222222",
    period_start: "2026-09-21T00:00:00.000Z",
    period_end: "2026-09-28T00:00:00.000Z",
    status: "draft",
    net_rupees: 4000,
    held_reason: null,
    external_reference: null,
    failure_reason: null,
    settled_at: null,
    created_at: "2026-09-29T03:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  ops = [];
  answers = {};
  rpc = {};
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});

describe("which payout is this week and which is history", () => {
  it("puts an unresolved payout in current and finished ones in history", async () => {
    rpc = { provider_balance: 4000, provider_outstanding: 0 };
    answers.provider_ledger = {
      data: [{ kind: "earning", amount_rupees: 4000 }],
      error: null,
    };
    answers.payouts = {
      data: [
        payoutRow(),
        payoutRow({ id: "old-1", status: "confirmed", net_rupees: 2500 }),
        payoutRow({ id: "old-2", status: "failed", net_rupees: 900 }),
      ],
      error: null,
    };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.ok).toBe(true);
    expect(money.current?.status).toBe("draft");
    expect(money.history.map((p) => p.status)).toEqual(["confirmed", "failed"]);
    expect(money.balance).toBe(4000);
  });

  it("has no current payout when every one of them is finished", async () => {
    rpc = { provider_balance: 0, provider_outstanding: 0 };
    answers.provider_ledger = {
      data: [{ kind: "earning", amount_rupees: 1000 }],
      error: null,
    };
    answers.payouts = {
      data: [payoutRow({ status: "confirmed" })],
      error: null,
    };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.current).toBeNull();
    expect(money.history).toHaveLength(1);
  });
});

describe("a held quarter is only news until it is released", () => {
  it("lists one whose date has not come", async () => {
    rpc = { provider_balance: 6000, provider_outstanding: 0 };
    answers.bookings = {
      data: [
        {
          id: "b1",
          reference: "SK-1",
          payout_holdback_rupees: 2000,
          payout_holdback_until: new Date(Date.now() + 10 * DAY).toISOString(),
        },
      ],
      error: null,
    };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.heldBack).toHaveLength(1);
    expect(money.heldBack[0].rupees).toBe(2000);
  });

  it("drops one whose date has passed, because it has already been paid", async () => {
    /*
     * A RELEASED QUARTER HAS JOINED A PAYOUT. Listing it as "arrives on the 14th"
     * after the 14th would promise the same money twice, which on a screen somebody
     * checks when they are short is worse than not mentioning it.
     */
    rpc = { provider_balance: 8000, provider_outstanding: 0 };
    answers.bookings = {
      data: [
        {
          id: "b1",
          reference: "SK-1",
          payout_holdback_rupees: 2000,
          payout_holdback_until: new Date(Date.now() - DAY).toISOString(),
        },
      ],
      error: null,
    };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.heldBack).toEqual([]);
  });
});

describe("is there anything to show at all", () => {
  it("counts a held quarter as something, even with an empty ledger", async () => {
    /*
     * THE CASE THAT CORRECTED THE SENTENCE. `hasSettled` was `ledger.length > 0`,
     * so a professional who finished a job on Monday — whose week is totalled on
     * Tuesday — was told "nothing has settled yet", which is false to somebody who
     * worked yesterday. Anything the view can show counts, and the copy says
     * "totalled up" rather than "settled".
     */
    rpc = { provider_balance: 0, provider_outstanding: 0 };
    answers.bookings = {
      data: [
        {
          id: "b1",
          reference: "SK-9",
          payout_holdback_rupees: 1500,
          payout_holdback_until: new Date(Date.now() + 5 * DAY).toISOString(),
        },
      ],
      error: null,
    };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.hasSettled).toBe(true);
  });

  it("says there is nothing when there is genuinely nothing", async () => {
    rpc = { provider_balance: 0, provider_outstanding: 0 };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.ok, "a successful read of an empty account").toBe(true);
    expect(money.hasSettled).toBe(false);
    expect(money.balance).toBe(0);
  });
});

describe("a failed read is not a balance of zero", () => {
  it("reports ok false rather than zeroes a screen would print", async () => {
    answers.payouts = { data: null, error: { message: "boom" } };

    const { providerMoney } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(money.ok).toBe(false);
    expect(money.hasSettled, "no evidence, not an empty account").toBe(false);
  });

  it("makes whyWaiting say unreadable rather than nothing waiting", async () => {
    answers.payouts = { data: null, error: { message: "boom" } };

    const { providerMoney, waitFor } = await import("@/lib/data/payouts");
    const money = await providerMoney(PROVIDER);

    expect(waitFor(money)).toEqual({ state: "unreadable" });
  });
});

describe("the listing id is the only thing it filters on", () => {
  it("names the professional in every query it makes", async () => {
    /*
     * The id comes from the session in both callers and never from a browser — the
     * shape all three authorization holes in this product had in common. This asserts
     * the read is scoped at all: a query here that forgot the filter would return
     * somebody else's money through a service-role client.
     */
    rpc = { provider_balance: 0, provider_outstanding: 0 };

    const { providerMoney } = await import("@/lib/data/payouts");
    await providerMoney(PROVIDER);

    for (const op of ops) {
      expect(
        op.filters.some(([, value]) => value === PROVIDER),
        `${op.table} was queried without naming the provider`,
      ).toBe(true);
    }
  });
});
