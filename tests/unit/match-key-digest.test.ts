import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountKey } from "@/lib/verification/match-keys";

/**
 * What those keys are STORED as, which is a different question from what they
 * are.
 *
 * `tests/unit/match-keys.test.ts` proves the same human being written twice
 * produces the same key. This file proves the digest that key is stored under
 * does not undo that — and that it depends on `PAYOUT_ENCRYPTION_KEY`.
 *
 * ITS OWN FILE because reaching `hashMatchKey` means importing
 * `lib/data/verification.ts`, which pulls the audit module and React's `cache`
 * behind it. The key tests above are pure string functions and should not have a
 * module mock hanging over them.
 */

/* `cache()` is React's per-request memo and there is no request here. */
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

let original: string | undefined;

beforeEach(() => {
  original = process.env.PAYOUT_ENCRYPTION_KEY;
});

afterEach(() => {
  if (original === undefined) delete process.env.PAYOUT_ENCRYPTION_KEY;
  else process.env.PAYOUT_ENCRYPTION_KEY = original;
});

describe("the keyed digest", () => {
  /*
   * WHY THIS IS HERE AND NOT ONLY IN `secret-box.test.ts`. That file proves
   * `secretDigest` is keyed. What it cannot prove is that the application path
   * USES it — `hashMatchKey` was a bare SHA-256 under a comment reading "Never
   * the value itself", which is true and not sufficient: every value fed to it
   * is a short string from a small space (a bank account, a wallet number, a
   * citizenship number, a phone number), so a backup holder enumerates it and
   * matches the digest in seconds. Sealing `account_ref` while leaving that one
   * table over is a lock on one door of two.
   *
   * The pair that matters is both halves at once: the digest must still be exact
   * -match equal for the same person written twice — that is the whole duplicate
   * mechanism above — AND it must depend on the key.
   */
  const KEY_A = Buffer.alloc(32, 11).toString("base64");
  const KEY_B = Buffer.alloc(32, 22).toString("base64");

  async function digest(kind: string, value: string, key: string) {
    process.env.PAYOUT_ENCRYPTION_KEY = key;
    const { hashMatchKey } = await import("@/lib/data/verification");
    return hashMatchKey(kind as never, value);
  }

  it("still matches the same account written two ways", async () => {
    /*
     * The mechanism this is protecting: a removed provider re-applying with the
     * same bank account. `accountKey` folds the spelling; the digest must not
     * unfold it. If this breaks, duplicate detection dies with no error
     * anywhere — a product that looks like it is checking and is not.
     */
    const first = accountKey("98-4123-4567");
    const second = accountKey("९८४१२३४५६७");
    expect(first).toBe(second);

    expect(await digest("account", first, KEY_A)).toBe(
      await digest("account", second, KEY_A),
    );
  });

  it("depends on the key, which is the whole change", async () => {
    const value = accountKey("9841234567");
    expect(await digest("account", value, KEY_A)).not.toBe(
      await digest("account", value, KEY_B),
    );
  });

  it("keeps the kind in the digest, so two identical numbers stay two facts", async () => {
    // "1234567890" as a citizenship number and as an eSewa account must not be
    // the same row, or a reviewer is shown a duplicate that is not one.
    expect(await digest("document", "1234567890", KEY_A)).not.toBe(
      await digest("account", "1234567890", KEY_A),
    );
  });

  it("is still 64 hex characters, which the column checks", async () => {
    expect(await digest("account", "9841234567", KEY_A)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses rather than falling back to the enumerable form", async () => {
    /*
     * A silent fallback here would be the unkeyed digest reintroduced on a
     * product that reports itself healthy — the `no-api-key` lesson, applied
     * where the cost is a duplicate check that quietly stops checking.
     * `sealApplication` turns this into a refused submission, which is visible
     * and can be retried.
     */
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    const { hashMatchKey } = await import("@/lib/data/verification");
    expect(() => hashMatchKey("account", "9841234567")).toThrow(
      /PAYOUT_ENCRYPTION_KEY/,
    );
  });
});
