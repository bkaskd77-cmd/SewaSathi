import { Card } from "@/components/ui/card";

/**
 * What each services surface looks like while its data is in flight.
 *
 * These are shapes, not spinners: the same grid, the same card heights, the
 * same number of rows the real content will occupy, so nothing jumps when it
 * arrives. They are used by the `loading.tsx` beside each route, which is what
 * Next shows during a navigation to a dynamic page — every one of these routes
 * is `force-dynamic`, so without them a filter tap or a profile open sat on the
 * previous screen with no acknowledgement at all.
 */

function Line({ className, delay }: { className: string; delay?: number }) {
  return (
    <span
      aria-hidden="true"
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      className={`animate-skeleton block rounded bg-muted ${className}`}
    />
  );
}

/** The ten-category grid on /services. */
export function CategoryGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      <div className="max-w-2xl space-y-3">
        <Line className="h-4 w-20" />
        <Line className="h-9 w-80 max-w-full" delay={60} />
        <Line className="h-4 w-full max-w-xl" delay={120} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Line className="h-11 w-full sm:w-96" />
        <Line className="h-11 w-28" delay={60} />
      </div>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, index) => (
          <li key={index}>
            <Card className="flex h-full flex-col gap-3 p-5">
              <Line
                className="size-11 rounded-lg"
                delay={Math.min(index * 40, 200)}
              />
              <Line
                className="mt-1 h-6 w-40"
                delay={Math.min(index * 40, 200)}
              />
              <Line
                className="h-4 w-full"
                delay={Math.min(index * 40, 200) + 60}
              />
              <Line
                className="mt-2 h-5 w-32"
                delay={Math.min(index * 40, 200) + 120}
              />
              <Line
                className="h-3.5 w-36"
                delay={Math.min(index * 40, 200) + 160}
              />
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The header, filter bar and list on /services/[slug]. */
export function CategoryPageSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-3xl">
      <Line className="h-3.5 w-40" />
      <Line className="mt-4 h-9 w-64" delay={60} />
      <Line className="mt-3 h-4 w-full max-w-md" delay={120} />
      <Line className="mt-3 h-4 w-72" delay={160} />
      <Card className="mt-6 h-40 p-4">
        <Line className="h-5 w-24" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Line key={i} className="h-10 w-full" delay={i * 40} />
          ))}
        </div>
      </Card>
    </div>
  );
}

/** One professional's page, down to the sticky booking bar. */
export function ProviderProfileSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-3xl">
      <Line className="h-3.5 w-56" />

      <div className="mt-4 flex flex-wrap items-start gap-5">
        <Line className="size-22 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-3">
          <Line className="h-8 w-56" delay={60} />
          <Line className="h-4 w-64" delay={100} />
          <div className="flex gap-2">
            <Line className="h-6 w-28 rounded-full" delay={140} />
            <Line className="h-6 w-36 rounded-full" delay={180} />
          </div>
        </div>
      </div>

      <Card className="mt-6 flex flex-wrap gap-8 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Line className="h-3 w-16" delay={i * 50} />
            <Line className="h-6 w-12" delay={i * 50 + 40} />
          </div>
        ))}
      </Card>

      <div className="mt-6 space-y-2">
        <Line className="h-6 w-24" />
        <Line className="h-4 w-full" delay={60} />
        <Line className="h-4 w-4/5" delay={100} />
      </div>

      <div className="mt-8 space-y-2">
        <Line className="h-6 w-44" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Line key={i} className="h-16 w-full rounded-lg" delay={i * 60} />
        ))}
      </div>
    </div>
  );
}

/** Reviews stream in after the profile, so they get their own shapes. */
export function ProviderReviewsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="mt-3 flex flex-col gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index}>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <Line className="h-4 w-28" delay={index * 70} />
              <Line className="h-4 w-12" delay={index * 70 + 40} />
            </div>
            <Line className="h-4 w-full" delay={index * 70 + 80} />
            <Line className="h-3 w-24" delay={index * 70 + 120} />
          </Card>
        </li>
      ))}
    </ul>
  );
}
