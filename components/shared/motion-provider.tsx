"use client";

import { LazyMotion } from "framer-motion";

/**
 * Framer Motion's `motion` component pulls in every feature — gestures, drag,
 * layout projection — whether a page uses them or not, and it showed up as the
 * largest single block of script evaluation on the landing page.
 *
 * `LazyMotion` with a dynamically imported `domAnimation` loads only
 * animations and variants, and only once a page actually renders an `m`
 * component — the landing page pays nothing for it. Components under this
 * provider must use `m.div` rather than `motion.div`; `motion.div` re-adds
 * the full bundle and defeats the point.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion
      features={() => import("framer-motion").then((mod) => mod.domAnimation)}
      strict
    >
      {children}
    </LazyMotion>
  );
}
