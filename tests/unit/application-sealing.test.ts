import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one-shot that converts what was already written.
 *
 * TWO GUARANTEES, AND NEITHER IS ABOUT THE CIPHER. A pass over live rows holding
 * somebody's bank account gets exactly two promises: it changes nothing until it
 * is armed, and running it twice is not two conversions. Both are asserted by
 * counting what the client was ASKED to do, because a sweep that reports
 * plausible numbers while writing nothing — or writing twice — looks identical
 * from its return value.
 */

type Op = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
};

let ops: Op[] = [];
let rows: Record<string, unknown[]> = {};

class Fake {
  private readonly entry: Op;

  constructor(table: string) {
    this.entry = { table, op: "select" };
    ops.push(this.entry);
  }

  select() { return this; }
  eq() { return this; }
  not() { return this; }
  insert(payload: unknown) { this.entry.op = "insert"; this.entry.payload = payload; return this; }
  update(payload: unknown) { this.entry.op = "update"; this.entry.payload = payload; return this; }
  upsert(payload: unknown) { this.entry.op = "upsert"; this.entry.payload = payload; return this; }
  delete() { this.entry.op = "delete"; return this; }

  then<T>(resolve: (value: { data: unknown; error: null }) => T) {
    const data = this.entry.op === "select" ? (rows[this.entry.table] ?? []) : [];
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}

const client = { from: (table: string) => new Fake(table) };

vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

const KEY = Buffer.alloc(32, 17).toString("base64");
const ACCOUNT = "9841234567";

function application(payoutAccount: string | null) {
  return {
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    payout_account: payoutAccount,
    citizenship_number: "12-34-56-78901",
    pan_number: null,
    full_name: "Krishna Tamang",
    service_areas: ["ktm-baneshwor"],
    device_fingerprint: null,
  };
}

function writes(table: string) {
  return ops.filter((o) => o.table === table && o.op !== "select");
}

beforeEach(() => {
  ops = [];
  rows = {};
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.PAYOUT_ENCRYPTION_KEY = KEY;
});

describe("the conversion sweep", () => {
  it("changes nothing on a dry run, and still counts what it found", async () => {
    /*
     * The `/api/retention/sweep` shape: the only safe way to evaluate a pass over
     * live rows is to count them before changing any. A dry run that quietly
     * wrote would be the worst possible version of this endpoint, so the
     * assertion is on the absence of writes rather than on the report.
     */
    rows = { provider_applications: [application(ACCOUNT)] };
    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");

    const report = await sweepApplicationSealing({ armed: false });

    expect(report.armed).toBe(false);
    expect(report.accounts).toMatchObject({ withValue: 1, plaintext: 1, sealed: 0 });
    expect(report.remainingPlaintext).toBe(1);
    expect(writes("provider_applications"), "a dry run wrote a row").toEqual([]);
    expect(writes("application_match_keys"), "a dry run wrote keys").toEqual([]);
  });

  it("seals a plaintext row when armed, and stores an envelope", async () => {
    rows = { provider_applications: [application(ACCOUNT)] };
    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");
    const { isSealed } = await import("@/lib/security/secret-box");

    const report = await sweepApplicationSealing({ armed: true });

    const written = writes("provider_applications");
    expect(written).toHaveLength(1);
    const stored = (written[0].payload as { payout_account: string }).payout_account;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(ACCOUNT);
    expect(report.remainingPlaintext).toBe(0);
  });

  it("does not re-seal a row that is already sealed", async () => {
    /*
     * IDEMPOTENT BY READING THE DATA, not by a flag column or a date somebody
     * has to keep correct — so "has this been done" has one answer and a second
     * run after a partial failure finishes the job instead of double-sealing what
     * succeeded. Re-sealing would also be silent: it round-trips perfectly.
     */
    const { sealSecret } = await import("@/lib/security/secret-box");
    rows = { provider_applications: [application(sealSecret(ACCOUNT))] };

    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");
    const report = await sweepApplicationSealing({ armed: true });

    expect(report.accounts).toMatchObject({ withValue: 1, plaintext: 0, sealed: 0 });
    expect(writes("provider_applications")).toEqual([]);
  });

  it("re-keys the digests even for a row that needed no sealing", async () => {
    /*
     * THE TWO REPAIRS ARE INDEPENDENT, which is why this case exists. A row
     * sealed on the way in by the current code still carries match keys written
     * under the old unkeyed SHA-256 — dead keys, and a dead key is
     * indistinguishable from a value nobody shares.
     */
    const { sealSecret } = await import("@/lib/security/secret-box");
    rows = { provider_applications: [application(sealSecret(ACCOUNT))] };

    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");
    const report = await sweepApplicationSealing({ armed: true });

    expect(report.keys.applications).toBe(1);
    expect(writes("application_match_keys").map((o) => o.op)).toEqual([
      // Written first, removed second — never a window with no keys at all.
      "upsert",
      "delete",
    ]);
  });

  it("digests the number, not the envelope", async () => {
    /*
     * The trap, asserted through the sweep as well as through the reader: the
     * keys this pass writes must be the ones a fresh submission of the same
     * number would produce, or the conversion replaces dead keys with different
     * dead keys.
     */
    const { sealSecret } = await import("@/lib/security/secret-box");
    rows = { provider_applications: [application(sealSecret(ACCOUNT))] };

    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");
    await sweepApplicationSealing({ armed: true });

    const upserted = writes("application_match_keys").find((o) => o.op === "upsert");
    const keys = upserted!.payload as Array<{ kind: string; key_hash: string }>;
    const account = keys.find((key) => key.kind === "account")!;

    const { hashMatchKey } = await import("@/lib/data/verification");
    const { accountKey } = await import("@/lib/verification/match-keys");
    expect(account.key_hash).toBe(hashMatchKey("account", accountKey(ACCOUNT)));
  });

  it("reports a row it cannot open rather than sealing the envelope again", async () => {
    /*
     * A value that will not open means the key changed without a re-seal. Sealing
     * it a second time would make an unopenable value permanently unopenable and
     * report success — so it is counted as a failure and left alone.
     */
    const { sealSecret } = await import("@/lib/security/secret-box");
    const sealed = sealSecret(ACCOUNT);
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 88).toString("base64");
    rows = { provider_applications: [application(sealed)] };

    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");
    const report = await sweepApplicationSealing({ armed: true });

    expect(report.accounts.failed).toBe(1);
    expect(writes("provider_applications")).toEqual([]);
  });

  it("records that it ran, because a correct dry run writes nothing else", async () => {
    /*
     * `cron_runs`' lesson one table over: a pass that found nothing to convert
     * and a pass nobody ever invoked leave byte-identical traces in the data.
     * The counts go in the audit row, so "we ran it and it was already done" is
     * answerable later without anybody having kept the response.
     */
    rows = { provider_applications: [application(ACCOUNT)] };
    const { sweepApplicationSealing } = await import("@/lib/data/application-sealing");
    await sweepApplicationSealing({ armed: false });

    const logged = ops.filter((o) => o.table === "security_events" && o.op === "insert");
    expect(logged).toHaveLength(1);
    const detail = (logged[0].payload as { detail: Record<string, unknown> }).detail;
    expect(detail.action).toBe("application.sealing.sweep");
    expect(detail.armed).toBe(false);
    expect(detail).toHaveProperty("remainingPlaintext", 1);
  });
});
