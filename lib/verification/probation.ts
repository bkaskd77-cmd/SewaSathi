/**
 * A newly approved professional is not the same as one with two hundred jobs,
 * and the product should not pretend otherwise.
 *
 * THE CHECK AT THE DOOR IS A SNAPSHOT; BEHAVIOUR OVER TIME IS THE SIGNAL. Every
 * document in the application describes one moment — the day the police
 * clearance was issued, the day the certificate was awarded. None of it says
 * what somebody is like in a stranger's kitchen on a Tuesday. Probation is
 * where that gets found out, and it is the real safety net rather than the
 * paperwork.
 *
 * IT IS A LIMIT, NOT A PUNISHMENT, and the difference has to show on screen.
 * The badge says "New on SajiloKaam" and never "unproven" or "under review" —
 * one is a fact a customer can weigh, the other is an accusation we have no
 * evidence for. Somebody on probation has passed everything we asked of them.
 */

export type ProviderStanding = "provisional" | "established";

export type ProbationInput = {
  completedJobs: number;
  /** Mean rating. Ignored below the minimum count, where it is noise. */
  ratingAvg: number;
  ratingCount: number;
  /** Complaints a person looked at and upheld. Any at all holds probation. */
  upheldComplaints: number;
  /** Whole days since approval. */
  daysSinceApproval: number;
};

/*
 * FOUR GATES, ALL OF THEM, and each covers a hole the others leave.
 *
 * Jobs alone can be farmed by a friend booking ten cheap jobs in a weekend.
 * Rating alone rests on a handful of ratings from those same friends. Time
 * alone graduates somebody who has done nothing. The complaint gate is the
 * override: one upheld complaint means the evidence we have is bad, whatever
 * the other three say.
 */
export const PROBATION = {
  /** Enough jobs that a pattern exists rather than a run of luck. */
  completedJobs: 10,
  /** Below the platform's own target, because a new professional is still learning our way of working. */
  ratingAvg: 4.0,
  /** Fewer than five ratings is not an average, it is an anecdote. */
  ratingCount: 5,
  /** Thirty days, so ten jobs in a weekend does not graduate anybody. */
  days: 30,

  /*
   * WHAT PROBATION ACTUALLY COSTS THEM. Two jobs at once rather than
   * unlimited: enough to earn a living, few enough that a bad pattern surfaces
   * before it has been repeated in ten houses.
   */
  maxConcurrentJobs: 2,
  /*
   * Not offered emergency work from the open pool.
   *
   * An emergency is the highest-stakes job on the platform — somebody
   * frightened, at night, letting a stranger in — and it is the worst possible
   * place to find out that a new professional is not what their paperwork
   * said. A customer who asks for them BY NAME still reaches them: that is the
   * customer's own judgement and the product should not override it.
   */
  emergencyDispatch: false,
} as const;

export type ProbationVerdict = {
  standing: ProviderStanding;
  /** Every gate not yet passed, so the dashboard can show progress rather than a locked door. */
  remaining: string[];
};

export function judgeProbation(input: ProbationInput): ProbationVerdict {
  const remaining: string[] = [];

  if (input.upheldComplaints > 0) {
    // Not listed as "progress" — it is not something that clears by waiting.
    remaining.push("complaint");
  }
  if (input.completedJobs < PROBATION.completedJobs) remaining.push("jobs");
  if (input.daysSinceApproval < PROBATION.days) remaining.push("days");
  if (
    input.ratingCount < PROBATION.ratingCount ||
    input.ratingAvg < PROBATION.ratingAvg
  ) {
    remaining.push("rating");
  }

  return {
    standing: remaining.length === 0 ? "established" : "provisional",
    remaining,
  };
}

/** May this professional take one more job right now? */
export function canAcceptAnotherJob(
  standing: ProviderStanding,
  liveJobs: number,
): boolean {
  if (standing === "established") return true;
  return liveJobs < PROBATION.maxConcurrentJobs;
}

/** May the open pool offer this professional an emergency? */
export function eligibleForEmergencyPool(standing: ProviderStanding): boolean {
  return standing === "established" || PROBATION.emergencyDispatch;
}
