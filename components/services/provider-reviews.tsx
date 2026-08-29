import { getTranslations } from "next-intl/server";
import { Star } from "lucide-react";

import { Card } from "@/components/ui/card";
import { getProviderReviews } from "@/lib/data/providers";

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
  ratingCount,
}: {
  providerId: string;
  ratingCount: number;
}) {
  const [reviews, t] = await Promise.all([
    getProviderReviews(providerId),
    getTranslations("services"),
  ]);

  if (reviews.length === 0) {
    return (
      <p className="animate-rise mt-2 text-body-sm text-muted-foreground">
        {t("profile.noReviews", { n: String(ratingCount) })}
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
              <p className="text-body-sm font-semibold">{review.author}</p>
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
            <p className="mt-1.5 text-pretty text-body-sm text-muted-foreground">
              {review.comment}
            </p>
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
