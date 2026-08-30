import { describe, expect, it } from "vitest";

import {
  BOOKING_PROGRESS,
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  canTransition,
  customerCanCancel,
  isTerminal,
  progressIndex,
  type BookingStatus,
} from "@/lib/booking";

/**
 * The status machine.
 *
 * These test the contract — which moves are legal — not how the table is
 * written. The same rules are enforced in Postgres by a trigger, and
 * tests/db/booking-rls.test.ts proves the database agrees; this file is the
 * half the interface reads when it decides whether to show a cancel button.
 */

describe("legal transitions", () => {
  it("does not let a booking jump from pending to completed", () => {
    expect(canTransition("pending", "completed")).toBe(false);
  });

  it("does not let a booking skip en_route to reach in_progress", () => {
    expect(canTransition("accepted", "in_progress")).toBe(false);
  });

  it("walks the happy path one step at a time", () => {
    const path: BookingStatus[] = [
      "pending",
      "accepted",
      "en_route",
      "in_progress",
      "completed",
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("allows cancelling from every stage before completion", () => {
    for (const from of ["pending", "accepted", "en_route", "in_progress"] as const) {
      expect(canTransition(from, "cancelled")).toBe(true);
    }
  });

  it("only reaches no_provider_found from pending", () => {
    expect(canTransition("pending", "no_provider_found")).toBe(true);
    for (const from of ["accepted", "en_route", "in_progress"] as const) {
      expect(canTransition(from, "no_provider_found")).toBe(false);
    }
  });

  it("treats completed, cancelled and no_provider_found as final", () => {
    for (const status of ["completed", "cancelled", "no_provider_found"] as const) {
      expect(isTerminal(status)).toBe(true);
      for (const to of BOOKING_STATUSES) {
        expect(canTransition(status, to)).toBe(false);
      }
    }
  });

  it("never lets a booking move to itself", () => {
    for (const status of BOOKING_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("only names statuses that exist", () => {
    for (const [from, targets] of Object.entries(BOOKING_TRANSITIONS)) {
      expect(BOOKING_STATUSES).toContain(from as BookingStatus);
      for (const to of targets) expect(BOOKING_STATUSES).toContain(to);
    }
  });
});

describe("what a customer may do", () => {
  it("lets them cancel while nobody has set off", () => {
    expect(customerCanCancel("pending")).toBe(true);
    expect(customerCanCancel("accepted")).toBe(true);
  });

  it("stops them cancelling once the professional is on the way", () => {
    // They have already spent the trip. This goes through support instead,
    // and the RLS policy enforces the same window.
    for (const status of ["en_route", "in_progress", "completed"] as const) {
      expect(customerCanCancel(status)).toBe(false);
    }
  });
});

describe("the progress track", () => {
  it("leaves out the endings, which are not stages", () => {
    // Drawing "cancelled" as a step implies the job is still travelling
    // towards something.
    expect(BOOKING_PROGRESS).not.toContain("cancelled");
    expect(BOOKING_PROGRESS).not.toContain("no_provider_found");
  });

  it("orders the stages as the job actually moves", () => {
    expect(progressIndex("pending")).toBe(0);
    expect(progressIndex("completed")).toBe(BOOKING_PROGRESS.length - 1);
    expect(progressIndex("accepted")).toBeLessThan(progressIndex("en_route"));
  });
});
