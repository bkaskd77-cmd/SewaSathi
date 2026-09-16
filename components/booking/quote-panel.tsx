"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Ruler, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { QuoteState } from "@/lib/booking";
import { cn } from "@/lib/utils";

/**
 * A surveyed price, and the tap that makes it real.
 *
 * THIS PANEL IS A GATE, NOT AN UPDATE. Nothing can start on a survey-priced job
 * until the customer has agreed to the figure — `enforce_survey_quote` in
 * Postgres refuses `in_progress` without it — because the 2x overcharge ceiling
 * is measured off `quoted_max`, and measuring it off a number nobody agreed to
 * would be a protection in name only.
 *
 * SO IT IS THE LOUDEST THING ON THE PAGE WHEN IT IS WAITING, and silent
 * otherwise. The approval is the drop-off point on the most valuable trade we
 * sell: somebody who meant to answer and somebody who decided not to look
 * identical in the data, and the difference is usually whether anybody asked
 * clearly.
 *
 * DECLINING IS A REAL BUTTON, NOT A LINK IN SMALL TYPE. A customer who feels
 * cornered into accepting a price is a customer who accepts once. It costs them
 * nothing, it is said plainly, and it is recorded against nobody.
 */
export function QuotePanel({
  bookingId,
  state,
  bandLabel,
  holdsUntil,
  onAskAgain,
}: {
  bookingId: string;
  state: QuoteState;
  /** The surveyed range, already formatted. Null before anybody has looked. */
  bandLabel: string | null;
  /** The expiry, already formatted. Null when there is nothing to hold. */
  holdsUntil: string | null;
  /** Where "ask for a new survey" goes — /services, same as every dead end. */
  onAskAgain: string;
}) {
  const t = useTranslations("booking.quote");
  const router = useRouter();
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const respond = (decision: "approve" | "decline") => {
    setBusy(decision);
    setError(null);
    void (async () => {
      try {
        const { respondToQuoteAction } = await import(
          "@/app/[locale]/(app)/bookings/[id]/actions"
        );
        const result = await respondToQuoteAction(bookingId, decision);
        // The action revalidates this route, so its response already carries
        // the re-rendered page — a refresh() here would be a second round trip
        // for the same screen.
        if (result.ok) return;
        setError(result.reason ?? "failed");
        /*
         * An expired or already-answered quote means this screen is out of
         * date rather than that the customer did anything wrong. Re-read the
         * page so the next thing they see is the truth.
         */
        if (result.reason === "expired" || result.reason === "alreadyAnswered") {
          router.refresh();
        }
      } catch {
        setError("failed");
      } finally {
        setBusy(null);
      }
    })();
  };

  if (state === "awaiting-survey") {
    return (
      <Section tone="quiet" icon={<Ruler aria-hidden="true" className="size-4 shrink-0" />}>
        <h2 className="text-body-md font-semibold">{t("awaitingSurveyTitle")}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("awaitingSurveyBody")}
        </p>
      </Section>
    );
  }

  if (state === "approved") {
    return (
      <Section tone="quiet" icon={<Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}>
        <h2 className="text-body-md font-semibold">{t("approvedTitle")}</h2>
        {bandLabel ? (
          <p className="mt-1 text-body-md font-semibold tabular-nums">{bandLabel}</p>
        ) : null}
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("approvedBody")}
        </p>
      </Section>
    );
  }

  if (state === "declined" || state === "expired") {
    const declined = state === "declined";
    return (
      <Section tone="quiet" icon={<X aria-hidden="true" className="size-4 shrink-0" />}>
        <h2 className="text-body-md font-semibold">
          {t(declined ? "declinedTitle" : "expiredTitle")}
        </h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t(declined ? "declinedBody" : "expiredBody")}
        </p>
        {/* Never a dead end: the way forward is a real button, the same
            destination every other empty state on this product points at. */}
        <Button variant="outline" size="sm" className="btn-tactile mt-3" asChild>
          <a href={onAskAgain}>{t("askAgain")}</a>
        </Button>
      </Section>
    );
  }

  // awaiting-approval — the one state that is loud.
  return (
    <Section tone="loud" icon={<Ruler aria-hidden="true" className="size-4 shrink-0 text-primary" />}>
      <h2 className="text-body-sm font-semibold text-primary">{t("readyTitle")}</h2>
      {bandLabel ? (
        <p className="mt-1.5 font-display text-display-sm tabular-nums">
          {bandLabel}
        </p>
      ) : null}
      <p className="mt-1.5 text-body-sm text-muted-foreground">{t("readyBody")}</p>
      {holdsUntil ? (
        <p className="mt-1 text-caption text-muted-foreground">
          {t("holdsUntil", { when: holdsUntil })}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="animate-pop-in mt-3 text-body-sm text-destructive-ink"
        >
          {t(`errors.${error}` as "errors.failed")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="btn-tactile btn-beacon"
          disabled={busy !== null}
          onClick={() => respond("approve")}
        >
          {busy === "approve" ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" />
              {t("approving")}
            </>
          ) : (
            <>
              <Check aria-hidden="true" />
              {t("approve")}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          className="btn-tactile"
          disabled={busy !== null}
          onClick={() => respond("decline")}
        >
          {t("decline")}
        </Button>
      </div>
    </Section>
  );
}

/**
 * One frame, two weights.
 *
 * `loud` is the waiting state and only the waiting state. A permanent emphasis
 * on a panel that is usually just reporting history is noise, and noise is what
 * makes somebody stop reading the one message that needed them.
 */
function Section({
  tone,
  icon,
  children,
}: {
  tone: "loud" | "quiet";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id="quote"
      className={cn(
        "animate-pop-in mt-6 rounded-xl border p-4",
        tone === "loud"
          ? "border-primary/25 bg-primary/[0.05]"
          : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}
