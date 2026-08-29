"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", key: "themeLight", Icon: Sun },
  { value: "system", key: "themeSystem", Icon: Monitor },
  { value: "dark", key: "themeDark", Icon: Moon },
] as const;

/**
 * Segmented light / system / dark switch.
 *
 * Rendered as a plain shell until mounted: the resolved theme is only known in
 * the browser, so highlighting a segment during SSR would flash the wrong one.
 */
export function ThemeToggle() {
  const t = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label={t("colourTheme")}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm"
    >
      {OPTIONS.map(({ value, key, Icon }) => {
        const active = mounted && theme === value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(key)}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
