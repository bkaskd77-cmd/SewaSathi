import { readDataSources } from "@/lib/data/source";
import { cn } from "@/lib/utils";

/**
 * Which path served this page's data — the database, or the built-in seed.
 *
 * Every read in lib/data falls back to the seed JSON when a query fails, and
 * the seed holds the same rows the tables do. That is deliberate (the product
 * stays up) and it is also a blind spot: a broken query renders a page that
 * looks perfect. This says which one it was.
 *
 * Hidden from ordinary visitors — development, or `?debug=data` on any
 * deployment, same rule as the triage badge. Nothing here is secret; it is a
 * word about where a row came from.
 */
export function DataSourceBadge({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  const sources = readDataSources();
  const rows = (Object.keys(sources) as Array<keyof typeof sources>).filter(
    (key) => sources[key] !== "unread",
  );

  if (rows.length === 0) return null;

  const anySeed = rows.some((key) => sources[key] === "seed");

  return (
    <p
      data-testid="data-source"
      className={cn(
        "animate-pop-in mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-border pt-3 text-caption",
        anySeed ? "text-warning-ink" : "text-muted-foreground",
      )}
    >
      <span className="font-semibold uppercase tracking-wide">dev</span>
      {rows.map((key) => (
        <span key={key}>
          {key}: <strong className="font-semibold">{sources[key]}</strong>
        </span>
      ))}
    </p>
  );
}

/** `?debug=data`, or any non-production build. */
export function dataDebugEnabled(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const value = searchParams.debug;
  const debug = Array.isArray(value) ? value[0] : value;
  return debug === "data";
}
