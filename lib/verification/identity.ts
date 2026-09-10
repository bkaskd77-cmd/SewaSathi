/**
 * Face comparison and liveness, behind one interface, shipped switched off.
 *
 * WHY THE INTERFACE EXISTS BEFORE THE VENDOR DOES. At launch there are tens of
 * providers, and the strongest verification available at that scale is a
 * person meeting them. Buying a face-matching service now would mean paying a
 * monthly minimum to automate a job that takes one human being an hour a week,
 * and — worse — committing the data model to whatever shape that vendor's API
 * happens to have. The expensive thing to retrofit is the SEAM, not the
 * service behind it. So the seam is built, a contract test pins what any
 * implementation must do, and `manual` is what runs.
 *
 * ONE ADAPTER PER EXTERNAL DEPENDENCY is the standing rule (ARCHITECTURE.md),
 * and this is the same shape as `lib/payments/gateway.ts`: swapping the
 * provider is one file.
 *
 * WHAT `manual` MEANS. Not "approved" and not "failed" — `needs_human`. The
 * distinction matters more here than anywhere else in the product: an
 * unverifiable check reported as a pass is the failure mode that put
 * placeholder Twilio credentials into production for a day. Same rule as
 * `/api/health`: unknown is never ok.
 */

export type FaceMatchInput = {
  /** Signed, short-lived URL to the selfie. Never the bytes. */
  selfieUrl: string;
  /** Signed, short-lived URL to the photo page of the identity document. */
  documentUrl: string;
};

export type FaceMatchResult =
  | {
      outcome: "match" | "mismatch";
      /** 0–1. What the vendor's own scale means is the adapter's problem, not the caller's. */
      confidence: number;
      /**
       * An opaque, non-reversible descriptor, when the vendor offers one.
       *
       * Stored as a `face` match key so a removed provider is caught even
       * having changed their name, number, documents and bank account. It is
       * biometric data under Nepal's Individual Privacy Act, so it is covered
       * by the consent text and never leaves this system.
       */
      signature?: string;
    }
  | {
      /** No vendor configured, the vendor was unreachable, or it declined to answer. */
      outcome: "needs_human";
      reason: string;
    };

export type LivenessResult =
  | { outcome: "live" | "spoof"; confidence: number }
  | { outcome: "needs_human"; reason: string };

export type IdentityAdapter = {
  /** Stable name, written to the audit log with every result. */
  readonly name: string;
  /** False when credentials are absent — the same contract as a payment gateway. */
  isConfigured(): boolean;
  compareFaces(input: FaceMatchInput): Promise<FaceMatchResult>;
  checkLiveness(input: { selfieUrl: string }): Promise<LivenessResult>;
};

/**
 * The adapter that ships enabled: it does nothing and says so.
 *
 * Every call returns `needs_human`, which routes the application to the review
 * queue exactly as it would have gone anyway. Turning a vendor on later
 * changes this one binding and nothing else.
 */
export const manualIdentity: IdentityAdapter = {
  name: "manual",
  isConfigured: () => false,
  async compareFaces() {
    return {
      outcome: "needs_human",
      reason: "No face-matching vendor is configured; a person compares the selfie against the document.",
    };
  },
  async checkLiveness() {
    return {
      outcome: "needs_human",
      reason: "No liveness vendor is configured; the selfie is reviewed by a person.",
    };
  },
};

/**
 * Which adapter is in play.
 *
 * `IDENTITY_ADAPTER` names it, and an unknown or unset value gives `manual`
 * rather than throwing: a mistyped environment variable must degrade to a
 * human looking, never to a page that will not load or — far worse — to a
 * check that is silently skipped.
 */
export function identityAdapter(): IdentityAdapter {
  const configured = process.env.IDENTITY_ADAPTER?.trim();
  if (!configured || configured === "manual") return manualIdentity;
  // Registered vendors go here as they are built. Until one is, an unknown
  // name is a misconfiguration and the safe answer is the manual path.
  return manualIdentity;
}

/**
 * Is automated identity matching actually doing anything right now?
 *
 * Read by `/api/health` and shown in the review queue, so nobody has to infer
 * from an empty column whether the check ran and passed or never ran at all.
 */
export function identityMatchingIsLive(): boolean {
  return identityAdapter().isConfigured();
}
