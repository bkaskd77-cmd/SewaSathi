import { getTranslations } from "next-intl/server";
import { Star } from "lucide-react";

import { Card } from "@/components/ui/card";
import { getProviderReviews } from "@/lib/data/providers";
import { hasWords } from "@/lib/reviews";

/**
 * A professional's written reviews.
 *
 * Its own async component so the page can put it in a Suspense boundary. The
 * profile above it — the name, the verification breakdown, the rate, the Book
 * button — is what somebody came for, and it should not wait on a second query
 * for the reviews further down the page.
 */
export async function ProviderReviews({
  providerId,
  providerName,
  ratingCount,
}: {
  providerId: string;
  /** Attribution for the reply — "Krishna replied", not "the professional". */
  providerName: string;
  ratingCount: number;
}) {
  const [reviews, t] = await Promise.all([
    getProviderReviews(providerId),
    getTranslations("services"),
  ]);

  /*
   * A FAILED READ IS ITS OWN SENTENCE, never "no reviews yet". This branch
   * took both and printed the empty state over a listing that has a review —
   * on the live page, under a rating of 4.5 (1), which is the contradiction
   * that gives it away and which nobody reads as a fault.
   */
  if (reviews === null) {
    return (
      <p className="animate-rise mt-2 text-body-sm text-muted-foreground">
        {t("profile.reviewsUnreadable")}
      </p>
    );
  }

  if (reviews.length === 0) {
    return (
      <p className="animate-rise mt-2 text-body-sm text-muted-foreground">
        {t("profile.noReviews", { count: ratingCount, n: String(ratingCount) })}
      </p>
    );
  }

  return (
    <ul className="mt-3 flex flex-col gap-3">
      {reviews.map((review, index) => (
        <li key={review.id}>
          <Card
            className="animate-rise p-4"
            // Capped, like the provider cards: ten reviews should not take
            // half a second to finish arriving.
            style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
          >
            <div className="flex items-center justify-between gap-3">
              {/*
                  "A customer" rather than a blank. `author_name` is written as
                  the empty string on every real review — a public review is not
                  a box somebody types a name into — and this rendered it, so
                  every listing showed an empty line where a name goes. Found on
                  the live profile page during the walkthrough. The name is the
                  customer's FIRST NAME from `profiles` now, the same boundary
                  the homepage holds.
               */}
              <p className="text-body-sm font-semibold">
                {review.author ?? t("profile.aCustomer")}
              </p>
              <p
                className="flex items-center gap-1 text-caption tabular-nums"
                aria-label={t("profile.ratingOutOf", {
                  rating: String(review.rating),
                })}
              >
                <Star
                  aria-hidden="true"
                  className="size-3.5 fill-gold text-gold"
                />
                {review.rating}.0
              </p>
            </div>
            {/*
                A STAR WITH NO WORDS IS SAID, NEVER LEFT BLANK. `submitReview`
                accepts an empty comment on purpose — rating without writing is
                a real thing a customer does — and this printed an empty
                paragraph for it, which reads as a card that failed to load.
                The homepage REFUSES such a review (`showsOnHomepage`'s
                `noWords`); the listing keeps it and names it, because a rating
                is testimony and the page may not lose any, and because it
                counts toward the average either way.
             */}
            <p className="mt-1.5 text-pretty text-body-sm text-muted-foreground">
              {hasWords(review.comment) ? (
                review.comment
              ) : (
                <span className="italic">{t("profile.ratedNoComment")}</span>
              )}
            </p>

            {/*
                THE REPLY, INDENTED AND ATTRIBUTED. Nested rather than
                alongside, because it is an answer to this review and not a
                second review — and it carries no rating of its own, because
                there is no counter-score anywhere in this design.
             */}
            {review.reply ? (
              <div className="mt-3 border-l-2 border-border pl-3">
                <p className="text-caption font-semibold text-muted-foreground">
                  {t("profile.reply", { name: providerName })}
                </p>
                <p className="mt-0.5 text-pretty text-body-sm text-muted-foreground">
                  {review.reply}
                </p>
              </div>
            ) : null}
            <p className="mt-2 text-caption text-muted-foreground">
              {review.daysAgo < 30
                ? t("profile.daysAgo", {
                    count: review.daysAgo,
                    n: String(review.daysAgo),
                  })
                : t("profile.monthsAgo", {
                    count: Math.round(review.daysAgo / 30),
                    n: String(Math.round(review.daysAgo / 30)),
                  })}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
