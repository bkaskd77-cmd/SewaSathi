"use client";

import * as React from "react";
import { Languages } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Language switch.
 *
 * Visual only for now — it holds local state and nothing else. Real i18n
 * (next-intl or similar) lands in a later phase; when it does, replace the
 * `useState` with the locale router and this component's markup can stay.
 */
const LOCALES = [
  { code: "en", label: "EN", full: "English" },
  { code: "ne", label: "ने", full: "नेपाली" },
] as const;

export function LanguageToggle() {
  const [locale, setLocale] = React.useState<"en" | "ne">("en");

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5"
    >
      <Languages
        aria-hidden="true"
        className="ml-1.5 size-3.5 text-muted-foreground"
      />
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={locale === l.code}
          aria-label={l.full}
          onClick={() => setLocale(l.code)}
          className={cn(
            "rounded-full px-2.5 py-1 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            locale === l.code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
