"use client";

import { LazyMotion } from "framer-motion";

/**
 * Framer Motion's `motion` component pulls in every feature — gestures, drag,
 * layout projection — whether a page uses them or not, and it showed up as the
 * largest single block of script evaluation on the landing page.
 *
 * `LazyMotion` with a dynamically imported `domAnimation` loads only
 * animations and variants — but it fetches them when the provider *mounts*,
 * not when an `m` component first renders. Mounting this in the root layout
 * therefore shipped 51 KB of motion code to the landing page, which uses none
 * of it (46 KB of that measured as unused). So mount it per-page, around the
 * subtree that actually animates, never globally.
 *
 * Components under this provider must use `m.div` rather than `motion.div`;
 * `motion.div` re-adds the full bundle and defeats the point.
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
