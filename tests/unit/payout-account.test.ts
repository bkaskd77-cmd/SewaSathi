import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountKey } from "@/lib/verification/match-keys";

/**
 * Reading an account number off an application, and the trap underneath it.
 *
 * THE TRAP IS THE REASON THIS FILE EXISTS. `payout_account` is sealed now, and
 * the envelope carries a RANDOM IV — so the same number sealed twice is two
 * different strings. Everything that only ever *stores* the value is fine.
 * `lib/data/verification.ts` does not store it: it digests it into
 * `application_match_keys`, which is how a provider removed for putting a
 * customer at risk is stopped from re-applying with the same bank account.
 *
 * Digest the envelope instead of the number and that check produces a fresh key
 * on every submission, matches nothing, and reports nothing. No failed write, no
 * exception, no log line — a duplicate check that has quietly stopped checking.
 * The first two cases below are that failure and its fix, side by side, because
 * a test that only asserts the fix cannot show that the trap was real.
 */

vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

const KEY = Buffer.alloc(32, 13).toString("base64");
const ACCOUNT = "9841234567";

let original: string | undefined;

beforeEach(() => {
  original = process.env.PAYOUT_ENCRYPTION_KEY;
  process.env.PAYOUT_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  if (original === undefined) delete process.env.PAYOUT_ENCRYPTION_KEY;
  else process.env.PAYOUT_ENCRYPTION_KEY = original;
});

describe("digesting a sealed account number", () => {
  it("gives the same key for two envelopes of the same number", async () => {
    // The property the duplicate check depends on, stated as behaviour rather
    // than as "we remembered to call openSecret".
    const { sealSecret } = await import("@/lib/security/secret-box");
    const { openPayoutAccount } = await import("@/lib/data/payout-account");
    const { hashMatchKey } = await import("@/lib/data/verification");

    const first = sealSecret(ACCOUNT);
    const second = sealSecret(ACCOUNT);
    expect(first).not.toBe(second);

    const digest = (envelope: string) =>
      hashMatchKey("account", accountKey(openPayoutAccount(envelope)!));

    expect(digest(first)).toBe(digest(second));
  });

  it("gives two different keys if the envelope is digested instead", async () => {
    /*
     * THE BUG, DEMONSTRATED. Without this case the one above passes against a
     * deterministic cipher too, and nothing in the suite would show why opening
     * first matters. This is what a forgotten `openPayoutAccount` produces:
     * silently, on every submission.
     */
    const { sealSecret } = await import("@/lib/security/secret-box");
    const { hashMatchKey } = await import("@/lib/data/verification");

    expect(hashMatchKey("account", accountKey(sealSecret(ACCOUNT)))).not.toBe(
      hashMatchKey("account", accountKey(sealSecret(ACCOUNT))),
    );
  });
});

describe("reading the column while it holds two shapes", () => {
  it("returns a legacy plaintext number unchanged", async () => {
    /*
     * Two rows in this table predate the sealing. `openSecret` throws on a bare
     * number by design — it must never hand back its input — so a reader that
     * assumed an envelope would break the review screen for exactly the two
     * applications that matter. The branch goes when the conversion sweep
     * reports 0 and the shape constraint lands.
     */
    const { openPayoutAccount } = await import("@/lib/data/payout-account");
    expect(openPayoutAccount(ACCOUNT)).toBe(ACCOUNT);
  });

  it("opens a sealed one and returns null for nothing", async () => {
    const { sealSecret } = await import("@/lib/security/secret-box");
    const { openPayoutAccount } = await import("@/lib/data/payout-account");

    expect(openPayoutAccount(sealSecret(ACCOUNT))).toBe(ACCOUNT);
    expect(openPayoutAccount(null)).toBeNull();
    expect(openPayoutAccount("")).toBeNull();
  });

  it("returns null rather than throwing when the key will not open it", async () => {
    /*
     * A draft form and a review screen must still render. A value that will not
     * open means the key changed without a re-seal — a deployment fault, which an
     * unrenderable page tells nobody about. The sweep is the caller that logs it,
     * because it is the one in a position to act.
     */
    const { sealSecret } = await import("@/lib/security/secret-box");
    const sealed = sealSecret(ACCOUNT);
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 99).toString("base64");

    const { openPayoutAccount } = await import("@/lib/data/payout-account");
    expect(openPayoutAccount(sealed)).toBeNull();
  });
});

describe("what an admin sees", () => {
  it("masks it, and the digits are not in what comes back", async () => {
    const { sealSecret } = await import("@/lib/security/secret-box");
    const { maskPayoutAccount } = await import("@/lib/data/payout-account");

    const masked = maskPayoutAccount(sealSecret(ACCOUNT));
    expect(masked).toBe("••••4567");
    expect(masked).not.toContain("9841");
  });

  it("masks a legacy plaintext row the same way", async () => {
    // The reviewer's screen must not look different for the two unconverted
    // rows, or the mask reads as a bug on exactly the rows somebody is checking.
    const { maskPayoutAccount } = await import("@/lib/data/payout-account");
    expect(maskPayoutAccount(ACCOUNT)).toBe("••••4567");
  });

  it("is null when there is nothing, never a row of dots", async () => {
    /*
     * An empty field and a hidden value are different facts — rule 6 for a
     * screen. `••••••••` for an applicant who has not answered the payout step
     * tells a reviewer something is there.
     */
    const { maskPayoutAccount } = await import("@/lib/data/payout-account");
    expect(maskPayoutAccount(null)).toBeNull();
  });
});
