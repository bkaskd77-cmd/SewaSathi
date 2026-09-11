import { describe, expect, it } from "vitest";

import { messageParts, toGatewayNumber } from "@/lib/sms";

/**
 * The two pieces of arithmetic between us and a message that is charged for
 * and never arrives.
 *
 * Both are small enough to look obviously right and both have a failure mode
 * with no error anywhere: a number the gateway accepts and cannot route, and a
 * cost estimate that is half the real bill because Devanagari is UCS-2.
 */

describe("toGatewayNumber", () => {
  it("strips the country code Supabase stores", () => {
    // THE ONE THAT MATTERS. Supabase hands us E.164; both Nepali gateways want
    // ten national digits. A surviving +977 is accepted by the gateway and
    // never delivered, which is silent in every log we have.
    expect(toGatewayNumber("+9779843119897")).toBe("9843119897");
    expect(toGatewayNumber("9779843119897")).toBe("9843119897");
  });

  it("accepts a number already in national form", () => {
    expect(toGatewayNumber("9843119897")).toBe("9843119897");
  });

  it("survives the ways a person writes a number", () => {
    for (const written of ["+977 9843 119 897", "977-9843-119-897"]) {
      expect(toGatewayNumber(written)).toBe("9843119897");
    }
  });

  it("refuses a landline rather than paying to text it", () => {
    // Kathmandu landlines start 01 and cannot receive SMS at all.
    expect(toGatewayNumber("+97714112233")).toBeNull();
  });

  it("refuses anything that is not ten digits", () => {
    expect(toGatewayNumber("+977984311989")).toBeNull();
    expect(toGatewayNumber("+97798431198977")).toBeNull();
    expect(toGatewayNumber("")).toBeNull();
  });

  it("returns null rather than a best guess", () => {
    // Sending to a number we could not parse is worse than not sending: it
    // costs money and reaches somebody else.
    expect(toGatewayNumber("not a number")).toBeNull();
  });
});

describe("messageParts", () => {
  it("counts a short English code as one message", () => {
    expect(messageParts("123456 is your SajiloKaam code.")).toBe(1);
  });

  it("counts Devanagari against the UCS-2 limit, not the GSM one", () => {
    // 80 Devanagari characters fit comfortably in GSM-7's 160 and not at all
    // in UCS-2's 70. Getting this wrong halves every cost estimate for the
    // half of our customers reading Nepali.
    const nepali = "सजिलो".repeat(16); // 80 characters
    expect(nepali.length).toBe(80);
    expect(messageParts(nepali)).toBe(2);
  });

  it("splits long English at the concatenation limit", () => {
    expect(messageParts("a".repeat(160))).toBe(1);
    expect(messageParts("a".repeat(161))).toBe(2);
    expect(messageParts("a".repeat(306))).toBe(2);
    expect(messageParts("a".repeat(307))).toBe(3);
  });

  it("treats the bilingual code we actually send as one message", () => {
    // The real body is mixed-script, so it is UCS-2 and has 70 characters to
    // live in. If this ever tips to 2 the sign-in cost doubles overnight, so
    // the assertion is on the message we ship rather than on a sample.
    const otp = "123456";
    const text = `${otp} is your SajiloKaam code. सजिलो काम कोड: ${otp}`;
    expect(text.length).toBeLessThanOrEqual(70);
    expect(messageParts(text)).toBe(1);
  });
});
