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
};

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
    expect(sources.providerJobs).toContain("SuspensionNotice");
    expect(sources.providerJobs).toContain('audience="provider"');
    expect(sources.bookings).toContain("SuspensionNotice");
    expect(sources.bookings).toContain('audience="customer"');
  });

  /*
   * A FAILED READ SHOWS NO NOTICE, which is the opposite of the booking gate
   * and deliberately so. There, failing open lets somebody past a control;
   * here, failing closed would put a suspension notice in front of somebody who
   * is not suspended.
   */
  it("does not accuse somebody because a read failed", () => {
    expect(sources.providerJobs).toContain("standing?.step != null");
    expect(sources.bookings).toContain("standing?.suspended");
  });
});
