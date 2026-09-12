import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/booking/status-badge";
import { Link } from "@/i18n/navigation";
import type { BookingStatus } from "@/lib/booking";
import { cn } from "@/lib/utils";

/**
 * One booking on the dashboard, at one of two weights.
 *
 * THE WEIGHT IS THE WHOLE POINT. Every booking used to be the same card, so a
 * professional on the way looked exactly like a job finished in June. `live`
 * gets the emerald edge, the professional's name and the time; `past` is
 * quiet, smaller, and carries only what somebody scanning for a receipt needs.
 *
 * A SERVER COMPONENT. The entire dashboard is links, so it ships no JavaScript
 * at all — which is the reason a customer on a patchy connection can still see
 * whether anybody is coming.
 */
export function BookingRow({
  href,
  categoryName,
  status,
  description,
  reference,
  amountLabel,
  providerName,
  whenLabel,
  note,
  tone = "past",
  index = 0,
}: {
  href: string;
  categoryName: string;
  status: BookingStatus;
  description: string;
  reference: string;
  amountLabel: string;
  /** Only on a live booking, and only once somebody has accepted it. */
  providerName?: string | null;
  whenLabel?: string | null;
  /** Something that changed since they last looked. */
  note?: string | null;
  tone?: "live" | "past";
  index?: number;
}) {
  const live = tone === "live";

  return (
    <li style={{ ["--i" as string]: index }}>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-4 rounded-xl border bg-card transition-all duration-200",
          "hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          live
            ? "border-primary/30 p-4 shadow-sm sm:p-5"
            : "border-border p-3 sm:p-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "font-semibold",
                live ? "text-body-md" : "text-body-sm",
              )}
            >
              {categoryName}
            </span>
            <StatusBadge status={status} />
            {note ? (
              <span className="animate-pop-in inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-primary"
                />
                {note}
              </span>
            ) : null}
          </div>

          {/* The sentence a live booking is actually about: who, and when.
              Above the description, because somebody checking on a job in
              flight already knows what they asked for. */}
          {live && (providerName || whenLabel) ? (
            <p className="mt-1 text-body-sm font-medium text-foreground">
              {[providerName, whenLabel].filter(Boolean).join(" · ")}
            </p>
          ) : null}

          <p
            className={cn(
              "mt-1 truncate text-muted-foreground",
              live ? "text-body-sm" : "text-caption",
            )}
          >
            {description}
          </p>

          <p className="mt-1 text-caption tabular-nums text-muted-foreground">
            {reference} · {amountLabel}
          </p>
        </div>

        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Link>
    </li>
  );
}
