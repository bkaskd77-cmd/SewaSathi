"use client";

import * as React from "react";

/**
 * The entrance a `template.tsx` runs on every client navigation.
 *
 * Next remounts a template on navigation (unlike a layout, which is
 * preserved), so a CSS entrance placed here runs each time and a route change
 * reads as one flow moving forward rather than a hard cut.
 *
 * It deliberately does nothing on the first load. The entrance starts at
 * `opacity: 0`, and on a cold load every page inside the group is within this
 * wrapper — so animating the first paint leaves the browser nothing contentful
 * to paint and first-contentful-paint never fires. Measured: /login reported
 * no FCP at all and Lighthouse scored it 0. `npm run check:paint` guards it.
 *
 * The module-level flag is the mechanism. It is false during SSR and during
 * hydration, so server and client agree on "no class"; the effect flips it
 * once, and every template mounted after that is a real navigation.
 */
let hasMountedOnce = false;

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const [animate] = React.useState(() => hasMountedOnce);

  React.useEffect(() => {
    hasMountedOnce = true;
  }, []);

  return (
    <div className={animate ? "animate-route-in" : undefined}>{children}</div>
  );
}
