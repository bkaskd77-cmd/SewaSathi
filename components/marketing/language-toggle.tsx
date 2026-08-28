"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";

import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

/**
 * Language switch.
 *
 * Writes a cookie and refreshes, so the server re-renders with the chosen
 * language. Today that changes category names and nothing else — the rest of
 * the interface is still English until we pick a translation approach (see
 * CLAUDE.md). Doing it this way rather than with a locale router means the
 * decision stays open: when it is made, this component's markup survives and
 * only the handler changes.
 *
 * A cookie rather than local state because the strings are rendered on the
 * server. A year is fine — it is a preference, not a session.
 */
const LOCALES: Array<{ code: Locale; label: string; full: string }> = [
  { code: "en", label: "EN", full: "English" },
  { code: "ne", label: "ने", full: "नेपाली" },
];

export function LanguageToggle({ locale = "en" }: { locale?: Locale }) {
  const router = useRouter();
  // Optimistic: the button state changes on tap, the server catches up on the
  // refresh. Waiting for a round trip to highlight a two-item toggle feels
  // broken on a slow connection.
  const [selected, setSelected] = React.useState<Locale>(locale);

  React.useEffect(() => setSelected(locale), [locale]);

  const choose = (next: Locale) => {
    setSelected(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

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
          aria-checked={selected === l.code}
          aria-label={l.full}
          lang={l.code}
          onClick={() => choose(l.code)}
          className={cn(
            "rounded-full px-2.5 py-1 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            selected === l.code
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
