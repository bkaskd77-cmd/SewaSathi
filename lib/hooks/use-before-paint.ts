"use client";

import * as React from "react";

/**
 * A layout effect that is safe to render on the server.
 *
 * `useLayoutEffect` runs before the browser paints, which is the whole point
 * when the effect exists to correct something the reader would otherwise see
 * being corrected. React warns when it is used during server rendering,
 * because there is no layout to read on a server — so on the server this is an
 * ordinary effect, which never runs there anyway.
 *
 * USE IT ONLY FOR "THE FIRST PAINT WOULD BE WRONG WITHOUT THIS". It blocks
 * painting, so anything that can wait should be a normal `useEffect`. The case
 * it was written for is the site header: it keeps its state across a route
 * change, so after a navigation it briefly shows the scroll state of the page
 * you just left.
 */
export const useBeforePaint =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
