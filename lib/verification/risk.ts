/**
 * How much attention an application needs, and how soon somebody should open
 * it. Two different questions, and answering them with one number is why
 * review queues go wrong.
 *
 * THE SCORE IS NOT A DECISION. Nothing here approves or rejects anybody. It
 * produces a number for sorting and, far more importantly, A LIST OF REASONS —
 * a reviewer reads the evidence and decides. A queue that shows "risk: 72" and
 * hides why is a queue where the reviewer learns to trust the number, and the
 * day the number is wrong nobody notices. So `evidence` is the output that
 * matters and `score` is the output that sorts.
 *
 * RISK AND PRIORITY PULL IN DIFFERENT DIRECTIONS.
 *
 *   risk     — how carefully this needs looking at.
 *   priority — how soon somebody should look at all.
 *
 * A clean application from a plumber in a ward with no plumbers is zero risk
 * and the highest priority in the queue: a genuine tradesperson who waits
 * three weeks has already signed up with a competitor, and supply lost that
 * way never shows up in any metric. A duplicate hit against a removed provider
 * is high risk AND high priority, because leaving it to rot is its own
 * failure. Collapsing the two would make the platform slowest at exactly the
 * applications it most wants.
 *
 * Pure, so the weights can be argued about here rather than inside a query.
 */

import { MATCH_WEIGHTS, type MatchKeyKind } from "./match-keys";

export type ReferenceOutcome =
  | "positive"
  | "negative"
  | "unreachable"
  | "not_contacted";

/** One reason, in the reviewer's words rather than the scorer's. */
export type RiskEvidence = {
  key: string;
  points: number;
  /** What the reviewer is being told. Rendered, not logged. */
  detail: string;
};

export type RiskInput = {
  /**
   * Kinds of match key that hit a PRIOR REJECTED OR REMOVED application.
   *
   * A hit against an approved provider is a different thing — usually the same
   * person adding a second trade — and is not passed here.
   */
  duplicateHitsAgainstRemoved: readonly MatchKeyKind[];
  /** Required documents that have not been supplied. */
  missingRequired: number;
  /**
   * Mean capture quality of what was supplied, 0–1, from
   * `lib/verification/capture.ts`. 1 when nothing has been uploaded yet, so a
   * blank application is not also accused of blurry photographs.
   */
  documentQuality: number;
  references: ReferenceOutcome;
  /** CTEVT certificate or a passed practical assessment. */
  competenceEstablished: boolean;
};

export type RiskBand = "low" | "elevated" | "high";

export type RiskVerdict = {
  /** 0–100. Sorting only. */
  score: number;
  band: RiskBand;
  /** Why, strongest first. This is the output a human reads. */
  evidence: RiskEvidence[];
};

/*
 * THE WEIGHTS, and the reasoning for each.
 *
 * They sum to well over 100 on purpose. An application can be bad in several
 * ways at once and the clamp is what stops that being modelled as "worse than
 * possible"; a set of weights that summed to exactly 100 would mean every
 * factor had been shrunk to fit an arbitrary total.
 */
const WEIGHTS = {
  /*
   * A duplicate against somebody we removed is the single strongest signal in
   * the system, because it is the attack the whole phase exists to stop. Scaled
   * from MATCH_WEIGHTS so the ranking there — document beats face beats
   * account beats name — is not restated and cannot drift.
   */
  duplicateScale: 0.6,
  /** Each missing required document, capped: three missing is not thrice as suspicious as one, it is just incomplete. */
  missingDocument: 8,
  missingDocumentCap: 24,
  /*
   * Unreadable photographs are not usually fraud, they are a cheap phone in
   * bad light. Weighted low on purpose — the capture check already rejects the
   * worst before upload, and treating a poor camera as suspicion would score
   * poverty.
   */
  quality: 15,
  /** Somebody who worked with them says not to. The strongest human signal available. */
  referenceNegative: 25,
  /** Nobody answered. Weak: numbers change, people are busy. */
  referenceUnreachable: 8,
  /** Not tried yet. Not a fault of theirs — it is a gap in OUR evidence, and it should keep the file open. */
  referenceNotContacted: 10,
  /** No certificate and no assessment. Says nothing about honesty; says everything about whether we can send them. */
  noCompetence: 12,
} as const;

const BAND_ELEVATED = 25;
const BAND_HIGH = 55;

export function scoreApplication(input: RiskInput): RiskVerdict {
  const evidence: RiskEvidence[] = [];

  for (const kind of input.duplicateHitsAgainstRemoved) {
    const points = Math.round(MATCH_WEIGHTS[kind] * WEIGHTS.duplicateScale);
    evidence.push({
      key: `duplicate:${kind}`,
      points,
      detail: `Matches a removed or rejected application on ${kind}.`,
    });
  }

  if (input.missingRequired > 0) {
    const points = Math.min(
      input.missingRequired * WEIGHTS.missingDocument,
      WEIGHTS.missingDocumentCap,
    );
    evidence.push({
      key: "documents:missing",
      points,
      detail: `${input.missingRequired} required document${input.missingRequired === 1 ? "" : "s"} not supplied.`,
    });
  }

  const quality = clamp01(input.documentQuality);
  if (quality < 1) {
    const points = Math.round((1 - quality) * WEIGHTS.quality);
    if (points > 0) {
      evidence.push({
        key: "documents:quality",
        points,
        detail: "Some documents are hard to read. Usually a cheap camera, not a forgery.",
      });
    }
  }

  if (input.references === "negative") {
    evidence.push({
      key: "references:negative",
      points: WEIGHTS.referenceNegative,
      detail: "A reference advised against them. Read the note before deciding.",
    });
  } else if (input.references === "unreachable") {
    evidence.push({
      key: "references:unreachable",
      points: WEIGHTS.referenceUnreachable,
      detail: "References could not be reached. Numbers change; try once more.",
    });
  } else if (input.references === "not_contacted") {
    evidence.push({
      key: "references:pending",
      points: WEIGHTS.referenceNotContacted,
      detail: "References not contacted yet. This is our gap, not theirs.",
    });
  }

  if (!input.competenceEstablished) {
    evidence.push({
      key: "competence:none",
      points: WEIGHTS.noCompetence,
      detail: "No CTEVT certificate and no practical assessment recorded.",
    });
  }

  const score = Math.min(
    100,
    evidence.reduce((total, item) => total + item.points, 0),
  );

  return {
    score,
    band: score >= BAND_HIGH ? "high" : score >= BAND_ELEVATED ? "elevated" : "low",
    evidence: [...evidence].sort((a, b) => b.points - a.points),
  };
}

/* ------------------------------------------------------------------ *
 * The queue's order
 * ------------------------------------------------------------------ */

export type PriorityInput = {
  /** Whole days since submission. */
  waitingDays: number;
  /**
   * How badly this trade is needed in these wards, 0–1.
   *
   * Computed from open bookings against active providers. A plumber in a ward
   * with no plumbers is the most valuable application on the platform.
   */
  demand: number;
  /** From `scoreApplication`. High risk also deserves a prompt answer. */
  riskScore: number;
};

/*
 * WAITING DOMINATES, and that is the decision this function encodes.
 *
 * Six points a day means a fortnight of waiting outranks the maximum demand
 * bonus and every risk contribution combined. Any other shape produces a queue
 * where quiet, clean applications sink — and those are the ones the platform
 * needs most, because a suspicious application at least gets opened.
 */
const PRIORITY = { perWaitingDay: 6, demand: 30, risk: 0.4 } as const;

export function queuePriority(input: PriorityInput): number {
  return (
    Math.max(0, input.waitingDays) * PRIORITY.perWaitingDay +
    clamp01(input.demand) * PRIORITY.demand +
    Math.max(0, input.riskScore) * PRIORITY.risk
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
