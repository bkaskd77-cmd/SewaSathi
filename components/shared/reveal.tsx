"use client";

import * as React from "react";

import { useInView } from "@/lib/hooks/use-in-view";
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
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn("reveal", inView && "is-revealed", className)}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
