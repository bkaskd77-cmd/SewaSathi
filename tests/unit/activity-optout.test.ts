import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The customer's own switch, and the three ways it could have been wrong.
 *
 *   1. THE ACTOR. The write must be scoped to the session's id and to nothing
 *      that arrived in the form. Three holes in this product have been the other
 *      arrangement — an id came from the browser and nothing asked whose it was.
 *   2. THE VALUE, NOT A FLIP. A stale page or a double tap must not put somebody
 *      back into a feed they have just left, so the form carries the state being
 *      asked for and the action writes exactly that.
 *   3. UNAVAILABLE IS NOT OFF. A failed read returns null, and the screen says so
 *      rather than rendering a toggle as "you are visible" when nobody knows —
 *      the shape rule 6 takes for a setting.
 */

type Update = { table: string; values: Record<string, unknown>; filters: Array<[string, unknown]> };

const updates: Update[] = [];
const reads: Array<[string, unknown]> = [];
let readRow: Record<string, unknown> | null = { hide_from_activity: false };
let readError: unknown = null;
let writeError: unknown = null;

class Query {
  private update_: Update | null = null;

  select() {
    return this;
  }
  update(values: Record<string, unknown>) {
    this.update_ = { table: "profiles", values, filters: [] };
    updates.push(this.update_);
    return this;
  }
  eq(column: string, value: unknown) {
    if (this.update_) this.update_.filters.push([column, value]);
    else reads.push([column, value]);
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: readError ? null : readRow, error: readError });
  }
  then<T>(resolve: (value: { error: unknown }) => T) {
    return Promise.resolve({ error: writeError }).then(resolve);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ from: () => new Query() }),
}));
vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => true }));
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

const ME = "11111111-a111-4111-8111-111111111111";
const SOMEBODY_ELSE = "22222222-b222-4222-8222-222222222222";

let sessionId: string | null = ME;
const revalidated: string[] = [];

vi.mock("@/lib/auth/session", () => ({
  getSessionProfile: async () => (sessionId ? { id: sessionId } : null),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidated.push(path),
}));

import { readActivityOptOut, setActivityOptOut } from "@/lib/data/profile-prefs";
import { setActivityOptOutAction } from "@/app/[locale]/(app)/account/actions";

beforeEach(() => {
  updates.length = 0;
  reads.length = 0;
  revalidated.length = 0;
  readRow = { hide_from_activity: false };
  readError = null;
  writeError = null;
  sessionId = ME;
});

describe("the read", () => {
  it("names the person in the query rather than leaving it to RLS", async () => {
    await readActivityOptOut(ME);
    expect(reads).toContainEqual(["id", ME]);
  });

  it("returns null when the read fails, never false", async () => {
    readError = { message: "connection reset" };
    expect(await readActivityOptOut(ME)).toBeNull();
  });

  it("returns null when there is no row, never false", async () => {
    readRow = null;
    expect(await readActivityOptOut(ME)).toBeNull();
  });

  it("reads a set flag as set", async () => {
    readRow = { hide_from_activity: true };
    expect(await readActivityOptOut(ME)).toBe(true);
  });
});

describe("the write", () => {
  it("writes the value asked for, not the opposite of what it read", async () => {
    await setActivityOptOut(ME, true);
    expect(updates[0].values).toEqual({ hide_from_activity: true });

    updates.length = 0;
    await setActivityOptOut(ME, false);
    expect(updates[0].values).toEqual({ hide_from_activity: false });
  });

  it("scopes the update to that one person", async () => {
    await setActivityOptOut(ME, true);
    expect(updates[0].filters).toEqual([["id", ME]]);
  });

  it("touches nothing but the one column", async () => {
    // The column grant in 20260927000005 would refuse anything else, and this
    // is the application half of the same statement.
    await setActivityOptOut(ME, true);
    expect(Object.keys(updates[0].values)).toEqual(["hide_from_activity"]);
  });

  it("reports a failure rather than claiming it saved", async () => {
    writeError = { message: "permission denied for table profiles" };
    const result = await setActivityOptOut(ME, true);
    expect(result.ok).toBe(false);
  });
});

describe("the action", () => {
  it("takes the id from the session and ignores one in the form", async () => {
    const form = new FormData();
    form.set("hidden", "true");
    // Somebody else's id, submitted deliberately. It must have no effect.
    form.set("id", SOMEBODY_ELSE);
    form.set("actorId", SOMEBODY_ELSE);

    await setActivityOptOutAction(form);

    expect(updates[0].filters).toEqual([["id", ME]]);
  });

  it("writes false for anything that is not the string true", async () => {
    const form = new FormData();
    form.set("hidden", "false");
    await setActivityOptOutAction(form);
    expect(updates[0].values).toEqual({ hide_from_activity: false });
  });

  it("does nothing at all when nobody is signed in", async () => {
    sessionId = null;
    const form = new FormData();
    form.set("hidden", "true");

    await setActivityOptOutAction(form);

    expect(updates).toEqual([]);
  });

  it("revalidates the screen and does not ask the client to refresh", async () => {
    const form = new FormData();
    form.set("hidden", "true");
    await setActivityOptOutAction(form);

    expect(revalidated).toEqual(["/[locale]/(app)/account"]);
  });
});
