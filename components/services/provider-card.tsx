import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, Clock, MapPin, Star } from "lucide-react";

import { ProviderAvatar } from "@/components/services/provider-avatar";
import { ViewTransitionLink } from "@/components/shared/view-transition-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { areaShortLabel } from "@/lib/config/areas";
import type { Provider } from "@/lib/data/providers";
import { isNewProvider } from "@/lib/data/ranking";
import { bookingHref } from "@/lib/routes/booking";
import { cn, formatNpr } from "@/lib/utils";

/**
 * One professional in the list.
 *
 * This card is where the decision actually happens, so it carries the trust
 * signals in the order people scan them: who, are they checked, what do others
 * say, how much have they done, how fast do they reply, where are they, can
 * they come, what does it start at.
 *
 * Two real actions rather than a card-wide link — "book" and "read more about
 * them" are different intents, and a wrapping anchor would make the whole card
 * one keyboard stop with no way to reach the second.
 */

const AVAILABILITY_VARIANT = {
  now: "urgent" as const,
  today: "info" as const,
  scheduled: "muted" as const,
};

export function ProviderCard({
  provider,
  categorySlug,
  urgency,
  q,
  index = 0,
}: {
  provider: Provider;
  categorySlug: string;
  urgency?: string | null;
  /** What they typed into the hero, carried through so the profile keeps it. */
  q?: string | null;
  index?: number;
}) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;

  // The context follows the customer. Losing "this is an emergency" on the way
  // to a profile means the booking that starts there has forgotten it too.
  const profileParams = new URLSearchParams();
  if (urgency) profileParams.set("urgency", urgency);
  if (q) profileParams.set("q", q);
  const profileHref = `/services/${categorySlug}/${provider.id}${
    profileParams.toString() ? `?${profileParams.toString()}` : ""
  }`;
  const { stats } = provider;

  /*
   * WHAT "NEW" LOOKS LIKE, AND WHY IT IS NOT A ZERO.
   *
   * A professional with no history had a card reading 0.0 (0) beside "jobs
   * done: 0" and "responds in: 120 minutes". The first is the damaging one —
   * it reads as *rated zero out of five*, which is strictly worse than saying
   * nothing, and it was never a rating at all but the absence of one. The
   * third is worse still: 120 is the column default, so the card printed a
   * guess in the same typeface as a measurement.
   *
   * So each cell is gated on its own data rather than on one flag. Nothing is
   * invented to fill a gap, and the badge says plainly what the gaps mean —
   * a stranger is easier to trust when the product is honest about not knowing
   * them yet than when it pads the card with zeros.
   */
  const newHere = isNewProvider(stats.jobsCompleted);
  const rated = stats.ratingCount > 0;
  const measuredResponse = stats.jobsCompleted > 0;

  return (
    <Card
      data-testid="provider-card"
      className={cn(
        "animate-rise flex flex-col gap-4 p-5 transition-shadow",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background hover:shadow-md",
      )}
      // Capped so a long list does not crawl in from the bottom.
      style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
    >
      <div className="flex items-start gap-4">
        {/* Morphs into the larger avatar on the profile. See
            components/shared/view-transition-link.tsx. */}
        <ProviderAvatar
          name={provider.displayName}
          photoUrl={provider.photoUrl}
          className="vt-name"
          style={
            {
              "--vt-name": `provider-avatar-${provider.id}`,
            } as React.CSSProperties
          }
        />

        <div className="min-w-0 flex-1">
          <h3
            className="vt-name truncate font-display text-display-sm"
            style={
              {
                "--vt-name": `provider-name-${provider.id}`,
              } as React.CSSProperties
            }
          >
            {provider.displayName}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" className="size-3.5" />
              {provider.serviceAreas
                .slice(0, 2)
                .map((key) => areaShortLabel(key, locale))
                .join(" · ")}
            </span>
            {provider.serviceAreas.length > 2 ? (
              <span>
                {t("card.more", {
                  n: String(provider.serviceAreas.length - 2),
                })}
              </span>
            ) : null}
          </p>
        </div>

        <div className="text-right">
          <p className="font-display text-lg font-bold tabular-nums">
            {formatNpr(provider.baseRate, { locale })}
          </p>
          <p className="text-caption text-muted-foreground">{tc("from")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {provider.isVerified ? (
          <Badge variant="verified">
            <BadgeCheck aria-hidden="true" />
            {t("card.idVerified")}
          </Badge>
        ) : (
          <Badge variant="muted">{t("card.verificationInProgress")}</Badge>
        )}
        <Badge variant={AVAILABILITY_VARIANT[provider.availability]}>
          <Clock aria-hidden="true" />
          {t(`availability.${provider.availability}`)}
        </Badge>
        {newHere ? (
          <Badge variant="info">{t("card.new")}</Badge>
        ) : null}
        {provider.yearsExperience >= 10 ? (
          <Badge variant="gold-subtle">
            {t("card.yearsExperience", {
              n: String(provider.yearsExperience),
            })}
          </Badge>
        ) : null}
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4">
        <div>
          <dt className="text-overline uppercase text-muted-foreground">
            {t("card.rating")}
          </dt>
          {rated ? (
            <dd className="mt-0.5 flex items-center gap-1 font-display text-lg font-semibold tabular-nums">
              <Star aria-hidden="true" className="size-4 fill-gold text-gold" />
              {stats.ratingAvg.toFixed(1)}
              <span className="text-caption font-normal text-muted-foreground">
                ({stats.ratingCount})
              </span>
            </dd>
          ) : (
            <dd className="mt-0.5 text-body-sm text-muted-foreground">
              {t("card.notRated")}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-overline uppercase text-muted-foreground">
            {stats.jobsCompleted > 0
              ? t("card.jobsDone")
              : t("card.experience")}
          </dt>
          <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
            {stats.jobsCompleted > 0
              ? stats.jobsCompleted
              : t("card.years", { n: String(provider.yearsExperience) })}
          </dd>
        </div>
        {/* No jobs, no replies to measure. The 120-minute column default is a
            guess and printing it beside two measurements would launder it
            into one. */}
        {measuredResponse ? (
          <div>
            <dt className="text-overline uppercase text-muted-foreground">
              {t("card.respondsIn")}
            </dt>
            <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
              {t("card.minutes", { n: String(stats.avgResponseMinutes) })}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button variant="gold" asChild className="btn-tactile">
          {/* prefetch={false}: /book is protected, so for a signed-out visitor
              Next would prefetch a redirect to /login on every card in view. */}
          <Link
            prefetch={false}
            href={bookingHref({
              category: categorySlug,
              providerId: provider.id,
              urgency,
              q,
            })}
          >
            {t("card.book", { name: provider.displayName.split(" ")[0] })}
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <ViewTransitionLink href={profileHref}>
            {t("card.viewProfile")}
          </ViewTransitionLink>
        </Button>
      </div>
    </Card>
  );
}
