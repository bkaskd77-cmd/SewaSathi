import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where somebody's money goes, and the four things that must be true of it.
 *
 * WHY A UNIT TEST WITH A FAKE CLIENT AND NOT A DATABASE TEST. `tests/db/` runs
 * raw Postgres, so it can prove the constraint refuses a plaintext number and
 * that the trigger refuses an edit — and it does. What it cannot reach is this
 * module: `createAdminClient()` is a supabase-js client and the db harness has
 * none. The three guarantees worth more than the SQL live here rather than there:
 *
 *   NOTHING IS WRITTEN WHEN THE WRITE WOULD BE WRONG — no key, or a session that
 *   has not proved who it is. Asserted by counting what the client was asked to
 *   do, not by catching a rejection: a throw after a partial write catches
 *   identically and leaves somebody with no destination.
 *
 *   A REVEAL LEAVES A RECORD. The only path that turns a sealed account number
 *   back into digits writes `security_events` first. Delete that call and the
 *   case goes red.
 *
 *   THE NOTICE GOES TO THE RIGHT PERSON AND CARRIES NO NUMBER. The interesting
 *   failure is not a missing notification; it is one addressed to whoever just
 *   changed the destination, or one that prints the account it is warning about.
 */

type Op = {
  table: string;
  op: "select" | "count" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

let ops: Op[] = [];
/** Canned answers, popped in order per table. */
let answers: Record<
  string,
  Array<{ data: unknown; error: unknown; count?: number | null }>
> = {};

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
  or(expression: string) { return this.note("or", expression); }

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

const client = { from: (table: string) => new Fake(table) };

/*
 * `cache()` is React's per-request memo and there is no request here — the same
 * pass-through `tests/unit/personal-reads.test.ts` uses, reached through
 * `lib/data/source.ts`.
 */
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

const KEY = Buffer.alloc(32, 5).toString("base64");
const KRISHNA_PROFILE = "33333333-c333-4333-8333-333333333333";
const KRISHNA_LISTING = "bbbbbbbb-9522-4522-8522-bbbbbbbbbbbb";
const ADMIN = "aaaaaaaa-9511-4511-8511-aaaaaaaaaaaa";
const ACCOUNT = "9779841234567";

function of(table: string): Op[] {
  return ops.filter((entry) => entry.table === table);
}

async function sealed(value: string): Promise<string> {
  const { sealSecret } = await import("@/lib/security/secret-box");
  return sealSecret(value);
}

/** A live row as the database would hand it back. */
async function liveRow(ref = ACCOUNT) {
  return {
    id: "dddddddd-9533-4533-8533-dddddddddddd",
    provider_id: KRISHNA_LISTING,
    kind: "bank",
    account_ref: await sealed(ref),
    account_name: "Krishna Tamang",
    bank_name: "Nabil Bank",
    created_at: "2026-09-01T00:00:00.000Z",
    usable_from: "2026-09-04T00:00:00.000Z",
    first_payout_confirmed_at: null,
    retired_at: null,
  };
}

beforeEach(() => {
  ops = [];
  answers = {};
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.PAYOUT_ENCRYPTION_KEY = KEY;
});

describe("how recent a proof of identity has to be", () => {
  it("treats a missing stamp as expired, never as probably fine", async () => {
    /*
     * `stepUpFor`'s rule for an absent `amr` timestamp, applied where guessing
     * wrong hands somebody's earnings to a stranger. An absent claim is not
     * evidence the window is open.
     */
    const { isFresh } = await import("@/lib/data/payout-destinations");
    expect(isFresh(null)).toBe(false);
  });

  it("accepts inside the window and refuses outside it", async () => {
    const { isFresh } = await import("@/lib/data/payout-destinations");
    const { REAUTH_WINDOW_MINUTES } = await import("@/lib/config/payout-policy");
    const now = new Date("2026-09-30T12:00:00Z");
    const minutesAgo = (n: number) =>
      new Date(now.getTime() - n * 60 * 1000);

    expect(isFresh(minutesAgo(REAUTH_WINDOW_MINUTES - 1), now)).toBe(true);
    expect(isFresh(minutesAgo(REAUTH_WINDOW_MINUTES + 1), now)).toBe(false);
  });

  it("refuses a stamp from the future", async () => {
    // A clock skew or a forged value must not read as "just verified".
    const { isFresh } = await import("@/lib/data/payout-destinations");
    const now = new Date("2026-09-30T12:00:00Z");
    expect(isFresh(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});

describe("a change that should not happen touches nothing", () => {
  it("writes nothing at all when the session has not re-authenticated", async () => {
    /*
     * ASSERTED BY COUNTING, NOT BY CATCHING. The failure worth having a test for
     * is a refusal that happens after the old destination was already retired —
     * which returns the same error to the caller and leaves the professional
     * unpayable.
     */
    const { changeDestination } = await import("@/lib/data/payout-destinations");

    const result = await changeDestination({
      profileId: KRISHNA_PROFILE,
      reauthenticatedAt: null,
      kind: "bank",
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
    });

    expect(result).toEqual({ ok: false, reason: "reauthRequired" });
    expect(ops, "the database was touched on a refused change").toEqual([]);
  });

  it("writes nothing when the sealing key is missing", async () => {
    /*
     * The opposite of the triage fallback, and the reason `sealSecret` throws
     * rather than degrading: "keep working" here means a bank account stored in
     * the clear. Sealing is attempted BEFORE the retire, so a key problem leaves
     * the existing destination live.
     */
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    const { changeDestination } = await import("@/lib/data/payout-destinations");

    const result = await changeDestination({
      profileId: KRISHNA_PROFILE,
      reauthenticatedAt: new Date(),
      kind: "bank",
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
    });

    expect(result).toEqual({ ok: false, reason: "cannotSeal" });
    expect(ops, "a row was retired with no replacement possible").toEqual([]);
  });
});

describe("replacing a destination", () => {
  async function change() {
    const replacement = {
      ...(await liveRow()),
      id: "eeeeeeee-9544-4544-8544-eeeeeeeeeeee",
      created_at: "2026-09-30T12:00:00.000Z",
      usable_from: "2026-10-03T12:00:00.000Z",
    };

    answers = {
      providers: [{ data: { id: KRISHNA_LISTING, profile_id: KRISHNA_PROFILE }, error: null }],
      payout_destinations: [
        { data: null, error: null, count: 1 }, // the history count — a change
        { data: null, error: null }, // the retire
        { data: replacement, error: null }, // the insert
      ],
    };

    const { changeDestination } = await import("@/lib/data/payout-destinations");
    return changeDestination({
      profileId: KRISHNA_PROFILE,
      reauthenticatedAt: new Date("2026-09-30T12:00:00Z"),
      kind: "bank",
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
      now: new Date("2026-09-30T12:00:00Z"),
    });
  }

  it("retires before it inserts, because the index refuses two live rows", async () => {
    const result = await change();
    expect(result.ok).toBe(true);

    const writes = of("payout_destinations").filter(
      (o) => o.op === "update" || o.op === "insert",
    );
    expect(writes.map((o) => o.op)).toEqual(["update", "insert"]);
    expect(writes[0].payload).toHaveProperty("retired_at");
    expect(writes[0].filters).toContainEqual(["retired_at", null]);
  });

  it("stores a sealed envelope and never the number", async () => {
    await change();
    const insert = of("payout_destinations").find((o) => o.op === "insert")!;
    const stored = insert.payload!.account_ref as string;

    const { isSealed } = await import("@/lib/security/secret-box");
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(ACCOUNT);
  });

  it("stamps the cooldown rather than leaving it to the payout run", async () => {
    await change();
    const insert = of("payout_destinations").find((o) => o.op === "insert")!;
    const { DESTINATION_COOLDOWN_HOURS } = await import("@/lib/config/payout-policy");

    const usable = new Date(insert.payload!.usable_from as string).getTime();
    expect(usable - new Date("2026-09-30T12:00:00Z").getTime()).toBe(
      DESTINATION_COOLDOWN_HOURS * 60 * 60 * 1000,
    );
  });

  it("notifies the professional's own profile and prints no account number", async () => {
    /*
     * THE INTERESTING FAILURE IS THE ADDRESS, NOT THE ABSENCE. A notice about a
     * redirected payout that goes to whoever just redirected it is worse than
     * none, because it reads on every dashboard as a control that is working.
     */
    await change();
    const notes = of("notifications").filter((o) => o.op === "insert");
    expect(notes).toHaveLength(1);

    const row = notes[0].payload!;
    expect(row.profile_id).toBe(KRISHNA_PROFILE);
    expect(row.kind).toBe("payout.destinationChanged");

    const params = JSON.stringify(row.params);
    expect(params).not.toContain(ACCOUNT);
    expect(params).toContain("••••4567");
    /*
     * THE OLD DESTINATION IS NOT IN IT, ON PURPOSE. Carrying it back meant
     * reading the previous row, and that read can fail — at which point "there
     * was nothing to replace" and "we could not tell" render as the same empty
     * string, in a warning about somebody's money.
     */
    expect(Object.keys(row.params as object)).toEqual(["to", "usableFrom"]);
  });

  it("says so, and sends nothing, when the replacement did not save", async () => {
    /*
     * The one ordering hazard in this module, named rather than hidden. The
     * retire succeeded and the insert did not, so there is no live destination —
     * recoverable by re-submitting, and money pausing is the right direction to
     * fail in. A notice here would tell somebody their account changed to
     * nothing.
     */
    answers = {
      providers: [{ data: { id: KRISHNA_LISTING, profile_id: KRISHNA_PROFILE }, error: null }],
      payout_destinations: [
        { data: null, error: null, count: 1 }, // the history count
        { data: null, error: null }, // the retire succeeds
        { data: null, error: { message: "network" } }, // the insert does not
      ],
    };

    const { changeDestination } = await import("@/lib/data/payout-destinations");
    const result = await changeDestination({
      profileId: KRISHNA_PROFILE,
      reauthenticatedAt: new Date(),
      kind: "esewa",
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
    });

    expect(result).toEqual({ ok: false, reason: "retiredButNotReplaced" });
    expect(of("notifications")).toEqual([]);
  });

  async function changeWithHistory(count: number | null) {
    answers = {
      providers: [{ data: { id: KRISHNA_LISTING, profile_id: KRISHNA_PROFILE }, error: null }],
      payout_destinations: [
        { data: null, error: null, count },
        { data: null, error: null },
        {
          data: {
            ...(await liveRow()),
            created_at: "2026-10-01T12:00:00.000Z",
            usable_from: "2026-10-01T12:00:00.000Z",
          },
          error: null,
        },
      ],
    };

    const { changeDestination } = await import("@/lib/data/payout-destinations");
    return changeDestination({
      profileId: KRISHNA_PROFILE,
      reauthenticatedAt: new Date("2026-10-01T12:00:00Z"),
      kind: "bank",
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
      now: new Date("2026-10-01T12:00:00Z"),
    });
  }

  it("a first destination is usable immediately, because nobody is being redirected", async () => {
    /*
     * The cooldown is a change control, not an arrival tax. A professional who
     * has never named a destination has no notice to read and nobody to object
     * to — making them wait three days for their first payment would be a delay
     * with no attacker on the other side of it. What guards a first row instead
     * is `first_payout_confirmed_at`: usable immediately, and still not payable
     * until a person looks.
     */
    const result = await changeWithHistory(0);
    expect(result).toMatchObject({ ok: true, isFirst: true });

    const insert = of("payout_destinations").find((o) => o.op === "insert")!;
    expect(insert.payload!.usable_from).toBe("2026-10-01T12:00:00.000Z");
  });

  it("counts retired rows, so retire-then-add cannot skip the cooldown", async () => {
    /*
     * THE BYPASS, PINNED. If "first" meant "no LIVE row", anybody could retire
     * their destination and insert another one to land a usable address
     * instantly — the account-takeover path with one extra step, and a step an
     * attacker is glad to take. The history count is unfiltered on `retired_at`
     * for exactly this; delete that filter's absence and this goes red.
     *
     * Asserted on the stamped date rather than on the flag alone, because the
     * flag is a label and `usable_from` is what the payout run actually reads.
     */
    const result = await changeWithHistory(1);
    expect(result).toMatchObject({ ok: true, isFirst: false });

    const count = of("payout_destinations").find((o) => o.op === "count")!;
    expect(
      count.filters.some(([column]) => column === "retired_at"),
      "the history count filtered on retired_at, which is the bypass",
    ).toBe(false);

    const insert = of("payout_destinations").find((o) => o.op === "insert")!;
    const { DESTINATION_COOLDOWN_HOURS } = await import("@/lib/config/payout-policy");
    expect(
      new Date(insert.payload!.usable_from as string).getTime() -
        new Date("2026-10-01T12:00:00Z").getTime(),
    ).toBe(DESTINATION_COOLDOWN_HOURS * 60 * 60 * 1000);
  });

  it("treats a failed history count as history, not as a first destination", async () => {
    /*
     * A read that did not answer must not hand somebody an instant destination
     * on a database blip. Null is "we could not tell", and the safe direction
     * costs a three-day wait rather than a window.
     */
    const result = await changeWithHistory(null);
    expect(result).toMatchObject({ ok: true, isFirst: false });
  });

  it("refuses an account with no listing behind it", async () => {
    answers = { providers: [{ data: null, error: null }] };
    const { changeDestination } = await import("@/lib/data/payout-destinations");

    const result = await changeDestination({
      profileId: KRISHNA_PROFILE,
      reauthenticatedAt: new Date(),
      kind: "bank",
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
    });

    expect(result).toEqual({ ok: false, reason: "noListing" });
    expect(
      of("payout_destinations").filter(
        (o) => o.op === "update" || o.op === "insert",
      ),
    ).toEqual([]);
  });
});

describe("reading the live destination", () => {
  it("masks it, and the plaintext is nowhere in what it returns", async () => {
    answers = { payout_destinations: [{ data: await liveRow(), error: null }] };
    const { currentDestination } = await import("@/lib/data/payout-destinations");

    const read = await currentDestination(KRISHNA_LISTING);
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read)).not.toContain(ACCOUNT);
    expect(read.destination!.accountMasked).toBe("••••4567");
  });

  it("names the listing, so nothing leans on a policy that does not exist", async () => {
    answers = { payout_destinations: [{ data: await liveRow(), error: null }] };
    const { currentDestination } = await import("@/lib/data/payout-destinations");
    await currentDestination(KRISHNA_LISTING);

    expect(of("payout_destinations")[0].filters).toContainEqual([
      "provider_id",
      KRISHNA_LISTING,
    ]);
    expect(of("payout_destinations")[0].filters).toContainEqual(["retired_at", null]);
  });

  it("tells a failed read apart from nobody having set one up", async () => {
    /*
     * Rule 6 for a screen: "we can't load this right now" and "tell us where to
     * pay you" are opposite sentences, and collapsing them asks a professional to
     * re-enter their bank account because of a database blip.
     */
    const { currentDestination } = await import("@/lib/data/payout-destinations");

    answers = { payout_destinations: [{ data: null, error: { message: "down" } }] };
    expect(await currentDestination(KRISHNA_LISTING)).toEqual({
      ok: false,
      destination: null,
    });

    ops = [];
    answers = { payout_destinations: [{ data: null, error: null }] };
    expect(await currentDestination(KRISHNA_LISTING)).toEqual({
      ok: true,
      destination: null,
    });
  });
});

describe("the one path that opens the envelope", () => {
  it("records who looked before it hands over any digits", async () => {
    /*
     * PROVEN BY COUNTING THE LOG, and it goes red if `recordDestinationAccess`
     * is removed from `revealDestination`. The professional cannot tell that
     * anybody read their account number, and somebody who wanted to has no
     * reason to mention it — so the record is the only control there is.
     */
    answers = {
      payout_destinations: [
        {
          data: {
            id: "dddddddd-9533-4533-8533-dddddddddddd",
            provider_id: KRISHNA_LISTING,
            account_ref: await sealed(ACCOUNT),
            account_name: "Krishna Tamang",
          },
          error: null,
        },
      ],
    };

    const { revealDestination } = await import("@/lib/data/payout-destinations");
    const result = await revealDestination({
      destinationId: "dddddddd-9533-4533-8533-dddddddddddd",
      adminId: ADMIN,
      reason: "first payout confirmation",
    });

    expect(result).toEqual({
      ok: true,
      accountRef: ACCOUNT,
      accountName: "Krishna Tamang",
    });

    const logged = of("security_events").filter((o) => o.op === "insert");
    expect(logged, "an account number was read with no record of it").toHaveLength(1);
    expect(logged[0].payload!.kind).toBe("payoutDestination.viewed");
    expect(logged[0].payload!.actor_id).toBe(ADMIN);
    expect(logged[0].payload!.subject_id).toBe(KRISHNA_LISTING);
  });

  it("puts the reason in the log and the number nowhere near it", async () => {
    // A log that holds what it is logging access to is a second copy, in a table
    // designed to be kept for ever and read by every admin.
    answers = {
      payout_destinations: [
        {
          data: {
            id: "dddddddd-9533-4533-8533-dddddddddddd",
            provider_id: KRISHNA_LISTING,
            account_ref: await sealed(ACCOUNT),
            account_name: "Krishna Tamang",
          },
          error: null,
        },
      ],
    };

    const { revealDestination } = await import("@/lib/data/payout-destinations");
    await revealDestination({
      destinationId: "dddddddd-9533-4533-8533-dddddddddddd",
      adminId: ADMIN,
      reason: "provider queried a failed transfer",
    });

    const logged = of("security_events").find((o) => o.op === "insert")!;
    expect(JSON.stringify(logged.payload)).toContain("failed transfer");
    expect(JSON.stringify(logged.payload)).not.toContain(ACCOUNT);
  });

  it("logs nothing for a destination that does not exist", async () => {
    // Nothing was revealed, so there is nothing to record — and a log row for a
    // read that did not happen is noise in the one place noise costs.
    answers = { payout_destinations: [{ data: null, error: null }] };
    const { revealDestination } = await import("@/lib/data/payout-destinations");

    expect(
      await revealDestination({ destinationId: "nope", adminId: ADMIN, reason: "x" }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(of("security_events")).toEqual([]);
  });
});

describe("confirming the first payout to a new destination", () => {
  it("reads the trigger's refusal as its own outcome", async () => {
    /*
     * The trigger is what makes it one name and one moment. This maps its
     * message rather than checking first and then writing, which is the gap two
     * admins opening the same screen walk through.
     */
    answers = {
      payout_destinations: [
        { data: null, error: { message: "the first-payout confirmation is already recorded" } },
      ],
    };

    const { confirmFirstPayout } = await import("@/lib/data/payout-destinations");
    expect(
      await confirmFirstPayout({ destinationId: "d", adminId: ADMIN }),
    ).toEqual({ ok: false, reason: "alreadyConfirmed" });
  });

  it("records who confirmed it, not just that somebody did", async () => {
    answers = { payout_destinations: [{ data: { id: "d" }, error: null }] };
    const { confirmFirstPayout } = await import("@/lib/data/payout-destinations");

    expect(await confirmFirstPayout({ destinationId: "d", adminId: ADMIN })).toEqual({
      ok: true,
    });

    const write = of("payout_destinations").find((o) => o.op === "update")!;
    expect(write.payload!.first_payout_confirmed_by).toBe(ADMIN);
    expect(write.payload!.first_payout_confirmed_at).toBeTruthy();
  });
});

describe("the queue a person watches", () => {
  /*
   * WHY THIS QUEUE EXISTS AT ALL. A professional whose payout account changes is
   * meant to be told, so that if it was not them they can object inside the
   * window. The notice has no delivery channel — the in-app row has no address
   * and there is no SMS channel — so the only reader it can reach is whoever
   * holds the session, which in a takeover is the attacker. A person seeing
   * these rows is the whole control until a code can be sent.
   *
   * SO THE TWO EXCLUSIONS ARE THE POINT, not tidiness. A row past its cooldown
   * is no longer a window anybody can act in, and a FIRST destination has nobody
   * to warn — including either would bury the rows that matter under every
   * professional we approve.
   */
  async function count(
    cooling: Array<{ provider_id: string }>,
    retired: Array<{ provider_id: string }>,
  ) {
    answers = {
      payout_destinations: [
        { data: cooling, error: null },
        { data: retired, error: null },
      ],
    };
    const { destinationsInCooldownCount } = await import(
      "@/lib/data/payout-destinations"
    );
    return destinationsInCooldownCount(new Date("2026-10-01T12:00:00Z"));
  }

  it("counts a changed destination that is still cooling", async () => {
    expect(await count([{ provider_id: KRISHNA_LISTING }], [{ provider_id: KRISHNA_LISTING }])).toBe(1);
  });

  it("does not count a first destination, because nobody is being redirected", async () => {
    // Cooling, but nothing retired behind it — so there is no earlier account
    // and nobody who could be surprised by this one.
    expect(await count([{ provider_id: KRISHNA_LISTING }], [])).toBe(0);
  });

  it("only looks at rows still inside the window", async () => {
    /*
     * Asserted on the FILTER rather than on a count, because a row past its
     * cooldown never comes back from the query at all — and a test that fed it
     * one anyway would be proving something the database does, not something
     * this function does.
     */
    await count([], []);
    const read = of("payout_destinations")[0];
    expect(read.filters).toContainEqual(["retired_at", null]);
    expect(
      read.filters.some(([column]) => column === "usable_from"),
      "the read did not bound the cooling window",
    ).toBe(true);
  });

  it("reads a failed count as unreadable, never as nothing waiting", async () => {
    /*
     * The rule the whole admin index follows, and here the zero would be "no
     * accounts are being redirected" — good news nobody measured, on the one
     * card built to notice a theft.
     */
    answers = {
      payout_destinations: [{ data: null, error: { message: "down" } }],
    };
    const { destinationsInCooldownCount } = await import(
      "@/lib/data/payout-destinations"
    );
    expect(await destinationsInCooldownCount()).toBeNull();
  });
});
