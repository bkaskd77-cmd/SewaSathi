import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authenticator needs a label, and every account here has an empty one.
 *
 * WHAT WENT WRONG, AND IT COST FOUR DEPLOYS. Enrolment answered
 * `500 Error generating QR Code` for every account in the product. GoTrue
 * builds `otpauth://totp/{issuer}:{label}` behind that image and takes the
 * label from `auth.users.email` — which is NULL on every row here and always
 * will be, because phone + OTP is the only way in. Passing `issuer` was half
 * the fix and changed nothing on its own; the label was the empty half.
 *
 * THE LESSON IS BIGGER THAN THE BUG. Before using any provider feature that
 * takes an identity for granted, ask which column it reads. `email` is null on
 * every row in this product.
 *
 * `.invalid` IS RESERVED BY RFC 2606 and can never resolve, so nothing can be
 * delivered to the address even if the Email provider is switched on. It is a
 * label inside a QR code, not a way in: no password exists, no magic link
 * could arrive, and phone + OTP remains the only authentication path.
 */

describe("authenticatorLabel", () => {
  it("leaves a real address alone", async () => {
    const { authenticatorLabel } = await import("@/lib/auth/mfa");
    expect(
      authenticatorLabel({
        id: "u1",
        email: "someone@example.com",
        phone: "9779800000011",
      }),
    ).toBeNull();
  });

  it("builds one from the phone number when there is none", async () => {
    const { authenticatorLabel } = await import("@/lib/auth/mfa");
    expect(
      authenticatorLabel({ id: "u1", email: null, phone: "+977 9800000011" }),
    ).toBe("9779800000011@phone.invalid");
  });

  /*
   * An empty string is what a provider hands back where a column is unset, and
   * GoTrue treats it exactly as it treats null: nothing to put in the label.
   */
  it("treats an empty string as no address", async () => {
    const { authenticatorLabel } = await import("@/lib/auth/mfa");
    expect(
      authenticatorLabel({ id: "u1", email: "", phone: "9779800000011" }),
    ).toBe("9779800000011@phone.invalid");
  });

  /*
   * A provisioned account can exist before anybody has confirmed a number.
   * The id is always there, and a QR that says nothing is still better than a
   * 500 nobody can read.
   */
  it("falls back to the account id when there is no phone either", async () => {
    const { authenticatorLabel } = await import("@/lib/auth/mfa");
    expect(authenticatorLabel({ id: "u1", email: null, phone: null })).toBe(
      "u1@phone.invalid",
    );
  });
});

const enroll = vi.fn();
const getUser = vi.fn();
const updateUserById = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser,
      mfa: {
        listFactors: async () => ({ data: { totp: [] }, error: null }),
        enroll,
        unenroll: async () => ({ error: null }),
      },
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));

beforeEach(() => {
  enroll.mockReset();
  getUser.mockReset();
  updateUserById.mockReset();
  enroll.mockResolvedValue({
    data: { id: "f1", totp: { qr_code: "data:,", secret: "ABC" } },
    error: null,
  });
  updateUserById.mockResolvedValue({ error: null });
});

describe("enrolment fills the label before asking for a QR", () => {
  it("writes a synthetic address when the account has none", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: null, phone: "9779800000011" } },
      error: null,
    });

    const { enrollTotp } = await import("@/lib/auth/mfa");
    const result = await enrollTotp("Authenticator");

    expect(updateUserById).toHaveBeenCalledWith("u1", {
      email: "9779800000011@phone.invalid",
    });
    expect(result.ok).toBe(true);
  });

  it("does not touch an account that already has one", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u1@phone.invalid", phone: "977" } },
      error: null,
    });

    const { enrollTotp } = await import("@/lib/auth/mfa");
    await enrollTotp("Authenticator");

    expect(updateUserById).not.toHaveBeenCalled();
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  /*
   * THE WRITE FAILING MUST NOT SWALLOW THE REASON. "Swallows come in pairs"
   * is in CLAUDE.md because this exact flow had two of them, and a half-opened
   * debug channel reads exactly like a closed one. Enrolment still goes ahead:
   * the label may be the only thing wrong, and the provider's own sentence is
   * a better answer than one we guessed at.
   */
  it("keeps the reason when the address cannot be written", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: null, phone: "9779800000011" } },
      error: null,
    });
    updateUserById.mockResolvedValue({
      error: { message: "email address is already taken", status: 422 },
    });
    enroll.mockResolvedValue({ data: null, error: { message: "500 Error generating QR Code" } });

    const { enrollTotp } = await import("@/lib/auth/mfa");
    const result = await enrollTotp("Authenticator");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("500 Error generating QR Code");
    expect(result.detail).toContain("already taken");
  });
});
