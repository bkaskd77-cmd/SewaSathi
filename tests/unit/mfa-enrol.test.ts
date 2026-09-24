import { describe, expect, it } from "vitest";

import { describeEnrollError } from "@/lib/auth/mfa-error";

/**
 * Why an enrolment failed, kept rather than thrown away.
 *
 * `enrollTotp` collapsed every failure to the key `enrollFailed`, so the
 * screen could only ever say "That did not start. Try again." — and when it
 * did start failing in production, nobody could say why. That is the same
 * failure the SMS outage produced and the reason `?debug=auth` exists on the
 * login screen: the product HAD the provider's message the whole time and
 * showed none of it.
 *
 * Two halves, the split `lib/auth/otp-contract.ts` already makes: `reason` is
 * the key the customer-facing copy reads, `detail` is the engineer-facing
 * sentence behind a debug flag.
 */

describe("an enrolment failure keeps the provider's own words", () => {
  it("carries the message and the status", () => {
    expect(
      describeEnrollError({ message: "friendly name is invalid", status: 422 }),
    ).toBe("422 friendly name is invalid");
  });

  it("copes with a status nobody sent", () => {
    expect(describeEnrollError({ message: "something broke" })).toBe(
      "something broke",
    );
  });

  it("names the shape when the provider said nothing at all", () => {
    // Null would render as an empty badge, which reads as "no error" on the
    // screen that exists to explain one.
    expect(describeEnrollError(null)).toBe("no error returned");
    expect(describeEnrollError({})).toBe("no error returned");
  });

  it("does not let a thrown object become the string [object Object]", () => {
    expect(describeEnrollError(new Error("network down"))).toBe("network down");
  });
});
