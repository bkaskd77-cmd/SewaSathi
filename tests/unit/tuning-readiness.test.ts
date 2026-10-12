import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readyLoops, type LoopReadiness } from "@/lib/data/tuning-readiness";

/**
 * One readiness computation, two surfaces.
 *
 * THE FRONT PAGE AND THE SIGNALS SCREEN MUST NOT DISAGREE. One says "ready to
 * tune" and the other says how far off; computed separately they would drift,
 * which is exactly how `countsAsEvidence` came to be written twice for a commit
 * and why `lib/provider/measured.ts` exists at all. A front page claiming ready
 * over a screen reading "four short" is worse than neither.
 */
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("ready is a verdict the callers are handed, never one they form", () => {
  const rows: LoopReadiness[] = [
    { loop: "ranking", state: { ready: true, have: 22, floor: 20, short: 0 } },
    { loop: "rotation", state: { ready: false, have: 2, floor: 5, short: 3 } },
    { loop: "triage", state: null },
  ];

  it("names only the loops at or past their floor", () => {
    expect(readyLoops(rows)).toEqual(["ranking"]);
  });

  it("never calls a failed read ready", () => {
    /*
     * THE MOST EXPENSIVE VERSION OF RULE 6 IN THIS PRODUCT. A broken count
     * putting "ready to tune" on the admin front page is an invitation to move
     * published copy on no data at all — strictly worse than the screen saying
     * nothing.
     */
    expect(readyLoops([{ loop: "triage", state: null }])).toEqual([]);
  });

  it("is empty rather than absent when nothing is ready", () => {
    // The front page renders on a list, so "nothing ready" has to be a list.
    expect(readyLoops([rows[1]])).toEqual([]);
  });
});

describe("both surfaces read the one module", () => {
  it("has the admin home asking for readiness rather than counting", () => {
    const home = read("app/[locale]/(admin)/admin/page.tsx");
    expect(home).toContain("tuningReadiness");
    expect(home).toContain("readyLoops");
    // It must not reach for the raw inputs: a front page that read
    // `weightEvidence` itself is a second opinion waiting to drift.
    expect(home).not.toContain("weightEvidence");
    expect(home).not.toContain("listConcentration");
  });

  it("has the signals screen asking the same module", () => {
    const signals = read("app/[locale]/(admin)/admin/signals/page.tsx");
    expect(signals).toContain("tuningReadiness");
    // `weightEvidence` stays on this screen — it renders the per-weight table,
    // which is a different question from readiness and the reason that table
    // exists. What it must not do is recompute the VERDICT.
    expect(signals).not.toContain("rotationOfferFloor(");
  });

  it("keeps the notice silent until something is ready", () => {
    /*
     * A permanent "0 of 3 ready" is true every day for a year and therefore
     * stops being read — `ACTIVITY_FLOOR`'s reasoning, which renders nothing
     * rather than an empty strip.
     */
    const home = read("app/[locale]/(admin)/admin/page.tsx");
    expect(home).toContain("ready.length > 0");
  });
});
