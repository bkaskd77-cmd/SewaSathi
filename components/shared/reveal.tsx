"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Scroll-into-view entrance.
 *
 * Built on CSS plus one IntersectionObserver rather than a motion library, for
 * one reason that matters here: a motion component renders `opacity: 0` into
 * the server HTML, so every section below the hero stays invisible until the
 * JavaScript bundle lands. On a mid-range Android over a patchy connection
 * that is a blank page. See `.reveal` in styles/globals.css — the default
 * state is visible, and only JS opts into hiding.
 *
 * Cheap enough that using it on ~20 nodes costs nothing measurable.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-revealed");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
