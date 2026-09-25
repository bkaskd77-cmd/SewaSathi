import "server-only";

import { describeEnrollError } from "@/lib/auth/mfa-error";
import { site } from "@/lib/config/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The second factor, and the only file that talks to Supabase MFA.
 *
 * THE ADAPTER LAW, for the same reason `lib/auth/otp.ts` exists: nothing else
 * in this product should know which second factor is in play. Today it is
 * TOTP, because it needs no gateway, no per-message cost and no network at the
 * moment of use — which matters in Nepal, where the admin queues may well be
 * worked on a connection that drops. The installed supabase-js also carries a
 * `webauthn` surface; moving to it should be this file and nothing else.
 *
 * WHY ADMINS AND NOT EVERYBODY. A customer's account holds their own bookings
 * and their own address. An admin's holds every customer's phone number, every
 * professional's private number, and every identity document in the product —
 * and `docs/rls-matrix.md` now names those tables one by one. The whole
 * platform's personal data sits behind one SMS code, and an SMS code is the
 * factor most easily taken from somebody: a SIM swap costs a conversation at a
 * counter. Asking a customer for a TOTP code to look at their own tap repair
 * would be security theatre charged to the wrong person.
 *
 * AAL IS READ FROM A VERIFIED TOKEN, NEVER FROM `getSession()`. `getClaims()`
 * verifies the JWT's signature; `getSession()` returns whatever is in the
 * cookie, which on the server is exactly the thing an attacker controls. The
 * distinction is the same one `getSessionProfile` makes by calling `getUser()`
 * rather than trusting a cookie, and getting it wrong here would mean a gate
 * that asks the person being gated whether they passed.
 */

/** What the product needs to know about a session's second factor. */
export type MfaState = {
  /** A TOTP factor this account has enrolled AND verified. */
  hasFactor: boolean;
  /** `aal2` — this session has used it. */
  verified: boolean;
  /** When it was used, from the token's `amr`. Null when it has not been. */
  verifiedAt: Date | null;
};

const UNKNOWN: MfaState = { hasFactor: false, verified: false, verifiedAt: null };

/**
 * Where this session stands, as one object.
 *
 * NEVER THROWS, and returns the CLOSED answer on failure. An error reading the
 * claims must not read as "verified" — that is the `unknown is never ok` rule
 * from `/api/health`, applied to the one place where getting it backwards
 * opens a door rather than hiding one. A caller that cannot tell gets
 * `hasFactor: false`, which prompts enrolment rather than granting access.
 */
export async function mfaState(): Promise<MfaState> {
  try {
    const supabase = createClient();

    const [{ data: claims }, { data: factors }] = await Promise.all([
      supabase.auth.getClaims(),
      supabase.auth.mfa.listFactors(),
    ]);

    const payload = (claims?.claims ?? {}) as {
      aal?: string;
      amr?: Array<{ method?: string; timestamp?: number }>;
    };

    const verified = payload.aal === "aal2";

    /*
     * `amr` is the list of methods this session actually used, each with when.
     * The TOTP entry's timestamp is the moment of verification, which is what
     * the re-challenge window is measured from — not the session's start, and
     * not now.
     */
    const totp = (payload.amr ?? []).find((entry) => entry.method === "totp");
    const verifiedAt =
      verified && typeof totp?.timestamp === "number"
        ? new Date(totp.timestamp * 1000)
        : null;

    const hasFactor = (factors?.totp ?? []).some(
      (factor) => factor.status === "verified",
    );

    return { hasFactor, verified, verifiedAt };
  } catch {
    return UNKNOWN;
  }
}

export type EnrollResult =
  | { ok: true; factorId: string; qr: string; secret: string }
  | {
      ok: false;
      /** The key the customer-facing copy reads. */
      reason: string;
      /**
       * The provider's own sentence, for us.
       *
       * Two halves, the split `lib/auth/otp-contract.ts` already makes. This
       * one used to be discarded, so a failed enrolment could only ever say
       * "That did not start. Try again." — and when it started failing for
       * real, nobody could say why. Shown only in development or behind
       * `?debug=auth`, like every other provider error in this product.
       */
      detail?: string;
    };

/**
 * RFC 2606 reserves `.invalid`, so nothing can ever be delivered to it.
 *
 * That is the whole reason this domain and not a real one. The address is a
 * LABEL INSIDE A QR CODE, never a way in: no password exists on any account
 * here, and a magic link sent to `.invalid` could not arrive even if somebody
 * switched the Email provider on. Phone + OTP remains the only authentication
 * path this product has, in fact and not only in intent.
 */
const LABEL_DOMAIN = "phone.invalid";

/**
 * The address GoTrue needs to put in the authenticator's label, or null.
 *
 * PHONE-ONLY MEANS FIELDS OTHER PRODUCTS RELY ON ARE EMPTY HERE, FOREVER, and
 * this is what that cost. Enrolment answered `500 Error generating QR Code`
 * for every account in the product, through four deploys. GoTrue builds
 * `otpauth://totp/{issuer}:{label}` behind that image and takes the label from
 * `auth.users.email` — null on every row, because phone + OTP is the only way
 * in. Passing `issuer` was half the fix and changed nothing on its own.
 *
 * The lesson is larger than the bug: before using any provider feature that
 * takes an identity for granted, ask which column it reads.
 *
 * Pure, so the rule is testable without a provider. Null means "already has
 * one, leave it alone" — this must never overwrite a real address.
 */
export function authenticatorLabel(user: {
  id: string;
  email?: string | null;
  phone?: string | null;
}): string | null {
  if (user.email && user.email.trim().length > 0) return null;
  // The phone is the thing a person recognises in their authenticator app.
  // Digits only: a `+` or a space in the local part is not a valid address and
  // GoTrue would reject the write, putting us back at the 500 we came from.
  const digits = (user.phone ?? "").replace(/\D/g, "");
  return `${digits || user.id}@${LABEL_DOMAIN}`;
}

/**
 * Give this account a label if it has none. Returns why not, never throws.
 *
 * The write is service-role on purpose: `auth.updateUser({ email })` starts an
 * email-CHANGE flow, which sends a confirmation to an address that by
 * construction cannot receive one and leaves the column unset. This sets it.
 */
async function ensureAuthenticatorLabel(): Promise<string | null> {
  try {
    const { data, error } = await createClient().auth.getUser();
    if (error || !data?.user) return describeEnrollError(error);

    const label = authenticatorLabel(data.user);
    if (!label) return null;

    const { error: writeError } = await createAdminClient().auth.admin.updateUserById(
      data.user.id,
      { email: label },
    );
    return writeError ? describeEnrollError(writeError) : null;
  } catch (thrown) {
    return describeEnrollError(thrown);
  }
}

/**
 * Begin enrolment: a factor, a QR code and the secret behind it.
 *
 * THE SECRET IS SHOWN AS TEXT BESIDE THE QR CODE ON PURPOSE. A reviewer on a
 * desktop with the authenticator on their phone can scan it; one working on
 * the phone itself cannot scan their own screen, and a QR-only enrolment locks
 * that person out of the feature entirely.
 *
 * An unverified factor left behind by an abandoned attempt is cleaned up
 * first. Supabase refuses a second enrolment while one is pending, and a
 * person who closed the tab should not have to ask somebody to unstick them.
 *
 * THE ISSUER IS PASSED EXPLICITLY, AND WITHOUT IT THIS FAILS FOR EVERY USER
 * THIS PRODUCT HAS. Supabase answered `500 Error generating QR Code` — GoTrue
 * failing to build the `otpauth://` URI behind the QR image. That URI is
 * `otpauth://totp/{issuer}:{label}`, and the label is normally the user's
 * EMAIL. Every account here has `email = null`, because phone + OTP is the
 * only way in and always will be, so GoTrue was left deriving the whole URI
 * from a record with nothing on it to use.
 *
 * `site.name` rather than a hostname: the issuer is what an authenticator app
 * prints above the code, so it should be the brand. A hostname would read
 * `sewasathi.vercel.app` today and something else the day the domain moves —
 * and an authenticator entry cannot be renamed after the fact without
 * re-enrolling.
 */
export async function enrollTotp(friendlyName: string): Promise<EnrollResult> {
  /*
   * Before the QR is asked for, not after: the label has to be on the row when
   * GoTrue builds the URI. A failure here is carried rather than thrown —
   * enrolment still goes ahead, because the label may be the only thing wrong
   * and the provider's own sentence about what actually happened is a better
   * answer than one we guessed at.
   */
  const labelProblem = await ensureAuthenticatorLabel();

  try {
    const supabase = createClient();

    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const factor of existing?.totp ?? []) {
      if (factor.status !== "verified") {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName,
      issuer: site.name,
    });

    if (error || !data) {
      return {
        ok: false,
        reason: "enrollFailed",
        detail: withLabelProblem(describeEnrollError(error), labelProblem),
      };
    }

    return {
      ok: true,
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    };
  } catch (thrown) {
    // A throw is as much of an answer as a returned error, and used to be the
    // one path that said nothing at all.
    return {
      ok: false,
      reason: "enrollFailed",
      detail: withLabelProblem(describeEnrollError(thrown), labelProblem),
    };
  }
}

/**
 * Both sentences, when there are two.
 *
 * SWALLOWS COME IN PAIRS — this flow had two, and it took three commits to get
 * the provider's words onto a screen because the second was missed while the
 * comment about the first was being written. If the label could not be
 * written, that is very likely WHY the QR failed, and dropping it would leave
 * whoever is debugging staring at the same opaque 500 as before.
 */
function withLabelProblem(detail: string, labelProblem: string | null): string {
  return labelProblem ? `${detail} (label: ${labelProblem})` : detail;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Check a six-digit code, for enrolment or for a re-challenge.
 *
 * ONE FUNCTION FOR BOTH, because Supabase treats them identically — a
 * challenge and a verify against a factor — and two functions would be two
 * places to get the wrong factor id. On success the session is raised to
 * `aal2` and the token is refreshed, which is what every gate downstream
 * reads.
 */
export async function verifyTotp(input: {
  factorId?: string;
  code: string;
}): Promise<VerifyResult> {
  const code = input.code.replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, reason: "badCode" };

  try {
    const supabase = createClient();

    let factorId = input.factorId;
    if (!factorId) {
      const { data } = await supabase.auth.mfa.listFactors();
      factorId = (data?.totp ?? [])[0]?.id;
    }
    if (!factorId) return { ok: false, reason: "noFactor" };

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    // Supabase does not distinguish a wrong code from an expired one, and
    // neither should the screen: both mean "try the current code".
    if (error) return { ok: false, reason: "wrongCode" };

    return { ok: true };
  } catch {
    return { ok: false, reason: "wrongCode" };
  }
}

/**
 * How long this session's access token lives, as the token itself states it.
 *
 * THE ONLY HONEST READING AVAILABLE FROM INSIDE THE PRODUCT. The configured
 * JWT expiry and the refresh-token rotation setting live in the Supabase
 * dashboard, and reading them needs a management token — one more credential
 * held in one more place, which is the category of dependency this product
 * already has four of. But a verified token carries `iat` and `exp`, and the
 * difference between them IS the configured lifetime, observed rather than
 * asked for.
 *
 * Per session, not global: it reports what this token was issued with. That is
 * the number that matters to the person looking at it, and it is the one thing
 * about the setting that can be shown without taking on a new secret.
 *
 * Null when there is no session or the claims cannot be read — never a guess.
 */
export async function accessTokenLifetimeSeconds(): Promise<number | null> {
  try {
    const { data } = await createClient().auth.getClaims();
    const claims = (data?.claims ?? {}) as { iat?: number; exp?: number };
    if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
      return null;
    }
    const seconds = claims.exp - claims.iat;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}
