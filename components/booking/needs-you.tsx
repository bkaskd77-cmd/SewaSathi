import { ArrowRight, CircleAlert } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The one thing on this page that is not a list.
 *
 * WHAT A DASHBOARD OWES SOMEBODY IS AN ANSWER BEFORE AN INVENTORY. The old
 * page was a stack of cards newest-first, which answered "what have I booked"
 * and never answered "does anything need me". The difference is not cosmetic:
 * a booking waiting on a trip confirmation is a job that never happens, and it
 * sat in that stack looking exactly like one that was proceeding.
 *
 * NOT A WARNING COLOUR, deliberately, with one exception. Most of what lands
 * here is ordinary business — agree a price, pay for finished work — and
 * painting it red teaches somebody that their own bookings are a hazard.
 * `blocking` is the exception and it earns it: nothing is moving and they
 * cannot tell.
 *
 * IT POINTS AT THE BOOKING RATHER THAN REPLACING IT. Each row is one line and
 * a link; the booking itself still appears in its own section below. Lifting
 * cards out of the list would empty the live section while a job was in
 * flight, which is a stranger thing to explain than a signpost.
 */
export type NeedsYouItem = {
  bookingId: string;
  /** Already written in the reader's language by the page. */
  label: string;
  context: string;
  blocking: boolean;
};

export function NeedsYou({
  heading,
  items,
}: {
  heading: string;
  items: NeedsYouItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="animate-rise mt-8 rounded-xl border border-gold/40 bg-gold/5 p-4 sm:p-5"
      aria-labelledby="needs-you"
    >
      <h2
        id="needs-you"
        className="flex items-center gap-2 text-body-sm font-semibold text-foreground"
      >
        <CircleAlert aria-hidden="true" className="size-4 text-gold-ink" />
        {heading}
      </h2>

      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={`${item.bookingId}-${item.label}`}>
            <Link
              href={`/bookings/${item.bookingId}`}
              className={cn(
                "group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-all duration-200",
                "hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                item.blocking ? "border-gold/50" : "border-border",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-semibold text-foreground">
                  {item.label}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {item.context}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
