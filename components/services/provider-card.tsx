import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, Clock, MapPin, Star } from "lucide-react";

import { ProviderAvatar } from "@/components/services/provider-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { areaShortLabel } from "@/lib/config/areas";
import type { Provider } from "@/lib/data/providers";
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
        <ProviderAvatar
          name={provider.displayName}
          photoUrl={provider.photoUrl}
        />

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-display-sm">
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
          <dd className="mt-0.5 flex items-center gap-1 font-display text-lg font-semibold tabular-nums">
            <Star aria-hidden="true" className="size-4 fill-gold text-gold" />
            {stats.ratingAvg.toFixed(1)}
            <span className="text-caption font-normal text-muted-foreground">
              ({stats.ratingCount})
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-overline uppercase text-muted-foreground">
            {t("card.jobsDone")}
          </dt>
          <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
            {stats.jobsCompleted}
          </dd>
        </div>
        <div>
          <dt className="text-overline uppercase text-muted-foreground">
            {t("card.respondsIn")}
          </dt>
          <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
            {t("card.minutes", { n: String(stats.avgResponseMinutes) })}
          </dd>
        </div>
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
          <Link href={profileHref}>{t("card.viewProfile")}</Link>
        </Button>
      </div>
    </Card>
  );
}
