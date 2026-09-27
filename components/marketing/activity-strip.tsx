import { getLocale, getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import { Reveal } from "@/components/shared/reveal";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import type { Locale } from "@/i18n/routing";
import type { ActivityEntry } from "@/lib/data/activity";

/**
 * Work that actually happened, or nothing at all.
 *
 * THIS IS THE SLOT THE INVENTED TICKER HELD, filled with the real thing. That
 * one cycled six hardcoded entries — "Priya in Baneshwor booked a cleaning 3
 * minutes ago", named individuals, real wards, a timestamp that never moved, and
 * not one real booking behind any of it. `recentActivity()` is the same idea with
 * the lying taken out.
 *
 * FOUR THINGS IT WILL NOT SAY, and the select in `lib/data/activity.ts` is where
 * three of them are enforced rather than here: no surname, no ward, no amount, no
 * time closer than an hour. "Anita in Baneshwor" narrows somebody to a few
 * hundred households; "Anita in Kathmandu" does not. The predecessor could name
 * wards precisely because nobody in it existed.
 *
 * IT RENDERS NOTHING BELOW THE FLOOR, and nothing on a failed read — both arrive
 * here as an empty array, which is deliberate. One entry would read as "this is
 * all that has ever happened here", and a failed read must never render as a
 * measured zero. Today production has five eligible jobs against a floor of
 * eight, so this component returns null on the live site and turns itself on when
 * the eighth arrives.
 *
 * STATIC, AND A SERVER COMPONENT. The ticker was `"use client"` with an interval,
 * a reduced-motion listener and four pieces of state on the landing page, and its
 * four-second advance was half of what implied volume. This ships no JavaScript:
 * the only motion is the entrance `Reveal` every band on this page already has.
 *
 * BELOW THE CATEGORIES, NOT BESIDE THE PROMISE STRIP. A band that appears and
 * disappears above the fold moves the hero, and `check:paint` exists because
 * content above the fold has been hidden twice.
 */
export async function ActivityStrip({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return null;

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("home.activity");

  /*
   * A SLUG WE NO LONGER SELL RENDERS NOTHING, never its own slug. The data layer
   * cannot make this check — it reads what the bookings say, and a category can
   * be retired after a job is finished — so it is made here, where the copy is.
   */
  const lines = entries.flatMap((entry) => {
    const category = SERVICE_CATEGORIES.find((c) => c.slug === entry.categorySlug);
    if (!category) return [];
    return [{ entry, trade: categoryCopy(category, locale).name }];
  });

  if (lines.length === 0) return null;

  return (
    <div className="border-y border-border bg-card/40">
      <Reveal className="container py-8 sm:py-10">
        <h2 className="text-overline uppercase text-gold-ink">{t("title")}</h2>

        <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map(({ entry, trade }, i) => (
            <li
              key={`${entry.name}-${entry.categorySlug}-${i}`}
              className="flex items-baseline gap-2.5 text-body-sm text-muted-foreground"
            >
              <Check
                aria-hidden="true"
                className="size-3.5 shrink-0 translate-y-0.5 text-primary"
              />
              <p>
                {t("entry", {
                  name: entry.name,
                  city: entry.city,
                  trade,
                  // Latin digits, as every other interpolated count in the
                  // product is: `n` is pre-formatted per CLAUDE.md, and the
                  // Devanagari numerals it allows in prose are authored into
                  // message strings, never interpolated.
                  n: String(entry.hoursAgo),
                  count: entry.hoursAgo,
                })}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
