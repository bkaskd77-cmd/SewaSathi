"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity } from "lucide-react";

import { ACTIVITY_FEED } from "@/lib/mock/activityFeed";

const INTERVAL_MS = 4000;

/**
 * Ambient proof of life above the fold.
 *
 * Auto-advances, pauses on hover and on keyboard focus. Under
 * `prefers-reduced-motion` it does not advance at all — it renders the first
 * entry and stops, which is the end state rather than a frozen transition.
 *
 * `aria-live="off"` is deliberate: this is decorative reassurance, and
 * announcing a new booking every four seconds would make the page unusable
 * with a screen reader.
 */
export function ActivityTicker() {
  const t = useTranslations("activity");
  const locale = useLocale();
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setEnabled(!query?.matches);
    if (!query) return;
    const onChange = () => setEnabled(!query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    if (!enabled || paused) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % ACTIVITY_FEED.length),
      INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [enabled, paused]);

  const entry = ACTIVITY_FEED[index];

  return (
    <div
      className="border-b border-border/70"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="container flex items-center gap-2.5 py-2.5">
        <span
          aria-hidden="true"
          className="relative grid size-1.5 shrink-0 place-items-center rounded-full bg-success"
        >
          <span className="animate-live-pulse absolute inset-0 rounded-full bg-success" />
        </span>
        <Activity
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <p
          key={entry.id}
          aria-live="off"
          className="animate-ticker-in truncate text-caption text-muted-foreground"
        >
          {t(entry.actionKey, {
            name: locale === "ne" ? entry.nameNe : entry.name,
            area: locale === "ne" ? entry.areaNe : entry.area,
            minutes: String(entry.minutesAgo),
          })}
        </p>
      </div>
    </div>
  );
}
