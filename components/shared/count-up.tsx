"use client";

import * as React from "react";

import { useInView } from "@/lib/hooks/use-in-view";

/**
 * Counts a number up when it scrolls into view.
 *
 * The final value is rendered on the server, so the real figure is in the HTML
 * for search engines, screen readers and anyone whose bundle never arrives —
 * the animation only ever replaces text that was already correct.
 *
 * `prefers-reduced-motion` skips straight to the end value.
 */
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  durationMs = 900,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const final = value.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const [display, setDisplay] = React.useState(final);

  React.useEffect(() => {
    if (!inView) return;

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    if (reduced) {
      setDisplay(final);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // easeOutCubic — fast first, settles rather than stopping dead.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(
        (value * eased).toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
      );
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, decimals, durationMs, final]);

  return (
    <span ref={ref} className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}
