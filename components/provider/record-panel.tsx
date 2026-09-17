import { Star } from "lucide-react";

import { Card } from "@/components/ui/card";
import { displayRating, hasRating } from "@/lib/provider";

/**
 * What a professional has built here.
 *
 * WHY THIS EXISTS. A record of 200 jobs and a 4.8 is the single strongest
 * reason to stay, and until now the person who owned it could not see it — the
 * dashboard showed what they charge, whether they are free, what has come back
 * and what they are owed, and nothing about what they had earned.
 *
 * FRAMED AS RECOGNITION, NEVER AS A WARNING, and that is a deliberate choice
 * rather than a soft one. "You would lose all this if you left" is the same
 * fact and it reads as a threat from a platform taking fifteen percent — it
 * invites the reply that the record should have been portable in the first
 * place. The retention effect comes from the record being real, visible and
 * theirs; a sentence pointing at the exit does not add to it and costs the
 * goodwill the record was building.
 *
 * RULE 6 HOLDS HERE TOO. A professional with no ratings sees "no ratings yet"
 * rather than a 0.0 — `hasRating` is the same gate every customer-facing
 * surface asks, and the person it would mislead here is the one it is about.
 */
export function RecordPanel({
  stats,
  since,
  labels,
}: {
  stats: { ratingAvg: number; ratingCount: number; jobsCompleted: number };
  /** Pre-formatted month they started. Null until there is one. */
  since: string | null;
  labels: {
    title: string;
    rating: string;
    /** "12 reviews" — the evidence under the figure, never on its own. */
    reviews: string;
    jobsLabel: string;
    /** A bare count: it sits under its own label. */
    jobs: string;
    since: string;
    empty: string;
    notRated: string;
  };
}) {
  const rating = displayRating(stats);
  const bare = !hasRating(stats) && stats.jobsCompleted === 0;

  return (
    <Card className="animate-rise p-5">
      <h2 className="text-body-md font-semibold">{labels.title}</h2>

      {bare ? (
        <p className="mt-1.5 text-body-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : (
        <>
          <dl className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-3">
            <div>
              <dt className="text-caption uppercase text-muted-foreground">
                {labels.rating}
              </dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-display text-display-sm tabular-nums">
                {rating === null ? (
                  <span className="text-body-md font-normal text-muted-foreground">
                    {labels.notRated}
                  </span>
                ) : (
                  <>
                    <Star
                      aria-hidden="true"
                      className="size-5 fill-gold text-gold"
                    />
                    {rating.toFixed(1)}
                  </>
                )}
              </dd>
              {/*
                  THE COUNT SITS WITH THE FIGURE, not in a tile of its own.
                  That is rule 6 on the professional's own screen: 4.8 from
                  three jobs and 4.8 from two hundred are different facts, and
                  separating the number from its evidence is exactly how they
                  come to look the same.
               */}
              {rating === null ? null : (
                <p className="text-caption mt-0.5 text-muted-foreground">
                  {labels.reviews}
                </p>
              )}
            </div>

            <div>
              <dt className="text-caption uppercase text-muted-foreground">
                {labels.jobsLabel}
              </dt>
              <dd className="mt-0.5 font-display text-display-sm tabular-nums">
                {labels.jobs}
              </dd>
            </div>
          </dl>

          {since ? (
            <p className="mt-3 text-body-sm text-muted-foreground">
              {labels.since}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
