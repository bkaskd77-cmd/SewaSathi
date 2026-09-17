"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { REVIEW_WINDOW_DAYS } from "@/lib/reviews";
import { cn } from "@/lib/utils";

/**
 * "How did it go?"
 *
 * THE SEALED WINDOW IS SAID OUT LOUD, at the top, before they type. Somebody
 * writing an honest two-star wants to know the person who has been inside their
 * house will not read it this afternoon and telephone them about it — and
 * somebody who does not know that writes a softer review or none at all. The
 * sentence is the whole reason double-blind produces better reviews than an
 * open one, so hiding it would keep the mechanism and throw away the effect.
 *
 * The comment is OPTIONAL and says so. A rating with no words is still
 * evidence; a required paragraph is a reason to close the tab.
 */
export function ReviewForm({
  bookingId,
  submitted,
  published,
}: {
  bookingId: string;
  /** Already reviewed — the form becomes the receipt. */
  submitted: boolean;
  published: boolean;
}) {
  const t = useTranslations("booking.review");
  const [rating, setRating] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(submitted);

  if (done) {
    return (
      <section className="animate-pop-in mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <h2 className="flex items-center gap-2 text-body-md font-semibold">
          <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
          {t(published ? "liveTitle" : "doneTitle")}
        </h2>
        {published ? null : (
          <p className="mt-1 text-body-sm text-muted-foreground">
            {t("doneBody", { days: String(REVIEW_WINDOW_DAYS) })}
          </p>
        )}
      </section>
    );
  }

  const send = () => {
    if (rating === 0) {
      setError("badRating");
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const { submitReviewAction } = await import(
          "@/app/[locale]/(app)/bookings/[id]/actions"
        );
        const result = await submitReviewAction(bookingId, rating, comment);
        if (result.ok) {
          setDone(true);
          return;
        }
        setError(result.reason ?? "failed");
      } catch {
        setError("failed");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section className="animate-pop-in mt-6 rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
      <h2 className="text-body-md font-semibold">{t("title")}</h2>
      {/* Before they type, not after. */}
      <p className="mt-1 text-body-sm text-muted-foreground">
        {t("lead", { days: String(REVIEW_WINDOW_DAYS) })}
      </p>

      <fieldset className="mt-4">
        <legend className="text-body-sm font-semibold">
          {t("ratingLabel")}
        </legend>
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              aria-label={t("stars", { n: String(value) })}
              aria-pressed={rating === value}
              className={cn(
                "btn-tactile rounded-lg p-1.5 transition-transform duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Star
                aria-hidden="true"
                className={cn(
                  "size-7 transition-colors duration-200",
                  value <= rating
                    ? "fill-gold text-gold"
                    : "text-muted-foreground",
                )}
              />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <Label htmlFor={`comment-${bookingId}`}>{t("commentLabel")}</Label>
        <textarea
          id={`comment-${bookingId}`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={t("commentPlaceholder")}
          className="mt-1.5 w-full rounded-lg border border-input bg-card p-3 text-body-md transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error ? (
        <p role="alert" className="animate-pop-in mt-3 text-body-sm text-destructive-ink">
          {t(`errors.${error}` as "errors.failed")}
        </p>
      ) : null}

      <Button
        className="btn-tactile btn-beacon mt-4"
        disabled={busy}
        onClick={send}
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
    </section>
  );
}
