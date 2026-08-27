"use client";

import * as React from "react";

/**
 * Route transition for the auth flow.
 *
 * A `template` remounts on every navigation (unlike a `layout`, which is
 * preserved), so the CSS entrance below runs each time — /login to /verify to
 * /onboarding reads as one flow moving forward rather than three hard cuts.
 *
 * It runs on client navigations only. The entrance starts at `opacity: 0`, and
 * on a cold load every one of these pages lives inside this wrapper — so
 * animating the first paint means the browser has nothing contentful to paint
 * and first-contentful-paint never fires. Measured: no FCP at all on /login,
 * and Lighthouse scored it 0. Same rule as the hero — never let an animation
 * own whether content is visible.
 *
 * The module-level flag is deliberate. It is false during SSR and during
 * hydration, so the server and client agree on "no class"; the effect flips it
 * once, and every template mounted after that is a real navigation.
 */
let hasMountedOnce = false;

export default function AuthTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [animate] = React.useState(() => hasMountedOnce);

  React.useEffect(() => {
    hasMountedOnce = true;
  }, []);

  return (
    <div className={animate ? "animate-route-in" : undefined}>{children}</div>
  );
}
