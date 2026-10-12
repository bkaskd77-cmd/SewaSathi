import "server-only";

import {
  ROTATION_MIN_LISTINGS,
  TUNING_FLOORS,
  readiness,
  rotationOfferFloor,
  type Readiness,
  type TuningLoop,
} from "@/lib/config/tuning-floors";
import { listConcentration, listRankingEvidence } from "@/lib/data/concentration";
import { RELEVANCE_WEIGHTS, weightEvidence } from "@/lib/data/ranking";
import { triageAccuracy } from "@/lib/data/triage-accuracy";

/**
 * How close each unarmed loop is to the evidence it needs.
 *
 * ONE COMPUTATION, TWO CALLERS, and that is the whole reason this is a module
 * rather than a block inside `/admin/signals`. The admin home has to say "this
 * is ready to tune" and the signals screen has to say how far off it is — two
 * surfaces answering one question, which in this repository is how
 * `countsAsEvidence` came to be written twice and why `lib/provider/measured.ts`
 * exists. A front page that said ready while the screen behind it said four
 * short would be worse than neither.
 *
 * NOTHING HERE DECIDES ANYTHING. `lib/config/tuning-floors.ts` holds the floors
 * and says why each is what it is; this reads the counts. No caller may gate a
 * write on the answer — reaching a floor is permission to start an argument.
 */
export type LoopReadiness = {
  loop: TuningLoop;
  /** Null is a failed read, never "nothing measured". */
  state: Readiness | null;
  /**
   * Which sub-question the state is about, when the loop has more than one.
   * `pool` means rotation is short of professionals rather than of offers —
   * a different problem with a different answer, and collapsing them would
   * tell somebody to go and get more offers in a category with two listings.
   */
  gate?: "pool";
  /** The category the rotation reading came from, for the screen to name. */
  subject?: string;
};

export async function tuningReadiness(): Promise<LoopReadiness[]> {
  const [stats, concentration, triage] = await Promise.all([
    listRankingEvidence(),
    listConcentration(),
    triageAccuracy(),
  ]);

  /*
   * THE WEAKEST TUNABLE WEIGHT, never the average. A blend is retuned as a
   * whole, so it is ready when its thinnest term is; an average would let
   * `availability` — a stated fact, measured for everybody — carry `rating`
   * across a line it is nowhere near. `canBeUnmeasured` is what separates the
   * terms that can rest on a prior from the facts that cannot.
   */
  const evidence = stats.ok
    ? weightEvidence(
        stats.value.map((s) => ({ stats: s })),
        RELEVANCE_WEIGHTS,
      ).filter((e) => e.canBeUnmeasured)
    : [];

  const rankingHave = !stats.ok
    ? null
    : evidence.length === 0
      ? 0
      : Math.min(...evidence.map((e) => e.measured));

  /*
   * ROTATION IS PER CATEGORY, and the one reported is the category CLOSEST TO
   * ITS OWN FLOOR rather than the busiest — each pool size has a different
   * floor, and rotation arrives one trade at a time, so the question is whether
   * ANY trade is ready. An average across ten would hide the one that is.
   *
   * The pool is professionals who have actually been OFFERED work, which is the
   * right denominator for a question about how offers are shared — not everyone
   * who could serve the category.
   */
  const best = concentration.ok
    ? concentration.value.reduce<{ slug: string; offers: number; pool: number } | null>(
        (winner, row) => {
          const here = {
            slug: row.categorySlug,
            offers: row.offers,
            pool: row.professionals,
          };
          if (!winner) return here;
          return here.offers / rotationOfferFloor(here.pool) >
            winner.offers / rotationOfferFloor(winner.pool)
            ? here
            : winner;
        },
        null,
      )
    : null;

  /*
   * THE POOL GATE IS STRUCTURAL AND COMES FIRST. Below five there is nothing to
   * rotate however many offers there are — with two it is alternation, and at
   * three or four the near-tie band is usually the whole list. A category with
   * two listings and a hundred offers is not nearly ready; it is not a rotation
   * problem at all, and reporting it against the offer floor would say so.
   */
  const rotation: LoopReadiness =
    best === null
      ? { loop: "rotation", state: null }
      : best.pool < ROTATION_MIN_LISTINGS
        ? {
            loop: "rotation",
            gate: "pool",
            state: readiness(best.pool, ROTATION_MIN_LISTINGS),
          }
        : {
            loop: "rotation",
            subject: best.slug,
            state: readiness(best.offers, rotationOfferFloor(best.pool)),
          };

  return [
    { loop: "ranking", state: readiness(rankingHave, TUNING_FLOORS.ranking.floor) },
    rotation,
    {
      loop: "triage",
      state: readiness(
        triage.coverage.ok ? triage.coverage.value.attributed : null,
        TUNING_FLOORS.triage.floor,
      ),
    },
  ];
}

/**
 * The loops that have reached their floor.
 *
 * SEPARATE FROM THE READING so the front page cannot form its own opinion about
 * what "ready" means. A null state is never ready: a count that failed is not
 * evidence in either direction, and the front page saying "ready to tune" off a
 * broken query would be the most expensive version of rule 6 in this product —
 * an invitation to move a published number on no data at all.
 */
export function readyLoops(rows: readonly LoopReadiness[]): TuningLoop[] {
  return rows.filter((r) => r.state?.ready === true).map((r) => r.loop);
}
