"use client";

import * as React from "react";

/**
 * Fires once when the element first scrolls into view.
 *
 * One observer implementation shared by <Reveal> and <CountUp> — they used to
 * be the same eight lines twice, and a second copy is how the two drift apart.
 */
export function useInView<T extends Element>(
  options: IntersectionObserverInit = {
    threshold: 0.12,
    rootMargin: "0px 0px -6% 0px",
  },
) {
  const ref = React.useRef<T>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer (very old browser, or a test environment): show the end
    // state rather than leaving content stuck in its pre-reveal style.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        setInView(true);
        observer.disconnect();
      }
    }, options);

    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, inView };
}
