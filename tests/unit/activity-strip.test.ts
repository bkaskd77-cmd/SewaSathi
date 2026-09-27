import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVITY_DELAY_MINUTES,
  ACTIVITY_FLOOR,
  ACTIVITY_MAX,
} from "@/lib/config/platform";
// A plain import, not a top-level `await import`: `vi.mock` is hoisted above the
// imports, so the stubs below are already in place when this is resolved — and
// this project's TS target refuses top-level await.
import { recentActivity } from "@/lib/data/activity";
import { ActivityStrip } from "@/components/marketing/activity-strip";

/**
 * The five constraints the activity strip was approved under, one test each.
 *
 * WHAT IT REPLACED IS WHY EVERY ONE OF THESE IS HERE. `lib/mock/activityFeed.ts`
 * cycled "Priya in Baneshwor booked a cleaning 3 minutes ago" — a named
 * individual, a real Kathmandu ward, a timestamp that never moved, and no real
 * booking behind any of it. Each constraint below is the thing that stops the
 * real version being worse than the invented one, because the real version names
 * somebody who exists.
 *
 * TWO HALVES, AND THEY PROVE DIFFERENT THINGS. Three filters live in the SQL —
 * the completion stamp, the status, and the amount dispute — so they are asserted
 * against the query the module builds. Two live in JavaScript, because they read
 * an embedded relation, so they are asserted against rows. Testing a SQL filter
 * by handing the module rows it would never have received proves nothing at all.
 */

type Row = Record<string, unknown>;

let rows: Row[] = [];
let error: unknown = null;
const filters: Array<[string, string, unknown]> = [];
let selected = "";

class Query {
  select(expression: string) {
    selected = expression;
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  private note(verb: string, column: string, value: unknown) {
    filters.push([verb, column, value]);
    return this;
  }
  eq(column: string, value: unknown) {
    return this.note("eq", column, value);
  }
  lte(column: string, value: unknown) {
    return this.note("lte", column, value);
  }
  gte(column: string, value: unknown) {
    return this.note("gte", column, value);
  }
  neq(column: string, value: unknown) {
    return this.note("neq", column, value);
  }
  is(column: string, value: unknown) {
    return this.note("is", column, value);
  }
  then<T>(resolve: (value: { data: Row[] | null; error: unknown }) => T) {
    return Promise.resolve({ data: error ? null : rows, error }).then(resolve);
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => new Query() }),
}));

vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => true }));

/*
 * `unstable_cache` needs a request context and would hold one answer across
 * every case in this file. A pass-through is the honest stand-in: what is under
 * test is which rows survive, not that the result is shared between visitors.
 */
vi.mock("next/cache", () => ({
  unstable_cache: <T,>(fn: T) => fn,
}));

/* React's per-request memo, which `lib/data/source.ts` uses and there is no
   request here. A pass-through, same as `tests/unit/personal-reads.test.ts`. */
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

/*
 * next-intl's server helpers need a request, and outside one they raise "not
 * supported in Client Components" — which is the wrong sentence for what has
 * happened but does mean the component cannot be called. English copy is enough
 * for what these cases ask: whether an entry survives into the list at all.
 * `npm run check:messages` is what proves both catalogues can render it.
 */
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    `${key}:${JSON.stringify(values ?? {})}`,
}));



/** A finished job as the query returns it, eligible unless something is passed. */
function row(overrides: Row = {}): Row {
  return {
    category_slug: "plumbing",
    completed_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    amount_mismatch_at: null,
    profiles: { full_name: "Anita Shrestha", hide_from_activity: false },
    addresses: { city: "Kathmandu" },
    guarantee_claims: [],
    ...overrides,
  };
}

/** Enough eligible jobs to clear the floor, so a case can remove one. */
function eligible(n: number): Row[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      profiles: { full_name: `Person${i} Surname`, hide_from_activity: false },
    }),
  );
}

beforeEach(() => {
  rows = [];
  error = null;
  filters.length = 0;
  selected = "";
});

describe("1. the ward never leaves the database", () => {
  it("selects the city and nothing narrower", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    await recentActivity();

    expect(selected).toContain("addresses(city)");
    // The two columns that would turn a city into a neighbourhood. `area_key`
    // is `lalitpur-4`; a ward number plus a trade is a few hundred households.
    expect(selected).not.toContain("area_key");
    expect(selected).not.toContain("ward_number");
    expect(selected).not.toContain("tole");
    expect(selected).not.toContain("landmark");
  });

  it("carries only the first name through, never the surname", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    const entries = await recentActivity();

    expect(entries[0].name).toBe("Person0");
    for (const entry of entries) expect(entry.name).not.toContain("Surname");
  });

  it("selects no amount, no id and no address beyond the city", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    await recentActivity();

    /*
     * THE FK HINTS COME OUT FIRST, and the reason is a false positive worth
     * keeping in the file: `profiles!bookings_customer_id_fkey` contains the
     * text `customer_id` while selecting no such column. A substring check that
     * did not know the difference would have failed on a correct select, and the
     * tempting fix — deleting `customer_id` from the list — would have retired a
     * real assertion to silence a bad one.
     */
    const columns = selected.replace(/![a-z_]+/g, "");

    for (const forbidden of [
      "final_amount",
      "quoted_min",
      "quoted_max",
      "customer_id",
      "provider_id",
      "reference",
      "description",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe("2. nothing live while somebody is at the door", () => {
  it("asks only for jobs completed at least the delay ago", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    const before = Date.now();
    await recentActivity();

    const cutoff = filters.find(([verb, column]) => verb === "lte" && column === "completed_at");
    expect(cutoff).toBeDefined();

    const asked = Date.parse(String(cutoff![2]));
    const expected = before - ACTIVITY_DELAY_MINUTES * 60 * 1000;
    // Within a second of an hour ago: the clock moves while the test runs.
    expect(Math.abs(asked - expected)).toBeLessThan(1_000);
  });

  it("asks only for completed jobs, so an accepted one cannot appear", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    await recentActivity();

    expect(filters).toContainEqual(["eq", "status", "completed"]);
  });

  it("rounds the age to the hour and never below one", async () => {
    // A job finished 61 minutes ago is eligible and reads as an hour, not as
    // "1.02 hours" and not as 0 — a precise minute is a timestamp.
    rows = [
      ...eligible(ACTIVITY_FLOOR - 1),
      row({ completed_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() }),
    ];
    const entries = await recentActivity();

    expect(entries[entries.length - 1].hoursAgo).toBe(1);
    for (const entry of entries) expect(entry.hoursAgo).toBeGreaterThanOrEqual(1);
  });
});

describe("3. a customer who opted out does not appear", () => {
  it("drops their entry and keeps everybody else's", async () => {
    rows = [
      row({
        profiles: { full_name: "Bina Tamang", hide_from_activity: true },
      }),
      ...eligible(ACTIVITY_FLOOR),
    ];
    const entries = await recentActivity();

    expect(entries.map((e) => e.name)).not.toContain("Bina");
    expect(entries).toHaveLength(ACTIVITY_FLOOR);
  });
});

describe("4. a complaint is not advertising", () => {
  it("drops a booking carrying a guarantee claim", async () => {
    rows = [
      row({
        profiles: { full_name: "Chandra Rai", hide_from_activity: false },
        guarantee_claims: [{ id: "a-claim" }],
      }),
      ...eligible(ACTIVITY_FLOOR),
    ];
    const entries = await recentActivity();

    expect(entries.map((e) => e.name)).not.toContain("Chandra");
    expect(entries).toHaveLength(ACTIVITY_FLOOR);
  });

  it("asks the database to exclude a disputed amount", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    await recentActivity();

    expect(filters).toContainEqual(["is", "amount_mismatch_at", null]);
  });
});

describe("5. silent below the floor", () => {
  /*
   * THE FIRST VERSION OF THIS BLOCK WAS BLIND, and it is worth saying how.
   * Every case read `ACTIVITY_FLOOR` and moved with it, so lowering the floor to
   * 1 left all of them green — they asserted that the floor is the floor. The
   * constraint is not that; it is that **one lonely entry is never the feed**,
   * which is a product decision and has to be pinned as one.
   */
  it("never renders a single entry, whatever the floor is set to", async () => {
    rows = eligible(1);
    expect(await recentActivity()).toEqual([]);
    // And the floor cannot be set to the value that would make it possible.
    expect(ACTIVITY_FLOOR).toBeGreaterThan(1);
  });

  it("shows nothing at one below it", async () => {
    rows = eligible(ACTIVITY_FLOOR - 1);
    expect(await recentActivity()).toEqual([]);
  });

  it("shows everything at exactly the floor", async () => {
    rows = eligible(ACTIVITY_FLOOR);
    expect(await recentActivity()).toHaveLength(ACTIVITY_FLOOR);
  });

  it("caps what it shows however much is eligible", async () => {
    rows = eligible(ACTIVITY_MAX + 20);
    expect(await recentActivity()).toHaveLength(ACTIVITY_MAX);
  });

  it("counts what is renderable, not what the query returned", async () => {
    // The floor has to be met AFTER the opt-outs and claims are removed, or a
    // single eligible entry rides in behind a query that returned plenty.
    rows = [
      ...eligible(ACTIVITY_FLOOR - 1),
      ...Array.from({ length: 5 }, () =>
        row({ profiles: { full_name: "Opted Out", hide_from_activity: true } }),
      ),
    ];
    expect(await recentActivity()).toEqual([]);
  });
});

describe("a failed read is silence, never a smaller feed", () => {
  it("returns nothing when the query errors", async () => {
    error = { message: "connection reset" };
    expect(await recentActivity()).toEqual([]);
  });

  it("drops a row missing the name, the city or the trade", async () => {
    // Rule 6 at row level: a gap is not a thing to fill in. The predecessor
    // could always render a sentence because it invented every part of it.
    rows = [
      ...eligible(ACTIVITY_FLOOR),
      row({ profiles: { full_name: null, hide_from_activity: false } }),
      row({ addresses: null }),
      row({ category_slug: null }),
    ];
    expect(await recentActivity()).toHaveLength(ACTIVITY_FLOOR);
  });
});

describe("the component renders nothing for an empty list", () => {
  it("returns null rather than an empty band", async () => {
    expect(await ActivityStrip({ entries: [] })).toBeNull();
  });

  it("names no category it cannot render, and renders nothing if none survive", async () => {
    // A trade we have retired since the job was finished. The slug must never
    // reach the page as its own text.
    const retired = Array.from({ length: ACTIVITY_FLOOR }, () => ({
      name: "Anita",
      city: "Kathmandu",
      categorySlug: "palanquin-repair",
      hoursAgo: 3,
    }));
    expect(await ActivityStrip({ entries: retired })).toBeNull();
  });
});

describe("the select is one literal, so the manifest scanner can read it", () => {
  it("has no concatenation inside the select call", async () => {
    // `scripts/column-manifest.mjs` checks every selected column exists, and it
    // reads the literal after `.select(`. Written as `"a, b, " + "c"` the whole
    // list went unchecked — on the one select here where a stray column is a
    // privacy incident rather than a bug.
    const source = readFileSync("lib/data/activity.ts", "utf8");
    const call = source.slice(source.indexOf("addresses(city)") - 400);
    expect(call.slice(0, call.indexOf("addresses(city)"))).not.toContain('" +');
  });
});
