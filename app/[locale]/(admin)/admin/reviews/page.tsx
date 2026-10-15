import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleAlert, Star } from "lucide-react";

import { ReviewVisibility } from "@/components/admin/review-visibility";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { reviewsForModeration } from "@/lib/data/reviews";
import { HOMEPAGE_REVIEW_FLOOR, hasWords } from "@/lib/reviews";

import { setReviewVisibilityAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Which published reviews are on the front page, and why one is not.
 *
 * WHY THIS SCREEN IS SHAPED LIKE A LEDGER AND NOT A QUEUE. The power it holds
 * is the most obviously abusable in the product: a button that removes a review
 * from the most-read page. A queue invites clearing, and the only way to clear
 * "3 hidden" is to put three reviews back — so there is no count on the admin
 * index, no "needs attention" tier, and nothing here drains.
 *
 * IT SHOWS THE STARS, DELIBERATELY, on a screen where nothing selects or sorts
 * by them. A moderation log that hid the ratings would make the one pattern
 * worth watching — somebody hiding the low ones — invisible on the only screen
 * built to show it.
 *
 * FOUR REASONS A REVIEW IS ABSENT AND ONLY ONE IS A DECISION. The other three
 * are the customer's own opt-out, a phone number in the text, and a review that
 * has not published yet; printing them is `proposalSuppressedBy`'s rule, and it
 * matters more here, because an absence with no row behind it would otherwise
 * be read as somebody's choice.
 *
 * A FAILED READ IS ITS OWN SENTENCE and never an empty list. "No reviews" on
 * the screen that watches a moderation power is the worst possible failure
 * shape — rule 6 where the absence does real damage.
 */
export default async function AdminReviewsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.reviews");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut")
      redirect({ href: "/login?next=/admin/reviews", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/reviews", locale });
  }

  const reviews = await reviewsForModeration();

  return (
    <main id="main" className="container py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-sm text-muted-foreground [animation-delay:60ms]">
        {t("lead")}
      </p>
      {/*
        THE RULE IS ON THE SCREEN, not only in the code. Deterrence nobody can
        read is not deterrence — `/providers/standards`' sentence, turned on
        ourselves: an admin reading this is told what the button cannot do, so
        nobody has to discover it by trying.
      */}
      <p className="animate-rise mt-2 max-w-2xl text-caption text-muted-foreground [animation-delay:90ms]">
        {t("neverForBeingNegative")}
      </p>

      {reviews === null ? (
        <Card className="animate-rise mt-8 flex items-start gap-3 border-warning/40 p-5 [animation-delay:120ms]">
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-warning-ink"
          />
          <p className="text-body-sm">{t("unreadable")}</p>
        </Card>
      ) : reviews.length === 0 ? (
        <Card className="animate-rise mt-8 p-5 [animation-delay:120ms]">
          <p className="text-body-sm text-muted-foreground">{t("none")}</p>
        </Card>
      ) : (
        <>
          {/*
            The floor, stated. Below it the wall renders nothing at all, so an
            admin who has just hidden a review and found the homepage unchanged
            has the explanation here rather than filing a bug.
          */}
          <p className="animate-rise mt-6 text-caption tabular-nums text-muted-foreground [animation-delay:120ms]">
            {t("showing", {
              n: String(reviews.filter((r) => r.shows).length),
              count: reviews.filter((r) => r.shows).length,
              total: String(reviews.length),
              floor: String(HOMEPAGE_REVIEW_FLOOR),
            })}
          </p>

          <ul className="mt-5 grid gap-4">
            {reviews.map((review, i) => (
              <li key={review.id}>
                <Card
                  className="animate-rise p-5"
                  style={{ animationDelay: `${Math.min(150 + i * 30, 360)}ms` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-2">
                      <span
                        className="flex items-center gap-0.5"
                        aria-label={t("stars", {
                          n: String(review.rating),
                          count: review.rating,
                        })}
                      >
                        {[1, 2, 3, 4, 5].map((step) => (
                          <Star
                            aria-hidden="true"
                            key={step}
                            className={
                              step <= review.rating
                                ? "size-3.5 fill-gold text-gold"
                                : "size-3.5 text-border"
                            }
                          />
                        ))}
                      </span>
                      <span className="text-body-sm font-semibold">
                        {review.providerName}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {review.authorName}
                        {review.publishedAt
                          ? ` · ${formatInstant(review.publishedAt, locale)}`
                          : null}
                      </span>
                    </p>

                    {review.shows ? (
                      <Badge variant="verified">{t("onHomepage")}</Badge>
                    ) : (
                      <Badge variant="muted">
                        {t(`why.${review.why ?? "hiddenByStaff"}`)}
                      </Badge>
                    )}
                  </div>

                  {/*
                    THE QUOTATION MARKS BELONG TO THE WORDS, NOT TO THE SLOT.
                    This printed `“”` — two quote marks with nothing between
                    them — for every rating left without a comment, which is
                    exactly what `showsOnHomepage`'s `noWords` comment had
                    predicted one module over. The badge does not cover it: the
                    refusals are ordered, so a wordless review from somebody who
                    also opted out is badged `authorOptedOut` and says nothing
                    about the empty quotes. Found in a walkthrough screenshot.
                   */}
                  <p className="mt-3 text-pretty text-body-sm">
                    {hasWords(review.comment) ? (
                      `“${review.comment}”`
                    ) : (
                      <span className="italic text-muted-foreground">
                        {t("ratedNoComment")}
                      </span>
                    )}
                  </p>

                  {review.hiddenAt ? (
                    <p className="mt-2 text-caption text-muted-foreground">
                      {t("hiddenDetail", {
                        code: t(`codes.${review.hiddenCode ?? "abusive"}`),
                        reason: review.hiddenReason ?? "",
                        when: formatInstant(review.hiddenAt, locale),
                      })}
                    </p>
                  ) : null}

                  {/*
                    THE FORM IS OFFERED ONLY WHERE THE DECISION IS OURS. A
                    review absent because the customer opted out, or because it
                    carries a phone number, is not something to hide — hiding it
                    would write a staff decision over somebody else's reason and
                    make the log say we took an action we did not take.
                  */}
                  {review.shows || review.hiddenAt ? (
                    <ReviewVisibility
                      reviewId={review.id}
                      hidden={Boolean(review.hiddenAt)}
                      action={setReviewVisibilityAction}
                    />
                  ) : (
                    <p className="mt-3 border-t border-border pt-3 text-caption text-muted-foreground">
                      {t("notOursToHide")}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
