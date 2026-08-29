"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { areasByCity } from "@/lib/config/areas";
import { cn, formatNpr } from "@/lib/utils";

/**
 * Filters, kept in the URL.
 *
 * Everything here writes to the query string and nothing to component state,
 * so a filtered list is a link: shareable, bookmarkable, survives a refresh
 * and a back button, and the server renders exactly what the URL asks for.
 * That also means the list itself stays a Server Component — the only
 * JavaScript on this page is the twenty lines below.
 */

const AVAILABILITY_OPTIONS = [
  { value: "", key: "anyTime" },
  { value: "now", key: "availableNow" },
  { value: "today", key: "today" },
] as const;

/** The number is the filter and the label; only "and up" is translated. */
const RATING_OPTIONS = ["4.0", "4.5", "4.8"];

const SORT_OPTIONS = [
  { value: "", key: "sortRelevance" },
  { value: "rating", key: "sortRating" },
  { value: "price", key: "sortPrice" },
  { value: "jobs", key: "sortJobs" },
] as const;

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-body-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ProviderFilters({
  priceBand,
}: {
  /** The category's published band — the price tiers are cut from it. */
  priceBand: { low: number; high: number };
}) {
  const t = useTranslations("services.filters");
  const tWard = useTranslations("services");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Two tiers cut from the category's own band, so "under Rs 2,000" means
  // something for plumbing and something else for painting.
  const tiers = React.useMemo(() => {
    const span = priceBand.high - priceBand.low;
    const round = (n: number) => Math.round(n / 100) * 100;
    return [
      round(priceBand.low + span * 0.25),
      round(priceBand.low + span * 0.6),
    ];
  }, [priceBand]);

  const set = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const query = params.toString();
      // `scroll: false` — changing a filter should not throw you back to the
      // top of a list you were halfway down.
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const value = (key: string) => searchParams.get(key) ?? "";

  // `q` and `urgency` come from triage and are context, not filters — clearing
  // the filters must not lose what the person originally said.
  const activeCount = ["area", "availability", "verified", "rating", "maxRate"]
    .map((key) => (searchParams.get(key) ? 1 : 0))
    .reduce((a: number, b: number) => a + b, 0);

  const clear = () => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of [
      "area",
      "availability",
      "verified",
      "rating",
      "maxRate",
    ]) {
      params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <section
      aria-label={t("region")}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-body-sm font-semibold">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          {t("heading")}
          {activeCount > 0 ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </p>

        {/* The count lives with the list, inside Suspense — asking for it here
            would make the page await the query and the skeletons would never
            get a chance to show. */}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label
            htmlFor="filter-area"
            className="text-overline uppercase text-muted-foreground"
          >
            {t("area")}
          </label>
          <select
            id="filter-area"
            className={cn(selectClass, "mt-1")}
            value={value("area")}
            onChange={(event) => set("area", event.target.value)}
          >
            <option value="">{t("anywhere")}</option>
            {areasByCity(locale).map((group) => (
              <optgroup key={group.city} label={group.city}>
                {group.areas.map((area) => (
                  <option key={area.key} value={area.key}>
                    {tWard("ward", { n: String(area.wardNumber) })} —{" "}
                    {locale === "ne" ? area.nameNe : area.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-availability"
            className="text-overline uppercase text-muted-foreground"
          >
            {t("availability")}
          </label>
          <select
            id="filter-availability"
            className={cn(selectClass, "mt-1")}
            value={value("availability")}
            onChange={(event) => set("availability", event.target.value)}
          >
            {AVAILABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-rating"
            className="text-overline uppercase text-muted-foreground"
          >
            {t("rating")}
          </label>
          <select
            id="filter-rating"
            className={cn(selectClass, "mt-1")}
            value={value("rating")}
            onChange={(event) => set("rating", event.target.value)}
          >
            <option value="">{t("anyRating")}</option>
            {RATING_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t("ratingFrom", { value })}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-price"
            className="text-overline uppercase text-muted-foreground"
          >
            {t("startingPrice")}
          </label>
          <select
            id="filter-price"
            className={cn(selectClass, "mt-1")}
            value={value("maxRate")}
            onChange={(event) => set("maxRate", event.target.value)}
          >
            <option value="">{t("anyPrice")}</option>
            {tiers.map((tier) => (
              <option key={tier} value={String(tier)}>
                {t("upTo", { price: formatNpr(tier, { locale }) })}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-sort"
            className="text-overline uppercase text-muted-foreground"
          >
            {t("sortBy")}
          </label>
          <select
            id="filter-sort"
            className={cn(selectClass, "mt-1")}
            value={value("sort")}
            onChange={(event) => set("sort", event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex h-10 cursor-pointer items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={value("verified") === "1"}
              onChange={(event) =>
                set("verified", event.target.checked ? "1" : "")
              }
              className="size-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {t("verifiedOnly")}
          </label>

          {activeCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <X aria-hidden="true" />
              {t("clear")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
