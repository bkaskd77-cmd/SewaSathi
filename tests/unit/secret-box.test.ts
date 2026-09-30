import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isSealed,
  openSecret,
  sealSecret,
  sealingIsConfigured,
  sealingStatus,
  secretDigest,
} from "@/lib/security/secret-box";

/**
 * Sealing account numbers, and the rules that matter more than the cipher.
 *
 * The algorithm is `node:crypto`'s and is not what this file tests. What it
 * tests is the arrangement around it: that a missing key refuses rather than
 * degrades, that the ciphertext does not contain the plaintext, and that a
 * failure to open never hands back the envelope.
 */

const KEY = Buffer.alloc(32, 7).toString("base64");
const ACCOUNT = "9779841234567";

let original: string | undefined;

beforeEach(() => {
  original = process.env.PAYOUT_ENCRYPTION_KEY;
  process.env.PAYOUT_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  if (original === undefined) delete process.env.PAYOUT_ENCRYPTION_KEY;
  else process.env.PAYOUT_ENCRYPTION_KEY = original;
});

describe("sealing and opening", () => {
  it("round-trips a value", () => {
    expect(openSecret(sealSecret(ACCOUNT))).toBe(ACCOUNT);
  });

  it("does not contain the plaintext anywhere in the envelope", () => {
    /*
     * THE ASSERTION THAT CATCHES AN ACCIDENTAL IDENTITY FUNCTION. A round-trip
     * passes perfectly against `seal = (x) => x`, which is exactly the shape a
     * hurried refactor or a caught-and-swallowed error produces. This is the
     * case that would go red.
     *
     * Checked in base64 as well, because a value that is merely encoded rather
     * than encrypted would pass the naive check and fail this one.
     */
    const sealed = sealSecret(ACCOUNT);
    expect(sealed).not.toContain(ACCOUNT);
    expect(sealed).not.toContain(Buffer.from(ACCOUNT).toString("base64"));
    expect(Buffer.from(sealed).toString("hex")).not.toContain(
      Buffer.from(ACCOUNT).toString("hex"),
    );
  });

  it("gives a different envelope every time for the same number", () => {
    /*
     * A random IV. Identical ciphertexts would reveal which professionals share
     * an account without opening anything — a real leak from a database nobody
     * decrypted. Nothing queries by account number, so determinism buys us
     * nothing to trade for it.
     */
    expect(sealSecret(ACCOUNT)).not.toBe(sealSecret(ACCOUNT));
    // ...and both still open to the same value.
    expect(openSecret(sealSecret(ACCOUNT))).toBe(
      openSecret(sealSecret(ACCOUNT)),
    );
  });

  it("refuses a tampered ciphertext rather than opening it to something else", () => {
    // GCM authenticates. This is why it was chosen over CBC: a flipped bit is
    // a refusal, not a different number.
    const sealed = sealSecret(ACCOUNT);
    const parts = sealed.split(".");
    const bytes = Buffer.from(parts[2], "base64");
    bytes[0] ^= 0xff;
    parts[2] = bytes.toString("base64");

    expect(() => openSecret(parts.join("."))).toThrow();
  });

  it("refuses a bare number instead of returning it", () => {
    /*
     * Never hand back the input. An envelope on screen where an account number
     * belongs reads as a rendering bug and sends somebody looking in the wrong
     * place; a plaintext number arriving here means something wrote past the
     * check constraint, which is worth an exception.
     */
    expect(() => openSecret(ACCOUNT)).toThrow(/Not a sealed value/);
    expect(() => openSecret("")).toThrow(/Not a sealed value/);
  });

  it("recognises its own envelopes and nothing else", () => {
    // The database's check constraint enforces this same shape, so the two
    // must agree about what sealed looks like.
    expect(isSealed(sealSecret(ACCOUNT))).toBe(true);
    expect(isSealed(ACCOUNT)).toBe(false);
    expect(isSealed("v1.only.three")).toBe(false);
    expect(isSealed("v2.a.b.c")).toBe(false);
  });
});

describe("a missing or wrong key", () => {
  it("throws on write rather than storing plaintext", () => {
    /*
     * THE RULE THIS FILE EXISTS FOR, and it is the opposite of the triage
     * fallback. There, a missing key must never reach the customer as an error.
     * Here, "keep working" would mean writing a bank account in the clear —
     * worse than a refused form, and invisible.
     */
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    expect(() => sealSecret(ACCOUNT)).toThrow(/PAYOUT_ENCRYPTION_KEY is not set/);
    expect(sealingIsConfigured()).toBe(false);
  });

  it("reports the length rather than a bare false", () => {
    /*
     * Three answers, not two. A boolean collapses "nobody configured this" into
     * "somebody configured this wrongly", and those need different sentences on
     * /api/health — one is a task, the other is a bug somebody has already
     * made and cannot see.
     */
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    expect(sealingStatus()).toEqual({ ok: false, reason: "unset", length: 0 });

    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(24, 1).toString("base64");
    expect(sealingStatus()).toEqual({
      ok: false,
      reason: "badLength",
      length: 24,
    });

    process.env.PAYOUT_ENCRYPTION_KEY = KEY;
    expect(sealingStatus()).toEqual({ ok: true });
  });

  it("treats a whitespace-only key as unset, not as a bad length", () => {
    // A variable set to a space is somebody who cleared it, not somebody who
    // pasted the wrong thing. Base64-decoding "  " gives zero bytes, which
    // would otherwise report as `badLength: 0` and send them looking for a
    // truncated paste that does not exist.
    process.env.PAYOUT_ENCRYPTION_KEY = "   ";
    expect(sealingStatus()).toEqual({ ok: false, reason: "unset", length: 0 });
  });

  it("names the variable when the key is the wrong length", () => {
    // Not a weaker cipher — a configuration error, and the message says which
    // variable to fix and how to generate one.
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => sealSecret(ACCOUNT)).toThrow(/must be 32 bytes/);
    expect(() => sealSecret(ACCOUNT)).toThrow(/openssl rand -base64 32/);
  });

  it("cannot open with a different key", () => {
    const sealed = sealSecret(ACCOUNT);
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => openSecret(sealed)).toThrow();
  });
});

describe("the keyed digest", () => {
  it("is stable for the same value and differs across kinds", () => {
    // Equality is what duplicate detection needs; the kind is in the digest so
    // a document number cannot collide with an account that is the same digits.
    expect(secretDigest("account", ACCOUNT)).toBe(secretDigest("account", ACCOUNT));
    expect(secretDigest("account", ACCOUNT)).not.toBe(
      secretDigest("document", ACCOUNT),
    );
  });

  it("stays 64 hex characters, which the column still checks", () => {
    expect(secretDigest("account", ACCOUNT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is not the unkeyed SHA-256 it replaced", () => {
    /*
     * THE WHOLE POINT. A bare sha256 of a short numeric account number is
     * enumerable from a backup in seconds, which would undo the encryption one
     * table over. This asserts the digest actually depends on the key.
     */
    const withOneKey = secretDigest("account", ACCOUNT);
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(secretDigest("account", ACCOUNT)).not.toBe(withOneKey);
  });
});
