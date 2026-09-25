import { describe, expect, it, vi } from "vitest";

/**
 * The enrolment call carries an issuer.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. Supabase answered
 * "500 Error generating QR Code", which is GoTrue failing to build the
 * `otpauth://` URI behind the QR image. That URI needs an issuer and a label,
 * and the label is normally the user's EMAIL — which is null on every account
 * this product will ever have, because phone + OTP is the only way in. The
 * issuer is the one half we can supply, and it was never being passed.
 *
 * The failure itself lives inside Supabase and cannot be raised from here, so
 * this pins the contract rather than the outcome: whatever else changes about
 * enrolment, the call goes out with an issuer on it.
 */

const enroll = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      mfa: {
        listFactors: async () => ({ data: { totp: [] }, error: null }),
        enroll,
        unenroll: async () => ({ error: null }),
      },
    },
  }),
}));

describe("TOTP enrolment names who is issuing the factor", () => {
  it("sends an issuer, so the otpauth URI is not built from an empty email", async () => {
    enroll.mockResolvedValue({
      data: { id: "f1", totp: { qr_code: "data:,", secret: "ABC" } },
      error: null,
    });

    const { enrollTotp } = await import("@/lib/auth/mfa");
    await enrollTotp("Authenticator");

    expect(enroll).toHaveBeenCalledTimes(1);
    const params = enroll.mock.calls[0][0] as Record<string, unknown>;
    expect(params.factorType).toBe("totp");
    expect(typeof params.issuer).toBe("string");
    expect((params.issuer as string).length).toBeGreaterThan(0);
  });
});
