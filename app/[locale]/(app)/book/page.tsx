import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { categoryCopy } from "@/lib/config/services";
import { getCategory } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { getSessionProfile } from "@/lib/auth/session";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("bookTitle"), robots: { index: false, follow: false } };
}

/**
 * PLACEHOLDER — Phase 6 builds the booking flow here.
 *
 * It exists now because every "Book now" in the product points at it, and a
 * primary call to action that 404s is worse than one that says "not yet".
 *
 * It also proves the piece that is easy to get wrong and hard to notice: this
 * route is protected, so a logged-out customer goes through /login and comes
 * back *here*, with the professional and the urgency they picked still in the
 * URL — not to the homepage to start again.
 */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const categorySlug = first(searchParams.category);
  const providerId = first(searchParams.provider);
  const urgency = first(searchParams.urgency);
  const q = first(searchParams.q);

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.book");
  const tc = await getTranslations("common");
  const tServices = await getTranslations("services");

  const profile = await getSessionProfile();
  if (!profile) {
    const params = new URLSearchParams();
    if (categorySlug) params.set("category", categorySlug);
    if (providerId) params.set("provider", providerId);
    if (urgency) params.set("urgency", urgency);
    if (q) params.set("q", q);
    redirect({
      href: `/login?next=${encodeURIComponent(`/book?${params.toString()}`)}`,
      locale,
    });
  }

  const [category, provider] = await Promise.all([
    categorySlug ? getCategory(categorySlug) : Promise.resolve(null),
    providerId ? getProvider(providerId) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      {category || provider ? (
        <Card
          className="animate-rise mt-6 p-5"
          style={{ animationDelay: "60ms" }}
        >
          <p className="text-overline uppercase text-muted-foreground">
            {t("yourRequest")}
          </p>
          <dl className="mt-3 flex flex-col gap-3">
            {category ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">
                  {t("service")}
                </dt>
                <dd className="text-right text-body-md font-semibold">
                  {categoryCopy(category, locale).name}
                  <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                    {formatNpr(category.basePriceMin, { locale })}–
                    {formatNpr(category.basePriceMax, { locale })}
                  </span>
                </dd>
              </div>
            ) : null}
            {provider ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">
                  {t("professional")}
                </dt>
                <dd className="text-right text-body-md font-semibold">
                  {provider.displayName}
                </dd>
              </div>
            ) : null}
            {urgency ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">
                  {t("urgency")}
                </dt>
                <dd className="text-right">
                  <Badge variant={urgency === "emergency" ? "urgent" : "info"}>
                    {tServices.has(`urgency.${urgency}`)
                      ? tServices(`urgency.${urgency}`)
                      : urgency}
                  </Badge>
                </dd>
              </div>
            ) : null}
            {q ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">
                  {t("whatYouToldUs")}
                </dt>
                <dd className="text-right text-body-sm">
                  &ldquo;{q.slice(0, 120)}&rdquo;
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <div className="mt-6">
        <EmptyState
          delay={0.12}
          icon={CalendarClock}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="gold" asChild className="btn-tactile">
                <a href="tel:+9779800000000">{tc("callSupport")}</a>
              </Button>
              {category ? (
                <Button variant="outline" asChild>
                  <Link href={`/services/${category.slug}`}>
                    {t("backTo", {
                      category: categoryCopy(category, locale).ctaLabel,
                    })}
                  </Link>
                </Button>
              ) : null}
            </div>
          }
        />
      </div>
    </div>
  );
}
