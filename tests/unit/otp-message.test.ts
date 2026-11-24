import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { messageParts, otpMessage } from "@/lib/sms";

/**
 * The sign-in code SMS: one credit, code first, our name, and "never share it"
 * in both languages.
 *
 * THE LENGTH IS ASSERTED TWICE, AND THE SECOND ONE IS THE ONE THAT MATTERS.
 * `messageParts` is our own counter; asserting only that would let a counter
 * bug and a too-long message agree with each other. The independent half is the
 * gateway's own published rule — "Nepali: 1 SMS Credit = 70 characters", from
 * Aakash's quotation — applied to the raw length.
 *
 * AT EVERY CODE LENGTH SUPABASE CAN ISSUE (6 to 10 digits), because the length
 * is a project setting in somebody else's dashboard: moving it from 6 to 10 adds
 * four characters to every message, and this is where that has to fail.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const LENGTHS = [6, 7, 8, 9, 10];
const codeOf = (n: number) => "9".repeat(n);

describe("the sign-in code message", () => {
  it("costs one credit at every code length Supabase allows", () => {
    for (const n of LENGTHS) {
      const text = otpMessage(codeOf(n));
      expect(DEVANAGARI.test(text), "the message is Unicode, so the 70 rule applies").toBe(
        true,
      );
      expect(text.length, `${n}-digit code: ${text.length} characters`).toBeLessThanOrEqual(70);
      expect(messageParts(text), `${n}-digit code`).toBe(1);
    }
  });

  it("leads with the code, which is what a lock screen shows", () => {
    expect(otpMessage("482913").startsWith("482913")).toBe(true);
  });

  it("names us, because on a shared sender the body is the only place we appear", () => {
    expect(otpMessage("482913")).toContain("SajiloKaam");
  });

  it("warns against sharing the code in both languages", () => {
    /*
     * The common OTP scam is a phone call asking for a real code, not a forged
     * message — so the warning is the part that protects anybody, and it is in
     * both languages because the person on that call may read only one.
     * Asserted by script and meaning rather than exact wording, so a native
     * reader can improve the Nepali without breaking this.
     */
    const text = otpMessage("482913");
    const [, afterCode] = text.split("482913");
    expect(afterCode).toMatch(/never share/i);
    expect(DEVANAGARI.test(afterCode)).toBe(true);
  });

  it("is the message the hook actually sends", () => {
    /* The wiring, not the function: a route that went back to an inline
       string would pass every case above while sending something else. */
    const route = readFileSync("app/api/sms/send/route.ts", "utf8");
    expect(route).toContain("text: otpMessage(otp)");
    expect(route).not.toMatch(/text:\s*`/);
  });

  it("puts its Nepali in front of the native reader", async () => {
    const { PROSE_DOCUMENTS, isBlockingTier } = await import(
      "../../scripts/ne-review-scope.mjs"
    );
    const entry = PROSE_DOCUMENTS.find(
      (d: { path: string }) => d.path === "lib/sms/otp-message.ts",
    );
    expect(entry, "listed for the native read").toBeTruthy();
    /* An absent entry reads as tier "" — not blocking — so it fails here too. */
    expect(isBlockingTier(entry?.tier ?? ""), "and blocking a launch until read").toBe(true);
  });
});
