/**
 * What we ask permission for before a citizenship certificate is uploaded.
 *
 * NEPAL'S INDIVIDUAL PRIVACY ACT 2075 APPLIES, and the parts that bite here
 * are that personal data is collected with consent, for a stated purpose, and
 * that biometric data — a face — is a protected category. A checkbox saying
 * "I agree to the terms" is not consent to hand over a photograph of your
 * face and your citizenship number; consent has to name what is collected,
 * why, who sees it and how long it is kept.
 *
 * CONSENT IS VERSIONED AND STAMPED, which is the part that is easy to skip and
 * impossible to reconstruct later. "They agreed" is worth nothing without
 * WHICH TEXT they agreed to and WHEN — if the wording changes next year, the
 * only way to know what somebody actually consented to is to have recorded the
 * version alongside the timestamp. Bump `CONSENT_VERSION` whenever the points
 * below change, in the same commit, and existing providers are re-asked rather
 * than silently carried over.
 *
 * The keys are here and the sentences are in `messages/*.json`, because this
 * has to be read in Nepali by somebody deciding whether to hand over their
 * identity — and a legal text that exists only in English is not consent from
 * them, it is a signature on something they could not read.
 */

/**
 * Bump this when the points change. Never edit a point in place without it.
 */
export const CONSENT_VERSION = "2026-09-10.1";

export type ConsentPoint = {
  /** Message key under `join.consent.points`. */
  key: string;
  /** True for the categories the Act treats as sensitive. */
  sensitive: boolean;
};

/**
 * The five things somebody is agreeing to, each answering one question a
 * person would actually ask before handing over their papers.
 */
export const CONSENT_POINTS: ConsentPoint[] = [
  /** What we collect. Named item by item, not as "your information". */
  { key: "whatWeCollect", sensitive: false },
  /** Your face, called that. It is biometric data and the Act treats it as its own category. */
  { key: "yourFace", sensitive: true },
  /** Why: to check you are who you say, and that you can do the work. */
  { key: "why", sensitive: false },
  /** Who sees it: our reviewers, nobody else, and never a customer. */
  { key: "whoSees", sensitive: false },
  /** How long, and what makes it go sooner. */
  { key: "howLong", sensitive: false },
];

export type ConsentRecord = {
  version: string;
  /** ISO instant. */
  grantedAt: string;
  /** The document kinds this consent covers. */
  scope: string[];
};

/**
 * Is this consent good for what is about to be uploaded?
 *
 * Checked at the moment of upload rather than at the start of the form,
 * because a session that resumes three days later on a new phone is the normal
 * case here and the consent has to still be there. A consent from an older
 * version does not carry: the whole point of versioning is that they agreed to
 * different words.
 */
export function consentCovers(
  record: ConsentRecord | null,
  documentKind: string,
): boolean {
  if (!record) return false;
  if (record.version !== CONSENT_VERSION) return false;
  return record.scope.includes(documentKind);
}

/** Everything a provider application's consent has to cover. */
export const CONSENT_SCOPE = [
  "citizenship",
  "pan",
  "selfie",
  "police_clearance",
  "ctevt",
] as const;

export function newConsent(now: Date = new Date()): ConsentRecord {
  return {
    version: CONSENT_VERSION,
    grantedAt: now.toISOString(),
    scope: [...CONSENT_SCOPE],
  };
}
