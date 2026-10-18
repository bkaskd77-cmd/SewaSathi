import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WAKES_A_PHONE, WORTH_AN_SMS } from "@/lib/notify";

/**
 * A suspension does not end at the suspension.
 *
 * WHAT THESE CASES ARE ABOUT. Raising a step stops NEW work — the open pool
 * closes, the listing goes, the payout waits — and does nothing to a job
 * already accepted. Without the in-flight list a suspension leaves customers
 * waiting at home for somebody who is never coming, and without the notice the
 * suspended person finds no explanation anywhere in the product. Both halves
 * are easy to leave out and neither fails loudly.
 */

const sources = {
  writers: readFileSync("lib/data/enforcement.ts", "utf8"),
  panel: readFileSync("components/admin/enforcement-panel.tsx", "utf8"),
  notice: readFileSync("components/shared/suspension-notice.tsx", "utf8"),
  providerJobs: readFileSync(
    "app/[locale]/(work)/provider/jobs/page.tsx",
    "utf8",
  ),
  bookings: readFileSync("app/[locale]/(app)/bookings/page.tsx", "utf8"),
  account: readFileSync("app/[locale]/(app)/account/page.tsx", "utf8"),
  providerPayouts: readFileSync(
    "app/[locale]/(work)/provider/payouts/page.tsx",
    "utf8",
  ),
  enforcementScreen: readFileSync(
    "app/[locale]/(admin)/admin/enforcement/page.tsx",
    "utf8",
  ),
  lookupScreen: readFileSync(
    "app/[locale]/(admin)/admin/lookup/page.tsx",
    "utf8",
  ),
};

/*
 * THE WIRING, WHICH IS THE HALF NOTHING ASSERTED.
 *
 * The cases below this block covered the writers, the copy and the notification
 * kinds — everything except whether the in-flight list is actually ON the screen
 * where somebody suspends an account, on BOTH sides. That is the half that is
 * easy to leave at one caller: `inFlightBookings` takes
 * `{ providerId } | { customerId }`, so a professional's jobs and a customer's
 * upcoming bookings are one function and two call sites, and shipping one of
 * them leaves the other looking done from the data layer.
 *
 * It is source text rather than a render, which is the honest limit: both pages
 * are async Server Components reading through the service role, so there is no
 * seam to render them without a database. What regresses is a call site being
 * dropped or a prop going unpassed, and that is visible here.
 */
describe("a suspension shows the jobs already in flight, on both sides", () => {
  it("reads all four screens it reasons about", () => {
    /* The guard that stops every assertion below passing over an empty string,
       which is how a moved file reads as a clean result. */
    for (const [name, text] of Object.entries(sources)) {
      expect(text.length, name).toBeGreaterThan(500);
    }
  });

  it("lists a professional's open jobs in the same action that suspends them", () => {
    const text = sources.enforcementScreen;
    expect(text).toContain("inFlightBookings({ providerId:");
    expect(text).toContain("InFlightJobs");
    /* Inside the panel rather than beside it: `EnforcementPanel` takes the list
       as a slot so the service-role read stays on the server. A list rendered
       below the panel would be a second place to look while deciding. */
    expect(text).toContain("inFlight=");
  });

  it("lists a customer's upcoming bookings the same way", () => {
    const text = sources.lookupScreen;
    expect(text).toContain("inFlightBookings({");
    expect(text).toContain("customerId:");
    expect(text).toContain("CustomerSuspension");
    expect(text).toContain("InFlightJobs");
  });

  it("offers both outcomes on both screens, never only one", () => {
    /*
     * REASSIGN OR CANCEL, and a screen carrying one of them is the failure
     * worth naming: release-only leaves a job nobody can end, and cancel-only
     * makes "somebody else is coming" impossible, so the admin cancels a job
     * the customer still needs — which is the bug `isRelease` was written for,
     * one layer up.
     */
    for (const text of [sources.enforcementScreen, sources.lookupScreen]) {
      expect(text).toContain("releaseAction=");
      expect(text).toContain("cancelAction=");
    }
  });

  it("shows a customer's bookings only once a decision has been taken", () => {
    /* Not a browse of somebody's calendar. The list is gated on the account
       actually being suspended, so an ordinary lookup does not print it. */
    expect(sources.lookupScreen).toContain("result.risk.banned ? (");
  });

  it("says it could not read them rather than saying there are none", () => {
    /* Rule 6 on the one screen where the absence does real damage: "no open
       jobs" over a failed read is how a customer is left waiting at home. */
    expect(sources.panel).toContain("rows === null");
    expect(sources.panel).toContain("jobsUnreadable");
    expect(sources.panel).toContain("rows.length === 0");
    expect(sources.panel).toContain("noJobs");
  });
});

describe("the customer is told, and told the truth", () => {
  /*
   * ITS OWN KIND, AND THE SMALL LIE AVOIDED. A released job and a declined one
   * look identical to the customer — their professional is gone and the job is
   * open again — but `booking.declined` says "your professional withdrew",
   * which on this path is not what happened. A product that says it is teaching
   * the customer something false about a person it has stopped working with.
   */
  it("uses its own notification kind rather than borrowing declined", () => {
    expect(sources.writers).toContain("booking.providerUnavailable");
    expect(sources.writers).not.toContain('kind: "booking.declined"');
  });

  it("wakes a phone, and is worth an SMS", () => {
    /*
     * WORTH PAYING FOR because the customer is otherwise waiting at home for
     * somebody who is not coming — and because WE caused it. A notification we
     * are the reason for is not one to leave to whether they open the app.
     */
    expect(WAKES_A_PHONE).toContain("booking.providerUnavailable");
    expect(WORTH_AN_SMS).toContain("booking.providerUnavailable");
  });

  it("tells the customer on both outcomes, not just the release", () => {
    const cancel = sources.writers.slice(
      sources.writers.indexOf("export async function cancelSuspendedBooking"),
    );
    expect(cancel).toContain("await notify(");
    expect(cancel).toContain("booking.cancelled");
  });
});

describe("no fee reaches a customer for our decision", () => {
  /*
   * ZERO BY POLICY RATHER THAN BY THIS WRITER'S CHOICE — `judgeCancellation`
   * returns zero for every window because our money moves after the work. On
   * this path charging anything would be charging somebody for a suspension
   * they had no part in, so the figure is written explicitly rather than left
   * to a column default that a later migration could move.
   */
  it("writes the cancellation fee as zero explicitly", () => {
    expect(sources.writers).toContain("cancellation_fee: 0");
  });
});

describe("a job somebody is standing in is not a button", () => {
  /*
   * The status machine allows `accepted -> pending` and `en_route -> pending`
   * and deliberately not `in_progress`: somebody is in the customer's house
   * with the floor up. It is still LISTED, because the job a screen hides is
   * the one nobody deals with.
   */
  it("refuses to release an in-progress job", () => {
    expect(sources.writers).toContain(
      'if (booking.status === "in_progress") return { ok: false, reason: "inProgress" };',
    );
  });

  it("still lists it, and says to ring instead", () => {
    expect(sources.panel).toContain("inProgressRing");
    expect(sources.writers).toContain('releasable: row.status !== "in_progress"');
  });

  /*
   * THE GUARDED UPDATE IS THE REAL PROTECTION. The status read and the write
   * are two statements, so the check above is a sentence for the screen and
   * this is the rule — a job that started in between updates nothing.
   */
  it("guards the write on the statuses it judged", () => {
    expect(sources.writers).toContain(
      '.in("status", ["pending", "accepted", "en_route"])',
    );
  });
});

describe("the suspended person is told what changed", () => {
  it("offers WhatsApp first and never a dead link", () => {
    expect(sources.notice).toContain("site.supportWhatsapp");
    // Null when nothing is configured — then the phone number alone, because a
    // dead escape hatch on this screen reads as contempt.
    expect(sources.notice).toContain("? whatsappHref(");
    expect(sources.notice).toContain("supportPhoneDisplay ?");
  });

  it("renders on the screens each audience actually opens", () => {
    /*
     * FOUR SCREENS, NOT TWO. `/bookings` and `/provider/jobs` shipped first and
     * were the obvious ones; the two added after are where somebody goes to ask
     * WHY. `/account` is the page headed with a customer's own details, so
     * somebody who cannot book looks there rather than at a booking list; and
     * `/provider/payouts` is where step 4 actually bites, since it holds
     * earnings — a balance that will not move with no explanation anywhere is
     * how a working process comes to feel arbitrary.
     */
    const forProvider = [sources.providerJobs, sources.providerPayouts];
    const forCustomer = [sources.bookings, sources.account];

    for (const text of forProvider) {
      expect(text).toContain("SuspensionNotice");
      expect(text).toContain('audience="provider"');
    }
    for (const text of forCustomer) {
      expect(text).toContain("SuspensionNotice");
      expect(text).toContain('audience="customer"');
    }
  });

  /*
   * A FAILED READ SHOWS NO NOTICE, which is the opposite of the booking gate
   * and deliberately so. There, failing open lets somebody past a control;
   * here, failing closed would put a suspension notice in front of somebody who
   * is not suspended.
   */
  it("does not accuse somebody because a read failed", () => {
    expect(sources.providerJobs).toContain("standing?.step != null");
    expect(sources.providerPayouts).toContain("standing?.step != null");
    expect(sources.bookings).toContain("standing?.suspended");
    expect(sources.account).toContain("standing?.suspended");
  });
});
