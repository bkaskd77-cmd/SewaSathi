"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CUSTOMER_FLAGS } from "@/lib/reviews";
import { cn } from "@/lib/utils";

/**
 * "How was this visit?"
 *
 * THERE IS NO TEXT BOX AND THERE IS NO SCORE, and neither is an omission.
 *
 * A number about a private individual, held indefinitely and never shown to
 * them, is prose with fewer characters: it cannot be checked, answered or
 * explained. Prose is worse and is not even signal — "difficult" cannot be
 * counted or compared across professionals, so it could not support the human
 * review it exists to inform, while holding health details and third parties'
 * information we have no use for.
 *
 * AND THE LIST IS WHAT MAKES RETALIATION UNEXPRESSIBLE rather than policed.
 * Every option is an observable fact about the visit. None of them can say "they
 * would not pay what I asked", because declining a surveyed quote or refusing
 * an over-band amount is a right this product gives the customer.
 *
 * THE DEFAULT IS "STRAIGHTFORWARD" AND ONE TAP FINISHES IT. Most visits are
 * fine, and a form that made the good case as much work as the bad one would
 * collect flags from exactly the people willing to fill in forms.
 */
export function VisitReview({
  bookingId,
  done,
}: {
  bookingId: string;
  done: boolean;
}) {
  const t = useTranslations("provider.jobs.visit");
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(done);

  if (sent) {
    return (
      <p className="animate-pop-in mt-4 flex items-center gap-2 border-t border-border pt-4 text-body-sm text-muted-foreground">
        <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
        {t("done")}
      </p>
    );
  }

  const send = (flags: string[]) => {
    setBusy(true);
    void (async () => {
      try {
        const { submitVisitReviewAction } = await import(
          "@/app/[locale]/(work)/provider/jobs/actions"
        );
        const result = await submitVisitReviewAction(bookingId, flags);
        if (result.ok) setSent(true);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="animate-pop-in mt-4 border-t border-border pt-4">
      <p className="text-body-sm font-semibold">{t("title")}</p>
      {/* Said plainly, because a professional who thinks this is a rating will
          either inflate it or avoid it. */}
      <p className="mt-1 text-caption text-muted-foreground">{t("lead")}</p>

      {open ? (
        <>
          <ul className="assemble mt-3 flex flex-col gap-1.5">
            {CUSTOMER_FLAGS.map((flag, i) => {
              const on = picked.includes(flag);
              return (
                <li key={flag} style={{ ["--i" as string]: i }}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((current) =>
                        on
                          ? current.filter((f) => f !== flag)
                          : [...current, flag],
                      )
                    }
                    className={cn(
                      "w-full rounded-lg border p-2.5 text-left text-body-sm transition-all duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    {t(`flags.${flag}` as "flags.abusive")}
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            className="btn-tactile mt-3 w-full"
            disabled={busy || picked.length === 0}
            onClick={() => send(picked)}
          >
            {busy ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                {t("sending")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="btn-tactile"
            disabled={busy}
            onClick={() => send([])}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {t("fine")}
          </Button>
          <Button
            variant="outline"
            className="btn-tactile"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            {t("problem")}
          </Button>
        </div>
      )}
    </div>
  );
}
