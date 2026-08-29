import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, Sparkles } from "lucide-react";

import { dataDebugEnabled } from "@/components/services/data-source-badge";
import { ProviderFilters } from "@/components/services/provider-filters";
import {
  ProviderList,
  ProviderListSkeleton,
} from "@/components/services/provider-list";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { areaShortLabel } from "@/lib/config/areas";
import { categoryCopy } from "@/lib/config/services";
import { getCategory } from "@/lib/data/categories";
import type { SortOption } from "@/lib/data/ranking";
import { formatNpr } from "@/lib/utils";

/**
 * One category, with the professionals in it.
 *
 * The filters live in the URL and this page renders whatever the URL says, so
 * the list itself needs no client JavaScript and a filtered view is a link
 * somebody can send to their landlord.
 *
 * `?q=` and `?urgency=` arrive from the triage card. They are reflected at the
 * top rather than silently dropped: somebody who has just typed "AC not
 * cooling, needed today" should not land on a page that acts like they said
 * nothing.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

/**
 * Filters and the triage context both live in the query string, so this page
 * is per-request by definition. Prerendering the ten slugs looked appealing
 * until you notice a prerendered page cannot read `?availability=now`.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: "meta" });
  const category = await getCategory(params.slug);
  if (!category) return { title: t("categoryNotFound") };

  const copy = categoryCopy(category, locale);
  return {
    title: t("categoryTitle", { category: copy.name }),
    description: t("categoryDescription", {
      description: copy.description,
      low: formatNpr(category.basePriceMin, { locale }),
      high: formatNpr(category.basePriceMax, { locale }),
    }),
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const category = await getCategory(params.slug);
  if (!category) notFound();

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("services");
  const copy = categoryCopy(category, locale);

  const area = first(searchParams.area);
  const availability = first(searchParams.availability);
  const rating = first(searchParams.rating);
  const maxRate = first(searchParams.maxRate);
  const sort = (first(searchParams.sort) ?? "relevance") as SortOption;
  const verified = first(searchParams.verified) === "1";
  const urgency = first(searchParams.urgency);
  const q = first(searchParams.q);

  const listParams = {
    category: category.slug,
    area,
    availability,
    verified,
    rating: rating ? Number(rating) : null,
    maxRate: maxRate ? Number(maxRate) : null,
    sort,
    urgency,
    q,
  };

  // Keep the triage context when filters are cleared — it is not a filter.
  const contextParams = new URLSearchParams();
  if (q) contextParams.set("q", q);
  if (urgency) contextParams.set("urgency", urgency);
  const clearHref = contextParams.toString()
    ? `/services/${category.slug}?${contextParams.toString()}`
    : `/services/${category.slug}`;

  // A new key remounts the Suspense boundary, so changing a filter shows the
  // skeletons again instead of freezing the old list until the new one lands.
  const listKey = JSON.stringify(listParams);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label={t("breadcrumb")} className="animate-rise">
        <ol className="flex items-center gap-1 text-caption text-muted-foreground">
          <li>
            <Link href="/services" className="hover:text-foreground">
              {t("eyebrow")}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="text-foreground">
            {copy.name}
          </li>
        </ol>
      </nav>

      <header className="animate-rise mt-4" style={{ animationDelay: "60ms" }}>
        <h1 className="text-balance font-display text-display-md">
          {copy.name}
        </h1>

        {q || urgency ? (
          // What they told us, said back to them.
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-body-sm">
            <Sparkles aria-hidden="true" className="size-4 text-gold-ink" />
            <span>
              {t("showingFor", {
                category: copy.ctaLabel,
                where: area
                  ? t("inArea", { area: areaShortLabel(area, locale) })
                  : t("nearYou"),
              })}
            </span>
            {urgency ? (
              <Badge variant={urgency === "emergency" ? "urgent" : "info"}>
                {t.has(`urgency.${urgency}`)
                  ? t(`urgency.${urgency}`)
                  : urgency}
              </Badge>
            ) : null}
            {q ? (
              <span className="text-muted-foreground">
                &ldquo;{q.slice(0, 80)}&rdquo;
              </span>
            ) : null}
          </p>
        ) : (
          <p className="mt-3 text-pretty text-body-md text-muted-foreground">
            {copy.description}
          </p>
        )}

        <p className="mt-3 text-body-sm text-muted-foreground">
          {t("typicalRangeLabel")}{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatNpr(category.basePriceMin, { locale })} –{" "}
            {formatNpr(category.basePriceMax, { locale })}
          </span>{" "}
          · {t("priceConfirmedAfter")}
        </p>
      </header>

      <div className="animate-rise mt-6" style={{ animationDelay: "120ms" }}>
        <ProviderFilters
          priceBand={{
            low: category.basePriceMin,
            high: category.basePriceMax,
          }}
        />
      </div>

      <Suspense key={listKey} fallback={<ProviderListSkeleton />}>
        <ProviderList
          params={listParams}
          clearHref={clearHref}
          debug={dataDebugEnabled(searchParams)}
        />
      </Suspense>
    </div>
  );
}
