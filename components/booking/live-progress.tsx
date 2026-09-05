"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useRouter } from "@/i18n/navigation";
import { BOOKING_PROGRESS, progressIndex, type BookingStatus } from "@/lib/booking";
import { useBookingChannel } from "@/lib/hooks/use-booking-channel";
import { cn } from "@/lib/utils";

/**
 * Where the job has got to, updating without a refresh.
 *
 * MOTION IS THE POINT HERE, not decoration. A status arriving by swapping one
 * label for another reads as a glitch — the eye cannot tell whether it moved
 * forward or the page simply re-rendered. So the track has a single fill that
 * *travels* between steps, over 600ms, and the step that has just been reached
 * pulses once. Progression, not replacement.
 *
 * When the connection is up, nothing says so. A permanent "live" badge is
 * noise, and the Nepali for it belongs to television broadcasts. The only time
 * the connection is mentioned is when it is *down*, because then the page is
 * showing something that may be stale and the reader deserves to know.
 */
export function LiveProgress({
  bookingId,
  initialStatus,
  settled,
  released,
}: {
  bookingId: string;
  initialStatus: BookingStatus;
  /** Whether the money has actually arrived — not the same as work finished. */
  settled: boolean;
  /**
   * Whether a professional has refused this job, rather than none having taken
   * it yet. Both are `pending`; they are not remotely the same news, and a
   * banner that says "we are alerting professionals" to somebody whose
   * professional just pulled out is the product hiding from them.
   */
  released?: boolean;
}) {
  const t = useTranslations("booking");
  const router = useRouter();

  // A status change moves more than this component: the provider's contact
  // card appears at accepted, the payment panel changes at completed. Both are
  // server-rendered, so the page has to be re-read.
  const [checking, setChecking] = React.useState(false);

  const { status, connection } = useBookingChannel(
    bookingId,
    initialStatus,
    React.useCallback(() => router.refresh(), [router]),
  );

  const ended = status === "cancelled" || status === "no_provider_found";
  const index = progressIndex(status);

  // The fill's width, as a fraction of the track. Centre-to-centre so it lands
  // on the step's own marker rather than past it.
  const fill =
    index <= 0
      ? 0
      : (index / (BOOKING_PROGRESS.length - 1)) * 100;

  return (
    <div>
      {/* What happens next, in words. A badge alone tells nobody what to do. */}
      <div
        key={status}
        className="animate-pop-in mt-6 rounded-xl border border-primary/25 bg-primary/[0.05] p-4"
      >
        <p className="text-body-sm font-semibold text-primary">
          {status === "pending" && released
            ? t("status.released")
            : t(`status.${status}`)}
        </p>
        <p className="mt-1 text-body-md">
          {/* "Completed" is about the work; being paid is a separate machine —
              a booking can be finished and unpaid, which for cash is the normal
              case. The banner has to read both or it contradicts the payment
              panel directly below it. */}
          {status === "completed" && settled
            ? t("whatNext.completedPaid")
            : status === "pending" && released
              ? t("whatNext.releasedPending")
              : t(`whatNext.${status}`)}
        </p>

        {/* Waiting is the one state where the customer has something useful to
            do, and it is not "wait harder". This runs the same escalation the
            cron runs — see lib/data/dispatch.ts — so if their professional's
            window has lapsed the job widens to everybody who can do it, right
            now, rather than at tomorrow's sweep. Tapping it early is harmless:
            the stage comes from timestamps, so nothing moves before it is due. */}
        {status === "pending" && !released ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void (async () => {
                try {
                  const { checkForProviderAction } = await import(
                    "@/app/[locale]/(app)/bookings/[id]/actions"
                  );
                  await checkForProviderAction(bookingId);
                  router.refresh();
                } finally {
                  setChecking(false);
                }
              })();
            }}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn("size-3.5", checking && "animate-spin")}
            />
            {t("detail.checkForProvider")}
          </Button>
        ) : null}
      </div>

      {/* Cancelled and no-provider are ends, not stages, so the track is
          hidden rather than shown frozen part-way. */}
      {!ended ? (
        <div className="animate-rise mt-6" style={{ animationDelay: "120ms" }}>
          <div
            className="relative"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={BOOKING_PROGRESS.length - 1}
            aria-valuenow={Math.max(index, 0)}
            aria-valuetext={t(`status.${status}`)}
            aria-label={t("detail.progressLabel")}
          >
            {/* One rail, one travelling fill. Two separate elements rather than
                per-step colouring, so the movement is continuous. */}
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-[600ms] ease-out motion-reduce:transition-none"
                style={{ width: `${fill}%` }}
              />
            </div>

            <ol className="mt-1.5 flex gap-1">
              {BOOKING_PROGRESS.map((step, i) => {
                const reached = i <= index;
                const current = i === index;
                return (
                  <li key={step} className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-caption transition-colors duration-300",
                        current
                          ? "animate-advance font-semibold text-foreground"
                          : reached
                            ? "text-muted-foreground"
                            : "text-muted-foreground/60",
                      )}
                    >
                      {t(`status.${step}`)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Only ever shown when the page might be stale. */}
          {connection === "offline" || connection === "unavailable" ? (
            <p className="animate-pop-in mt-3 flex items-center gap-1.5 text-caption text-muted-foreground">
              <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
              {connection === "offline"
                ? t("detail.reconnecting")
                : t("detail.notLive")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
