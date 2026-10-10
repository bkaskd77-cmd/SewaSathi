import { describe, expect, it } from "vitest";

import { STEP_UP_HOURS, stepUpBlocks, stepUpFor } from "@/lib/auth/step-up";

/**
 * Every admin surface is behind the gate, and the gate means a second factor.
 *
 * WHY AN INVERSE CHECK RATHER THAN CARE. All ten admin action files call `adminActor()`
 * and all twenty-one admin pages call `adminGate()` — today. The eleventh is the one
 * that matters: a server action is a public POST reachable by anybody who can reach the
 * page, so an admin action that forgets the gate is not a weaker screen, it is an open
 * endpoint. Nothing in the repository would have said so. The same shape as
 * `guard-clauses.test.ts`'s inverse check and `write-grants.test.ts`'s seventh table.
 *
 * READ FROM THE SOURCE, which is the honest limit of what this proves: that the gate is
 * CALLED, not that its answer is respected. A file could call `adminActor()` and ignore
 * the null. That is a thinner claim than it sounds like a test should make, and it is
 * the one worth having — the failure that has actually happened in products like this is
 * somebody adding a file and not thinking about auth at all, not somebody deliberately
 * discarding the result.
 */

/** Pages that must NOT be gated, each with the reason it is an exception. */
const UNGATED_PAGES: Record<string, string> = {
  "app/[locale]/(admin)/admin/login/page.tsx":
    "The sign-in screen. Gating it would send an admin who is not signed in to the screen they cannot reach, which is a loop rather than a guard.",
};

describe("every admin action re-reads the session", () => {
  it("calls adminActor, in every actions file under (admin)", async () => {
    const files = await adminFiles("actions.ts");
    expect(files.length, "no admin action files found — the glob is wrong").toBeGreaterThan(5);

    const missing: string[] = [];
    for (const file of files) {
      if (!(await read(file)).includes("adminActor")) missing.push(file);
    }
    expect(
      missing,
      `these are public POST endpoints with no role check: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("every admin page is behind the gate", () => {
  it("calls adminGate, or is a named exception", async () => {
    const files = await adminFiles("page.tsx");
    expect(files.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const file of files) {
      if (file in UNGATED_PAGES) continue;
      if (!(await read(file)).includes("adminGate")) missing.push(file);
    }
    expect(missing, `ungated admin screens: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists nothing as an exception that is actually gated", async () => {
    /* The inverse, so the exception list cannot describe a past version of the tree:
       a page that gained a gate should lose its excuse. */
    for (const file of Object.keys(UNGATED_PAGES)) {
      const source = await read(file).catch(() => null);
      expect(source, `${file} is listed as ungated and does not exist`).not.toBeNull();
      expect(source ?? "", `${file} is gated now — remove its exception`).not.toContain(
        "adminGate",
      );
    }
  });
});

describe("what the gate actually requires of an admin", () => {
  const base = { role: "admin" as const, now: new Date("2026-10-10T09:00:00Z") };

  it("blocks an admin with no authenticator, by sending them to enrol", () => {
    const verdict = stepUpFor({ ...base, hasFactor: false, verified: false, verifiedAt: null });
    expect(verdict).toBe("enrol");
    expect(stepUpBlocks(verdict)).toBe(true);
  });

  it("blocks one who has an authenticator and has not used it this session", () => {
    const verdict = stepUpFor({ ...base, hasFactor: true, verified: false, verifiedAt: null });
    expect(stepUpBlocks(verdict)).toBe(true);
  });

  it("blocks one whose proof has gone stale", () => {
    const stale = new Date(base.now.getTime() - (STEP_UP_HOURS + 1) * 3_600_000);
    expect(
      stepUpBlocks(stepUpFor({ ...base, hasFactor: true, verified: true, verifiedAt: stale })),
    ).toBe(true);
  });

  it("lets one through who proved it inside the window", () => {
    const fresh = new Date(base.now.getTime() - 60_000);
    expect(stepUpFor({ ...base, hasFactor: true, verified: true, verifiedAt: fresh })).toBe("ok");
  });

  it("asks nothing of a customer or a professional", () => {
    for (const role of ["customer", "provider"] as const) {
      expect(
        stepUpFor({ ...base, role, hasFactor: false, verified: false, verifiedAt: null }),
      ).toBe("not-required");
    }
  });
});

async function adminFiles(name: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const root = "app/[locale]/(admin)";
  const out: string[] = [];

  async function walk(dir: string) {
    for (const entry of await readdir(new URL(`../../${dir}/`, import.meta.url), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) await walk(`${dir}/${entry.name}`);
      else if (entry.name === name) out.push(`${dir}/${entry.name}`);
    }
  }

  await walk(root);
  return out.sort();
}

async function read(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}
