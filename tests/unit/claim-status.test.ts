import { describe, expect, it } from "vitest";

import {
  canTransitionClaim,
  CLAIM_FIRST_REFUSAL_MINUTES,
  claimOpenToAll,
  CLAIM_STATUSES,
  CLAIM_TRANSITIONS,
  countsAgainstLimit,
  isClaimClosed,
  isClaimStatus,
  type ClaimStatus,
} from "@/lib/booking";
import { claimOutcome, CLAIM_VERDICTS } from "@/lib/config/guarantee";

/**
 * The claim machine, and one property worth more than the rest of the file:
 * `resolved` is reachable only from `attended`.
 *
 * That edge is the anti-farming design. Every cheap version of a guarantee has
 * a path to the expensive half that skips the visit, and a path like that is a
 * repeatable route to free work for anybody willing to describe a different
 * problem each time. It is asserted here and again in `tests/db` against the
 * SQL, because the interface is the half that can be bypassed.
 */

describe("the only route to resolved is through attended", () => {
  it("lets nothing but attended resolve", () => {
    const canResolve = CLAIM_STATUSES.filter((from) =>
      canTransitionClaim(from, "resolved"),
    );
    expect(canResolve).toEqual(["attended"]);
  });

  it("gives attended no other move at all", () => {
    expect(CLAIM_TRANSITIONS.attended).toEqual(["resolved"]);
  });

  /*
   * Support may close a claim before anybody goes. It may not overrule
   * somebody who was in the room: once there is a verdict, the verdict decides,
   * or the visit was theatre.
   */
  it("lets support reject before a visit and never after one", () => {
    expect(canTransitionClaim("open", "rejected")).toBe(true);
    expect(canTransitionClaim("dispatched", "rejected")).toBe(true);
    expect(canTransitionClaim("attended", "rejected")).toBe(false);
  });
});

describe("the rest of the machine", () => {
  it("has three terminal states and they go nowhere", () => {
    const terminal = CLAIM_STATUSES.filter(isClaimClosed);
    expect(terminal).toEqual(["resolved", "withdrawn", "rejected"]);
    for (const status of terminal) {
      for (const to of CLAIM_STATUSES) {
        expect(canTransitionClaim(status, to)).toBe(false);
      }
    }
  });

  it("lets a dispatched claim go back to open and never the other way round", () => {
    expect(canTransitionClaim("dispatched", "open")).toBe(true);
    expect(canTransitionClaim("attended", "open")).toBe(false);
  });

  it("lets a customer withdraw at every live stage before a visit", () => {
    expect(canTransitionClaim("open", "withdrawn")).toBe(true);
    expect(canTransitionClaim("dispatched", "withdrawn")).toBe(true);
  });

  it("recognises exactly the six statuses", () => {
    for (const status of CLAIM_STATUSES) expect(isClaimStatus(status)).toBe(true);
    expect(isClaimStatus("closed")).toBe(false);
    expect(isClaimStatus("")).toBe(false);
  });

  it("names no target that is not a status", () => {
    for (const targets of Object.values(CLAIM_TRANSITIONS)) {
      for (const target of targets) {
        expect(CLAIM_STATUSES).toContain(target);
      }
    }
  });
});

describe("what counts against the two-per-booking limit", () => {
  /**
   * A withdrawn claim does not. Somebody who raised one and then found the
   * real cause themselves has done us a favour, and spending one of their two
   * on it teaches the opposite lesson.
   */
  it("spares a withdrawal and counts everything else", () => {
    expect(countsAgainstLimit("withdrawn")).toBe(false);
    for (const status of CLAIM_STATUSES.filter((s) => s !== "withdrawn")) {
      expect(countsAgainstLimit(status as ClaimStatus)).toBe(true);
    }
  });
});

describe("no verdict produces a refund on its own", () => {
  it("leaves every outcome needing a person", () => {
    for (const verdict of CLAIM_VERDICTS) {
      expect(claimOutcome(verdict).refund).toBe("person");
    }
  });

  it("bills only the same fault to the professional", () => {
    expect(claimOutcome("sameFault").payer).toBe("provider");
    expect(claimOutcome("differentProblem").payer).toBe("customer");
    expect(claimOutcome("nothingWrong").payer).toBe("customer");
    expect(claimOutcome("customerCaused").payer).toBe("customer");
  });
});

describe("a claim nobody will attend still reaches somebody", () => {
  const base = {
    status: "open" as const,
    attendingProviderId: null,
    openedAt: new Date("2026-09-13T10:00:00Z"),
  };
  const at = (minutes: number) =>
    new Date(base.openedAt.getTime() + minutes * 60_000);

  it("holds it for the professional whose job it was, at first", () => {
    // Their work and their obligation, and the ledger only charges a redo debt
    // when somebody ELSE goes — so them returning is cheapest for everybody.
    expect(claimOpenToAll(base, at(5))).toBe(false);
    expect(claimOpenToAll(base, at(CLAIM_FIRST_REFUSAL_MINUTES - 1))).toBe(false);
  });

  it("opens it to the trade once the window passes", () => {
    // Before this the claim simply sat: `acceptClaim` admitted nobody else and
    // RLS showed it to nobody else. /legal/refunds promised a visit anyway.
    expect(claimOpenToAll(base, at(CLAIM_FIRST_REFUSAL_MINUTES))).toBe(true);
    expect(claimOpenToAll(base, at(600))).toBe(true);
  });

  it("opens it immediately when the visit is handed back", () => {
    // A hand-back is an answer, not silence. There is no window left to serve.
    expect(
      claimOpenToAll({ ...base, releasedAt: at(3) }, at(4)),
    ).toBe(true);
  });

  it("never opens one somebody is already holding", () => {
    expect(
      claimOpenToAll({ ...base, attendingProviderId: "p1" }, at(600)),
    ).toBe(false);
  });

  it("never opens a claim that is not open", () => {
    for (const status of ["dispatched", "attended", "resolved", "withdrawn", "rejected"] as const) {
      expect(claimOpenToAll({ ...base, status }, at(600))).toBe(false);
    }
  });
});
