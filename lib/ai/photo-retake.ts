import type { PhotoVerdict } from "@/lib/ai/triage";

/**
 * Whether to ask for another photo, and whether to stop asking.
 *
 * PURE, AND SEPARATE FROM THE SCREEN, because what counts as "stop asking" is a product
 * promise rather than a rendering detail — and because the one thing that must never
 * happen here is easier to assert than to review: a booking is never blocked.
 *
 * TWO TRIES, THEN THE OFFER CLOSES. A third "that is not it" is not help, it is an
 * argument with somebody who is trying to report a broken tap, and the professional's
 * on-site correction already fixes a misleading photo. So the upload closes and the
 * booking carries on with no photo at all.
 *
 * `unclear` COUNTS TOWARDS THE LIMIT AND `related` RESETS IT. Both are deliberate. A dark
 * photo and a wrong photo cost the same two attempts, because the alternative is an
 * unbounded loop with somebody in a dim bathroom; and a customer who gets it right has
 * not been uncooperative, so their count goes back to nothing.
 *
 * NOTHING HERE CAN BLOCK A BOOKING OR CHANGE AN ANSWER. The verdict arrives beside the
 * triage result, never inside it.
 */

/** How many photos may ride on one request, once they are kept. */
export const MAX_PHOTOS_PER_REQUEST = 3;

/** How many rejected photos before the offer closes for this request. */
export const MAX_REJECTED_PHOTOS = 2;

export type RetakeState = {
  /** Rejected so far on this request. Reset by a photo that is related. */
  rejected: number;
};

export type RetakeDecision =
  /** Keep it. Nothing is said. */
  | { kind: "keep" }
  /** Ask for another, with the model's own reason. */
  | { kind: "retake"; relevance: "unrelated" | "unclear"; reason: string | null }
  /** Stop asking. The booking continues with no photo. */
  | { kind: "closed"; relevance: "unrelated" | "unclear"; reason: string | null };

/** A decision that asks the customer for something. Never `keep`. */
export type RetakeAsk = Exclude<RetakeDecision, { kind: "keep" }>;

export function judgePhoto(
  verdict: PhotoVerdict | null | undefined,
  state: RetakeState,
): { decision: RetakeDecision; next: RetakeState } {
  /*
   * NO VERDICT MEANS KEEP IT. Null is "no photo, or nobody looked" — the fallback
   * answered, the call failed, the model said nothing. Treating silence as a rejection
   * would make a customer retake a perfectly good photo because our key had expired,
   * which is rule 6's shape for a judgement: not recorded is not a finding.
   */
  if (!verdict || verdict.relevance === "related") {
    return { decision: { kind: "keep" }, next: { rejected: 0 } };
  }

  const rejected = state.rejected + 1;
  const common = { relevance: verdict.relevance, reason: verdict.reason };

  return {
    decision:
      rejected >= MAX_REJECTED_PHOTOS
        ? { kind: "closed", ...common }
        : { kind: "retake", ...common },
    next: { rejected },
  };
}

/** Has this request used up its photo slots? */
export function photosFull(kept: number): boolean {
  return kept >= MAX_PHOTOS_PER_REQUEST;
}

/**
 * Is there anything here to triage at all?
 *
 * THE BUG THIS EXISTS FOR, IN FULL. A customer attached a photograph of bananas, typed
 * nothing, and the product answered "Plumbing · Needed soon · Rs 900 – Rs 4,000" with a
 * list of plumbing products to choose from. The photo check had worked perfectly and said
 * so on screen — and the priced recommendation sat underneath it anyway.
 *
 * WHY IT HAPPENED, AND IT IS NOT THE MODEL'S FAULT. `TriageResult` requires a category, an
 * urgency and a price; there is no way for an answer to mean "nothing here". So with no
 * text and an unusable photograph the only thing left is `GENERIC_RULE` — plumbing, soon,
 * 900 to 4000 — which is a sensible default for a FAILURE and nonsense for an absence. "It
 * always answers" was written about a missing API key, a timeout, a reply that would not
 * parse. It was never meant to mean "invent a job".
 *
 * SO THE RULE IS ABOUT EVIDENCE, NOT ABOUT CONFIDENCE. We show a price when we have
 * something to price it from: words, or a photograph of the problem. Neither is not a
 * low-confidence answer, it is no answer, and printing a number anyway is the same class of
 * mistake as rendering a default as a measurement — rule 6, on the first screen anybody
 * sees.
 *
 * A HAZARD IS NEVER SUPPRESSED. If the safety floor fired, the answer carries what to do
 * right now and it is shown whatever the photograph turned out to be of. Somebody
 * photographing a sparking board and typing nothing is the exact case the photo hazard read
 * exists for, and it must not be hidden by a rule about relevance.
 */
export function hasSomethingToTriage(input: {
  /** What the customer actually typed. */
  text: string;
  /** Whether a photograph came with the question at all. */
  hadPhoto: boolean;
  /**
   * Where the answer came from.
   *
   * ONLY `claude` MEANS ANYTHING LOOKED AT THE PHOTOGRAPH. The cache is text-only, so a
   * request carrying a photograph never hits it; the fallback is the keyword matcher,
   * which reads words and cannot see. This is the field the first version of this rule
   * was missing, and the gap was found the same way the original bug was — by somebody
   * using the product.
   */
  source: "claude" | "cache" | "fallback";
  /** The photo verdict, or null when there was no photo or nobody judged it. */
  verdict: PhotoVerdict | null | undefined;
  /** The urgency the answer carries AFTER the safety floor. */
  urgency: "emergency" | "soon" | "routine";
}): boolean {
  /* The safety floor fired, or the answer is an emergency for some other reason. Show it. */
  if (input.urgency === "emergency") return true;

  /* Words are evidence. Anything typed is something to work from, even a short phrase. */
  if (input.text.trim().length > 0) return true;

  /* No words and no photograph is no question. Unreachable through the hero, which runs
     no triage on an empty form — stated rather than left to be inferred. */
  if (!input.hadPhoto) return false;

  /*
   * NO WORDS, AND NOBODY LOOKED AT THE PHOTOGRAPH. This is the half the first fix missed
   * and it is the commoner of the two: the model timed out, or the key is unset, so the
   * answer came from the keyword matcher — which was handed an empty string and returned
   * `GENERIC_RULE`. The product then printed "Plumbing · Needed soon · Rs 900 – Rs 4,000"
   * under a sentence admitting it had not looked at the photograph. The card was
   * suppressed when the model said "this is a banana" and shown when nothing said
   * anything at all, which is exactly backwards: a verdict we never got is less evidence
   * than one we did.
   *
   * THE SAFETY LINE IS NOT LOST WITH IT. `applySafetyFloor` puts "we couldn't look at
   * your photo, so check it yourself" on this path, and the hero renders that sentence on
   * its own when the card is suppressed — advice without an invented job attached.
   */
  if (input.source !== "claude") return false;

  /*
   * The model looked. So the photograph is the whole basis, and it is only a basis if it
   * showed the problem. `unclear` counts as nothing for the same reason `unrelated` does:
   * we cannot see a problem in it either way. A null verdict here means the model
   * answered without naming a relevance, which is an answer it derived from the
   * photograph — shown, because something did look.
   */
  return !input.verdict || input.verdict.relevance === "related";
}
