import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A screen that belongs to one person names that person in the query.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT, AND WHY IT IS A UNIT TEST. `/bookings`
 * showed the admin account fourteen bookings it did not own. `listBookings`
 * had no owner predicate at all — it leaned entirely on RLS, and the day
 * `"Admins read every booking" using (is_admin())` was added for the admin
 * queues, that read silently widened to every customer in the product. Nothing
 * failed. The comment on the read still said RLS limited it to the customer's
 * own rows, and it had been true when it was written.
 *
 * A DATABASE TEST CANNOT CATCH THIS, which is the whole reason this file is
 * here rather than in `tests/db/`. The policies are right: the admin SELECT
 * policy is deliberate, `tests/db/rls-matrix.test.ts` asserts it, and
 * `docs/rls-matrix.md` publishes it. What was wrong was the QUERY — so the
 * query is what gets pinned. The supabase client is a recorder: every filter
 * each read applies is captured, and the assertion is that the owner's column
 * is among them.
 *
 * TO PROVE IT BITES: delete the `.eq("customer_id", …)` from `listBookings`
 * and this goes red.
 */

type Recorded = { table: string; filters: Array<[string, unknown]> };

let recorded: Recorded[] = [];

/**
 * The smallest thing that answers like a PostgREST builder.
 *
 * Every filter verb records its column and returns `this`; everything else
 * that only shapes the result is a no-op. It is a thenable, so `await`ing the
 * chain resolves the way supabase-js does.
 */
class Recorder {
  private readonly entry: Recorded;

  constructor(table: string) {
    this.entry = { table, filters: [] };
    recorded.push(this.entry);
  }

  private note(column: string, value: unknown) {
    this.entry.filters.push([column, value]);
    return this;
  }

  select() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  eq(column: string, value: unknown) { return this.note(column, value); }
  neq(column: string, value: unknown) { return this.note(column, value); }
  is(column: string, value: unknown) { return this.note(column, value); }
  in(column: string, value: unknown) { return this.note(column, value); }
  not(column: string, _op: string, value: unknown) { return this.note(column, value); }
  or(expression: string) { return this.note("or", expression); }
  gte(column: string, value: unknown) { return this.note(column, value); }
  lte(column: string, value: unknown) { return this.note(column, value); }

  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  single() { return Promise.resolve({ data: null, error: null }); }

  then<T>(resolve: (value: { data: unknown[]; error: null }) => T) {
    return Promise.resolve({ data: [] as unknown[], error: null }).then(resolve);
  }
}

const client = {
  from: (table: string) => new Recorder(table),
  rpc: () => Promise.resolve({ data: [], error: null }),
};

/*
 * `cache()` is React's per-request memo and there is no request here. A
 * pass-through is the right stand-in: these reads are being watched for the
 * filters they apply, not for how often they are allowed to run.
 */
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

/** The filters applied to the first read of a given table. */
function filtersOn(table: string): Array<[string, unknown]> {
  const entry = recorded.find((r) => r.table === table);
  if (!entry) throw new Error(`nothing read ${table} — recorded: ${recorded.map((r) => r.table).join(", ") || "nothing"}`);
  return entry.filters;
}

function names(table: string, column: string): boolean {
  return filtersOn(table).some(([c]) => c === column);
}

const ANITA = "11111111-a111-4111-8111-111111111111";
const KRISHNA = "33333333-c333-4333-8333-333333333333";

beforeEach(() => {
  recorded = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("the customer's own bookings", () => {
  it("names the customer when listing", async () => {
    const { listBookings } = await import("@/lib/data/bookings");
    await listBookings(ANITA);

    expect(names("bookings", "customer_id")).toBe(true);
    expect(filtersOn("bookings")).toContainEqual(["customer_id", ANITA]);
  });

  it("names the customer when reading one", async () => {
    const { getBooking } = await import("@/lib/data/bookings");
    await getBooking("SK-1234", { customerId: ANITA });

    expect(filtersOn("bookings")).toContainEqual(["customer_id", ANITA]);
  });

  /*
   * The unscoped form still exists — the dispatch sweep and the admin queues
   * read bookings that are nobody's in particular. What changed is that it can
   * no longer happen by omission: a caller that wants every row says so.
   */
  it("still reads any booking when no owner is named", async () => {
    const { getBooking } = await import("@/lib/data/bookings");
    await getBooking("SK-1234");

    expect(names("bookings", "customer_id")).toBe(false);
  });
});

describe("the professional's own rows", () => {
  it("names the professional on their survey fees", async () => {
    const { mySurveyFees } = await import("@/lib/data/survey");
    await mySurveyFees(KRISHNA);

    expect(filtersOn("survey_visit_fees")).toContainEqual(["provider_id", KRISHNA]);
  });
});

describe("the professional's phone", () => {
  /*
   * The policy hands the number to a customer only while the job is live, and
   * `"Admins read every contact"` drops that clause. The gate is applied here
   * too, so the window is the same whoever is asking.
   */
  it("is not read at all before anybody has agreed to come", async () => {
    const { getProviderPhone } = await import("@/lib/data/provider-jobs");
    const phone = await getProviderPhone({
      providerId: KRISHNA,
      bookingStatus: "pending",
    });

    expect(phone).toBeNull();
    expect(recorded.some((r) => r.table === "provider_contacts")).toBe(false);
  });

  it("is read while the job is under way", async () => {
    const { getProviderPhone } = await import("@/lib/data/provider-jobs");
    await getProviderPhone({ providerId: KRISHNA, bookingStatus: "en_route" });

    expect(filtersOn("provider_contacts")).toContainEqual(["provider_id", KRISHNA]);
  });
});
