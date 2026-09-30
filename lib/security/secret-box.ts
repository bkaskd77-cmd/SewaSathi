import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

/**
 * Sealing a value so a leaked database backup exposes nothing.
 *
 * WHAT THIS IS FOR. `payout_destinations.account_ref` and
 * `provider_applications.payout_account` hold bank account and wallet numbers.
 * Row-level security decides who may read them *through the database*; it says
 * nothing about a dump, a replica, a support export or a stolen backup. The key
 * lives in `PAYOUT_ENCRYPTION_KEY` — a Vercel environment variable, outside the
 * database — so possessing the data is not possessing the numbers.
 *
 * AES-256-GCM, which authenticates as well as encrypts: a tampered ciphertext
 * fails to open rather than decrypting to something else. `node:crypto`, the
 * dependency `lib/payments/esewa.ts` already pulls in.
 *
 * THE ENVELOPE CARRIES ITS KEY VERSION — `v1.iv.ciphertext.tag`. Rotation is the
 * predictable next requirement and a version added later cannot be applied to
 * rows already written, so it is here from the first row. It is read on every
 * open, not stored in a column nothing consults.
 *
 * A RANDOM IV PER ROW, so the same account number sealed twice produces
 * different ciphertext. Nothing queries by account number — matching is the
 * digest below — so there is no reason to accept the leak a deterministic
 * cipher gives: identical ciphertexts would reveal which professionals share an
 * account without opening anything.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * THE KEY IS REQUIRED, AND ITS ABSENCE THROWS.
 *
 * This is deliberately the opposite of the rule the triage path follows. There,
 * a missing `ANTHROPIC_API_KEY` must never reach the customer as an error —
 * the keyword matcher answers and the product keeps working, because a slightly
 * worse answer beats none.
 *
 * Here the equivalent "keep working" is storing somebody's bank account in
 * plaintext, which is worse than the form refusing. A failed write is visible
 * and recoverable; a silently unencrypted account number is neither, and it
 * looks exactly like a working product. So: no fallback, no default key, no
 * "encrypt if configured".
 */
function key(): Buffer {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY ?? "";
  if (raw === "") {
    throw new Error(
      "PAYOUT_ENCRYPTION_KEY is not set. Account numbers are never stored in " +
        "plaintext, so this write cannot proceed.",
    );
  }

  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== KEY_BYTES) {
    /*
     * A SHORT KEY IS A CONFIGURATION ERROR, NOT A WEAKER CIPHER. Node would
     * happily accept a 16-byte key for aes-256 in some arrangements, or throw
     * with a message about key length that reads like a code bug. Checking
     * here names the variable instead, which is the thing somebody has to fix.
     */
    throw new Error(
      `PAYOUT_ENCRYPTION_KEY must be ${KEY_BYTES} bytes base64-encoded; got ` +
        `${bytes.length}. Generate one with: openssl rand -base64 32`,
    );
  }

  return bytes;
}

/** Is the key present and the right shape? For a health check, not a branch. */
export function sealingIsConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** `v1.<iv>.<ciphertext>.<tag>`, base64 parts. */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const sealed = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    sealed.toString("base64"),
    tag.toString("base64"),
  ].join(".");
}

/**
 * The plaintext, or a throw.
 *
 * NEVER RETURNS THE ENVELOPE ON FAILURE. Returning the input when it cannot be
 * opened would put `v1.rT8…` on a screen where an account number belongs, which
 * reads as a rendering bug rather than as a key problem and sends somebody
 * looking in the wrong place for a day.
 */
export function openSecret(envelope: string): string {
  const parts = (envelope ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      "Not a sealed value. Expected v1.<iv>.<ciphertext>.<tag>; a bare number " +
        "here means something wrote plaintext past the check constraint.",
    );
  }

  const [, iv, sealed, tag] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return (
    decipher.update(Buffer.from(sealed, "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}

/** Does this look like something `sealSecret` produced? The constraint's rule. */
export function isSealed(value: string): boolean {
  return /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(
    value ?? "",
  );
}

/**
 * A keyed digest, for matching a value without storing it.
 *
 * WHY THIS REPLACED A BARE SHA-256, which is the finding that widened this
 * work. `application_match_keys.key_hash` was `sha256(kind:value)` under a
 * comment reading "Never the value itself" — true, and not sufficient. A Nepali
 * bank account or wallet number is a short numeric string, so anybody holding a
 * backup can enumerate the space and match the digest in seconds. Encrypting
 * `account_ref` while leaving an unkeyed digest of the same number one table
 * over is a lock on one door.
 *
 * HMAC keeps the property the match table needs — equal values give equal
 * digests, so duplicate detection is exact-match and unchanged — while making
 * the digest useless to somebody without the key.
 *
 * Still hex and still 64 characters, so the existing check constraint holds.
 */
export function secretDigest(kind: string, value: string): string {
  return createHmac("sha256", key()).update(`${kind}:${value}`).digest("hex");
}
