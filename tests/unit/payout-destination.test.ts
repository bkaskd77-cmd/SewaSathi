import { describe, expect, it } from "vitest";

import { DESTINATION_COOLDOWN_HOURS } from "@/lib/config/payout-policy";
import {
  destinationReadiness,
  destinationUsableFrom,
  maskAccountRef,
} from "@/lib/payments/destination";

const HOUR = 60 * 60 * 1000;

describe("how much of an account number a screen may show", () => {
  it("never prints the whole reference, whatever its length", () => {
    /*
     * The one rule this file exists for. Asserted over lengths rather than one
     * example, because the interesting failure is a boundary — a reference just
     * long enough to reveal a tail that happens to be most of it.
     */
    for (const ref of [
      "1",
      "12345",
      "1234567",
      "12345678",
      "9876543210",
      "00112233445566778899",
    ]) {
      const masked = maskAccountRef(ref);
      expect(masked, `${ref} was shown whole`).not.toBe(ref);
      expect(masked).not.toContain(ref);
    }
  });

  it("masks a short reference entirely rather than revealing most of it", () => {
    // Four of six digits is not a hint, it is the account.
    expect(maskAccountRef("123456")).toBe("••••••••");
    expect(maskAccountRef("1234567")).toBe("••••••••");
  });

  it("reveals only the last four once a reference is long enough", () => {
    expect(maskAccountRef("12345678")).toBe("••••5678");
    expect(maskAccountRef("9779841234567")).toBe("••••4567");
  });

  it("does not leak the length through the mask", () => {
    /*
     * A dot per hidden character would narrow which bank an account belongs to.
     * Two references of very different lengths must mask to the same width.
     */
    const short = maskAccountRef("12345678");
    const long = maskAccountRef("00112233445566778899");
    expect(short.length).toBe(long.length);
  });

  it("survives whitespace and an empty value without throwing", () => {
    expect(maskAccountRef("  12345678  ")).toBe("••••5678");
    expect(maskAccountRef("")).toBe("••••••••");
  });
});

describe("when a new destination may receive money", () => {
  it("stamps the cooldown forward from creation", () => {
    const created = new Date("2026-09-30T08:00:00Z");
    expect(destinationUsableFrom(created).toISOString()).toBe(
      new Date(created.getTime() + DESTINATION_COOLDOWN_HOURS * HOUR).toISOString(),
    );
  });

  it("refuses inside the window and says when that ends", () => {
    /*
     * The takeover window. Asserted through the returned date rather than the
     * constant alone, because what the professional needs is "wait until
     * Thursday", not "wait 72 hours from a moment they cannot see".
     */
    const created = new Date("2026-09-30T08:00:00Z");
    const usableFrom = destinationUsableFrom(created);

    const result = destinationReadiness(
      { retiredAt: null, usableFrom, firstPayoutConfirmedAt: new Date() },
      new Date(created.getTime() + HOUR),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cooling");
      expect(result.usableFrom?.toISOString()).toBe(usableFrom.toISOString());
    }
  });

  it("refuses a retired destination before anything else", () => {
    // Retired outranks both other refusals: money must never follow a
    // superseded address, even one that is past its cooldown and confirmed.
    const past = new Date("2026-09-01T00:00:00Z");
    const result = destinationReadiness(
      {
        retiredAt: new Date("2026-09-20T00:00:00Z"),
        usableFrom: past,
        firstPayoutConfirmedAt: past,
      },
      new Date("2026-09-30T00:00:00Z"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("retired");
  });

  it("reports unconfirmed rather than cooling once the window has passed", () => {
    /*
     * THE TWO ARE DIFFERENT ADVICE. A destination can be live, past its
     * cooldown and still waiting for a person to look at the first payout.
     * Calling that "cooling" would tell the professional to wait for a date
     * that is already behind them, which reads as the product being broken.
     */
    const created = new Date("2026-09-01T00:00:00Z");
    const result = destinationReadiness(
      {
        retiredAt: null,
        usableFrom: destinationUsableFrom(created),
        firstPayoutConfirmedAt: null,
      },
      new Date("2026-09-30T00:00:00Z"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unconfirmed");
  });

  it("allows one that is live, cooled and confirmed", () => {
    const created = new Date("2026-09-01T00:00:00Z");
    expect(
      destinationReadiness(
        {
          retiredAt: null,
          usableFrom: destinationUsableFrom(created),
          firstPayoutConfirmedAt: new Date("2026-09-05T00:00:00Z"),
        },
        new Date("2026-09-30T00:00:00Z"),
      ).ok,
    ).toBe(true);
  });
});
