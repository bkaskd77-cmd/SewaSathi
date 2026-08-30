"use client";

import { useTranslations } from "next-intl";

import { FLOW_STEPS, type FlowStep } from "@/lib/booking";
import { cn } from "@/lib/utils";

/**
 * Where you are in the booking, and how much is left.
 *
 * The bar animates its width rather than jumping, because the width *is* the
 * message: a jump reads as the page re-rendering, a slide reads as progress.
 *
 * The step names are hidden on small screens and the count carries it instead
 * — five labels on a 360px phone wrap into three lines and push the actual
 * form below the fold.
 */
export function BookingProgress({
  current,
  onJump,
  reachable,
}: {
  current: FlowStep;
  /** Undefined disables jumping — used while the booking is submitting. */
  onJump?: (step: FlowStep) => void;
  reachable: (step: FlowStep) => boolean;
}) {
  const t = useTranslations("booking.flow");
  const index = FLOW_STEPS.indexOf(current);
  const percent = ((index + 1) / FLOW_STEPS.length) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-overline uppercase text-muted-foreground">
          {t("stepCount", {
            n: String(index + 1),
            total: String(FLOW_STEPS.length),
          })}
        </p>
        <p className="text-body-sm font-semibold">{t(`steps.${current}`)}</p>
      </div>

      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={FLOW_STEPS.length}
        aria-valuenow={index + 1}
        aria-label={t("progressLabel")}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Named steps, for the room to show them. Completed ones are links back. */}
      <ol className="mt-3 hidden gap-1 sm:flex">
        {FLOW_STEPS.map((step, i) => {
          const done = i < index;
          const isCurrent = step === current;
          const canJump = Boolean(onJump) && (done || reachable(step));

          return (
            <li key={step} className="flex-1">
              <button
                type="button"
                disabled={!canJump || isCurrent}
                onClick={() => onJump?.(step)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "w-full truncate rounded px-1 py-0.5 text-left text-caption transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isCurrent && "font-semibold text-foreground",
                  !isCurrent && done && "text-muted-foreground hover:text-foreground",
                  !isCurrent && !done && "text-muted-foreground/60",
                  canJump && !isCurrent && "cursor-pointer",
                )}
              >
                {t(`steps.${step}`)}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
