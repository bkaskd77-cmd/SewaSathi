import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The revert has a caller, and a screen, and the loop reads it.
 *
 * THIS REPOSITORY'S MOST EXPENSIVE RECURRING MISTAKE IS A RULE WITH NO CALLER.
 * `applyRedoRecovery` was written, tested and documented in three places for
 * four phases with nothing invoking it, so a professional's debt only ever went
 * up. `proposeBand` went four more. `booking_refusals.reason_code` shipped one
 * commit before anything wrote to it. Every one of them had passing unit tests
 * of the rule itself, which is exactly why a unit test of the rule is not the
 * check that catches this.
 *
 * So the chain is asserted at its ENDS rather than link by link — the lesson
 * from `bookings.triage_log_id`, where every individual link existed (a column,
 * a zod field, a flow slot, an insert, a page reading the query string) and the
 * chain was open because `logTriage` returned void. A per-link test would have
 * passed throughout.
 *
 * Reading source rather than importing, because the action is `"use server"`
 * and the data layer is `server-only`: importing either into a unit test
 * exercises the module loader, not the wiring.
 */

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const ACTION = "app/[locale]/(admin)/admin/duration/actions.ts";
const PAGE = "app/[locale]/(admin)/admin/duration/page.tsx";
const PANEL = "components/admin/duration-revert.tsx";
const LOOP = "lib/data/duration-loop.ts";

describe("a person can actually reach the revert", () => {
  it("has a server action that calls the data layer", () => {
    const action = read(ACTION);
    expect(action).toContain("revertDuration");
    expect(action).toMatch(/from "@\/lib\/data\/duration-loop"/);
  });

  it("takes the actor from the session and never from the form", () => {
    /*
     * The hole found three times in this product, always the same shape: an id
     * arrived from the browser and nothing asked whose it was. The append-only
     * row names an actor, so a form-supplied one would be a signed record of a
     * decision somebody else made.
     */
    const action = read(ACTION);
    expect(action).toContain("adminActor()");
    expect(action).toContain("actorId: profile.id");
    expect(action).not.toMatch(/actorId:\s*field\(/);
  });

  it("writes the audit row only after the revert succeeded", () => {
    const action = read(ACTION);
    const guard = action.indexOf("if (result.ok)");
    // The CALL, not the import — which is where this assertion first pointed,
    // and an import sits at the top of every file, so it compared the guard
    // against line 3 and failed for a reason that said nothing about ordering.
    const audit = action.indexOf("await recordSecurityEvent(");
    expect(guard).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(guard);
    expect(action).toContain('kind: "duration.reverted"');
  });

  it("renders the control on the screen, wired to that action", () => {
    const page = read(PAGE);
    expect(page).toContain("revertDurationAction");
    expect(page).toContain("DurationRevert");
    // Only on a figure the loop published. An `invented` or `researched` number
    // is the seed's and has nothing recorded to go back to.
    expect(page).toContain('view.source === "observed"');
  });

  it("offers no field for a duration, only a reason", () => {
    /*
     * THE ONE THING THAT WOULD TURN A REVERT INTO A SECOND WAY TO PUBLISH AN
     * UNMEASURED NUMBER. The figure comes off the promotion's own observation
     * row; a box here would be `duration_source = 'invented'` with extra steps,
     * which is what the whole loop exists to get away from.
     */
    const panel = read(PANEL);
    const names = [...panel.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual([
      "bandSlug",
      "categorySlug",
      "kind",
      "reason",
    ]);
  });

  it("makes the sweep read the reverts, so a suppression is not advisory", () => {
    /*
     * THE END OF THE CHAIN THAT MATTERS MOST. A revert that the nightly sweep
     * does not read is a figure put back for one day: the sample has not
     * changed, the median is the same number, and the loop republishes it.
     */
    const loop = read(LOOP);
    expect(loop).toContain("latestReverts");
    // Threaded into the rule rather than checked beside it, so the screen and
    // the sweep cannot disagree about whether a figure is held.
    expect(loop).toMatch(/revert: reverts\.get\(/);
    // A failed read stops the sweep rather than reading as "nothing reverted".
    expect(loop).toContain('skipped: "revertsUnreadable"');
  });
});
