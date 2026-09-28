import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Approving somebody goes through the audited funnel, not a bare update.
 *
 * WHY A UNIT TEST WHEN THE TRIGGER ALREADY GUARANTEES THE ROW.
 * `profiles_record_role_change` writes a `role.changed` event on every path, so
 * a plain `.update({ role })` here would still be recorded — as
 * `via: 'service-role'`, which says our own server did it and nothing about why
 * or on whose say-so. The whole reason the September elevations were
 * unanswerable is that nobody could tell an approval from somebody running SQL.
 *
 * So the database guarantees that SOMETHING is recorded, and this guarantees
 * that the approval path says what it is. `tests/db/role-change-audit.test.ts`
 * would stay green through a revert to `.update()`, which is exactly the kind of
 * silent loss this project keeps finding a year later.
 *
 * THE CLIENT IS A STUB, per `tests/unit/personal-reads.test.ts`: it answers
 * enough for the approval to reach the role write and records the RPC.
 */

type RpcCall = { name: string; args: Record<string, unknown> };

const rpcCalls: RpcCall[] = [];
const updated: Array<{ table: string; values: Record<string, unknown> }> = [];

const APPLICATION = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const APPLICANT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ADMIN = "cccccccc-3333-4333-8333-cccccccccccc";

/** What each table answers when the approval reads it. */
const ROWS: Record<string, unknown> = {
  provider_applications: {
    id: APPLICATION,
    profile_id: APPLICANT,
    status: "submitted",
    risk_score: 10,
    full_name: "Bina Tamang",
    trades: ["plumbing"],
    service_areas: ["lalitpur-4"],
    years_experience: 4,
  },
  profiles: { role: "customer" },
  providers: { id: "dddddddd-4444-4444-8444-dddddddddddd" },
};

class Query {
  constructor(private readonly table: string) {}

  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  insert() {
    return this;
  }
  update(values: Record<string, unknown>) {
    updated.push({ table: this.table, values });
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: ROWS[this.table] ?? null, error: null });
  }
  single() {
    return this.maybeSingle();
  }
  then<T>(resolve: (value: { data: unknown[]; error: null }) => T) {
    // Lists come back empty: no prior rejected applications, so the deletion
    // sweep is a no-op and the path runs straight through.
    return Promise.resolve({ data: [] as unknown[], error: null }).then(resolve);
  }
}

const client = {
  from: (table: string) => new Query(table),
  rpc: (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  },
  storage: { from: () => ({ remove: async () => ({ error: null }) }) },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => true }));
vi.mock("@/lib/audit", () => ({
  recordSecurityEvent: async () => {},
  recordContactAccess: async () => {},
}));
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

import { decideApplication } from "@/lib/data/review";

beforeEach(() => {
  rpcCalls.length = 0;
  updated.length = 0;
});

describe("approving a provider", () => {
  it("changes the role through set_profile_role and never by hand", async () => {
    await decideApplication({
      applicationId: APPLICATION,
      adminId: ADMIN,
      decision: "approved",
      reason: "Documents check out and both references answered.",
    });

    const call = rpcCalls.find((c) => c.name === "set_profile_role");
    expect(call, "the approval did not go through the funnel").toBeDefined();
    expect(call!.args.target).toBe(APPLICANT);
    expect(call!.args.new_role).toBe("provider");

    // A bare update on `profiles` would be recorded by the trigger as
    // `service-role` and lose both of these.
    expect(updated.some((u) => u.table === "profiles")).toBe(false);
  });

  it("names the path and the admin who decided", async () => {
    await decideApplication({
      applicationId: APPLICATION,
      adminId: ADMIN,
      decision: "approved",
      reason: "Documents check out and both references answered.",
    });

    const call = rpcCalls.find((c) => c.name === "set_profile_role")!;
    expect(call.args.via).toBe("application.approved");
    expect(call.args.actor).toBe(ADMIN);
  });

  it("leaves an admin's own role alone", async () => {
    // Promoting an admin to provider would take away their own access, and an
    // admin who is also a professional is a real case.
    ROWS.profiles = { role: "admin" };
    try {
      await decideApplication({
        applicationId: APPLICATION,
        adminId: ADMIN,
        decision: "approved",
        reason: "Documents check out and both references answered.",
      });
      expect(rpcCalls.some((c) => c.name === "set_profile_role")).toBe(false);
    } finally {
      ROWS.profiles = { role: "customer" };
    }
  });

  it("changes no role at all when the decision is a rejection", async () => {
    await decideApplication({
      applicationId: APPLICATION,
      adminId: ADMIN,
      decision: "rejected",
      reason: "Citizenship document is not legible.",
    });

    expect(rpcCalls.some((c) => c.name === "set_profile_role")).toBe(false);
  });
});
