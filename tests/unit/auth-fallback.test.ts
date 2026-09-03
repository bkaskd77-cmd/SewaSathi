import { describe, expect, it } from "vitest";

import { strandsCustomer } from "@/lib/auth/otp";

/**
 * When the login screen offers a phone number instead of a retry.
 *
 * This exists because sign-in went down in production — Supabase's SMS
 * credentials were placeholders, every send failed, and the product's entire
 * response was a red sentence. The customer's only remaining option was to
 * leave. Phone OTP is the only way into this product, so that is not one
 * feature failing, it is all of them.
 *
 * The rule has to cut both ways and the test says so: a fault the person can
 * fix by typing again must NOT send them to the phone, because teaching people
 * that a mistyped digit means "ring support" is how a working product comes to
 * feel broken.
 */

describe("a failure the customer cannot fix offers them a phone", () => {
  it("strands them when the gateway will not send", () => {
    // The exact production failure: Twilio 20003, classified as smsFailed.
    expect(strandsCustomer("smsFailed")).toBe(true);
  });

  it("strands them on an unrecognised provider error", () => {
    // Unknown means we do not know that retrying helps, and the cost of
    // wrongly offering a phone number is far lower than the cost of a dead end.
    expect(strandsCustomer("generic")).toBe(true);
  });
});

describe("a failure the customer can fix does not", () => {
  it("does not strand them on a wrong or stale code", () => {
    expect(strandsCustomer("codeInvalid")).toBe(false);
    expect(strandsCustomer("codeExpired")).toBe(false);
    expect(strandsCustomer("codeExpiredOrInvalid")).toBe(false);
  });

  it("does not strand them on a rate limit, which resolves on its own", () => {
    // The form already tells them how many seconds to wait.
    expect(strandsCustomer("tooManyRequests")).toBe(false);
  });

  it("does not strand them when they simply need a new code", () => {
    expect(strandsCustomer("requestNewCode")).toBe(false);
  });
});
