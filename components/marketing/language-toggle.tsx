"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Languages } from "lucide-react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Language switch.
 *
 * It navigates. Before the next-intl migration it wrote a cookie and called
 * `router.refresh()`, which changed the words on the page but not the URL — so
 * a Nepali page could not be shared, bookmarked, or indexed, and a back button
 * took you to the same URL rendering a different language.
 *
 * `usePathname` from @/i18n/navigation returns the path *without* the locale
 * prefix, so pushing the same path under the other locale is the whole switch.
 * The query string is carried by hand: filters and triage context live there,
 * and dropping them would reset a filtered list to unfiltered on a language
 * change.
 *
 * Optimistic: the button state changes on tap and the server catches up.
 * Waiting for a round trip to highlight a two-item toggle feels broken on a
 * slow connection.
 */
const LABELS: Record<Locale, { short: string; full: string }> = {
  en: { short: "EN", full: "English" },
  ne: { short: "ने", full: "नेपाली" },
};

export function LanguageToggle() {
  const active = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("common");

  const [selected, setSelected] = React.useState<Locale>(active);
  React.useEffect(() => setSelected(active), [active]);

  const choose = (next: Locale) => {
    if (next === active) return;
    setSelected(next);
    const query = searchParams.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { locale: next });
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5"
    >
      <Languages
        aria-hidden="true"
        className="ml-1.5 size-3.5 text-muted-foreground"
      />
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={selected === code}
          aria-label={LABELS[code].full}
          lang={code}
          onClick={() => choose(code)}
          className={cn(
            "rounded-full px-2.5 py-1 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            selected === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[code].short}
        </button>
      ))}
    </div>
  );
}
