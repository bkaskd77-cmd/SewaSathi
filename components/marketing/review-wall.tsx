import { getLocale, getTranslations } from "next-intl/server";
import { Star } from "lucide-react";

import { Reveal } from "@/components/shared/reveal";
import { Card } from "@/components/ui/card";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import type { Locale } from "@/i18n/routing";
import type { ReviewWallEntry } from "@/lib/data/activity";

/**
 * What customers actually said, or nothing at all.
 *
 * THE SECOND HALF OF WHAT `lib/mock/activityFeed.ts` USED TO DO. The strip
 * above it says work happened; this says what people thought of it. The
 * invented version of this was `reviews.json` — 94 written reviews from named
 * customers, every one of them fiction, rendered on a public page. These are
 * real or the section does not exist.
 *
 * NO STAR FILTER, which is the thing worth knowing about this component. The
 * wall is whatever the last few customers said, one-star reviews included, and
 * `showsOnHomepage` cannot express a rating condition at all. A wall of
 * hand-picked fives is a claim nobody made — and it reads as one, which is why
 * it is worth less than a wall with a three on it.
 *
 * FOUR THINGS IT WILL NOT SAY, enforced in the select rather than here: no
 * surname, no ward, no amount, and no professional's name. Naming a listing in
 * a front-page testimonial is an exposure lever nobody designed.
 *
 * IT RENDERS NOTHING BELOW THE FLOOR, and nothing on a failed read — both
 * arrive as an empty array. One review would read as "this is the only thing
 * anybody has ever said about us".
 *
 * STATIC, A SERVER COMPONENT, NO JAVASCRIPT. The only motion is the entrance
 * `Reveal` every band on this page already has, and the stagger the standing
 * rule asks for.
 */
export async function ReviewWall({ entries }: { entries: ReviewWallEntry[] }) {
  if (entries.length === 0) return null;

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("home.reviews");

  /*
   * A SLUG WE NO LONGER SELL RENDERS NOTHING, never its own slug — the strip's
   * rule, and for the same reason: the data layer reads what the booking says
   * and a category can be retired after a job is finished.
   */
  const cards = entries.flatMap((entry) => {
    const category = SERVICE_CATEGORIES.find(
      (c) => c.slug === entry.categorySlug,
    );
    if (!category) return [];
    return [{ entry, trade: categoryCopy(category, locale).name }];
  });

  if (cards.length === 0) return null;

  return (
    <div className="border-b border-border bg-card/40">
      <Reveal className="container py-10 sm:py-12">
        <h2 className="text-overline uppercase text-gold-ink">{t("title")}</h2>

        <ul className="mt-5 grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ entry, trade }, i) => (
            <li key={`${entry.name}-${entry.categorySlug}-${i}`}>
              {/* Capped at 0.25s, per the standing motion rule — a long list
                  must not crawl. */}
              <Reveal delay={Math.min(i * 0.05, 0.25)} className="h-full">
                <Card className="flex h-full flex-col gap-3 p-5">
                  <p
                    className="flex items-center gap-0.5"
                    aria-label={t("stars", {
                      n: String(entry.rating),
                      count: entry.rating,
                    })}
                  >
                    {[1, 2, 3, 4, 5].map((step) => (
                      <Star
                        aria-hidden="true"
                        key={step}
                        className={
                          step <= entry.rating
                            ? "size-3.5 fill-gold text-gold"
                            : "size-3.5 text-border"
                        }
                      />
                    ))}
                  </p>

                  {/*
                    The words as written, never trimmed with an ellipsis. A
                    testimonial cut off mid-sentence is a quotation somebody
                    did not give; `REVIEW_MAX_CHARS` already bounds the length
                    at the point it is written.
                  */}
                  <p className="text-pretty text-body-sm">
                    {`“${entry.comment}”`}
                  </p>

                  <p className="mt-auto text-caption text-muted-foreground">
                    {t("attribution", {
                      name: entry.name,
                      city: entry.city,
                      trade,
                      n: String(entry.daysAgo),
                      count: entry.daysAgo,
                    })}
                  </p>
                </Card>
              </Reveal>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
