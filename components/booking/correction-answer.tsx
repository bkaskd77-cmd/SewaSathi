"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, PencilRuler, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { CorrectionState } from "@/lib/booking";
import { cn } from "@/lib/utils";

/**
 * Reasons the customer gets a real sentence for.
 *
 * An allow-list rather than an interpolated key, the same rule `job-card.tsx`
 * follows: next-intl renders a missing key as its own dotted path, so a reason
 * without copy would print `booking.correction.errors.x` on the screen. These
 * are exactly what `answerBandCorrection` and the action can return.
 */
const KNOWN_ANSWER_ERRORS = [
  "alreadyAnswered",
  "noCorrection",
  "notConfigured",
  "notFound",
  "notSignedIn",
  "notYours",
  "saveFailed",
] as const;

type AnswerError = (typeof KNOWN_ANSWER_ERRORS)[number] | "failed";

const knownError = (reason: string): AnswerError =>
  (KNOWN_ANSWER_ERRORS as readonly string[]).includes(reason)
    ? (reason as AnswerError)
    : "failed";

/**
 * "Your professional says this is a different job."
 *
 * THIS PANEL IS A GATE, NOT A NOTICE. The customer named a product when the
 * triage card asked and their answer set the price; somebody who has now seen
 * the job says it is something else. `enforce_price_correction` refuses
 * `in_progress` until this is answered, so nothing starts and nobody is billed
 * for a decision the customer never made.
 *
 * IT ASKS BEFORE THE WORK, WHICH IS THE ENTIRE POINT. The alternative — and
 * the thing this exists to prevent — is the same conversation at settlement,
 * with the floor up, the professional in the kitchen and the customer's only
 * real option being to agree.
 *
 * BOTH CONSEQUENCES ARE ON THE SCREEN BEFORE THE TAP. Agreeing moves the
 * quoted range; declining ends the booking and pays for the trip that was
 * already made. Neither is discovered afterwards — the same rule
 * `blindCashEntry` keeps, for the same reason: a term somebody meets only once
 * it has cost them is a term they did not agree to.
 *
 * DECLINING IS A REAL BUTTON, not a link in small type. A customer who feels
 * cornered into agreeing is a customer who agrees once.
 */
export function CorrectionAnswer({
  bookingId,
  state,
  providerName,
  statedLabel,
  proposedLabel,
  reason,
  oldBandLabel,
  newBandLabel,
  onAskAgain,
}: {
  bookingId: string;
  state: CorrectionState;
  /** Who is saying it. Null when the listing could not be read. */
  providerName: string | null;
  /** What they booked. Null when the triage named the product, not them. */
  statedLabel: string | null;
  /** What the professional says it is. */
  proposedLabel: string | null;
  /** Their own words. Never a number — the reason is the thing to read. */
  reason: string | null;
  /** The range on the booking now, already formatted. */
  oldBandLabel: string | null;
  /** The range the new product publishes, already formatted. */
  newBandLabel: string | null;
  /** Where "find somebody else" goes — the same destination as every dead end. */
  onAskAgain: string;
}) {
  const t = useTranslations("booking.correction");
  const router = useRouter();
  const [busy, setBusy] = React.useState<"agree" | "decline" | null>(null);
  const [error, setError] = React.useState<AnswerError | null>(null);

  const answer = (decision: "agree" | "decline") => {
    setBusy(decision);
    setError(null);
    void (async () => {
      try {
        const { answerCorrectionAction } = await import(
          "@/app/[locale]/(app)/bookings/[id]/actions"
        );
        const result = await answerCorrectionAction(
          bookingId,
          decision === "agree",
        );
        // The action revalidates this route, so its response already carries
        // the re-rendered page — a refresh() here would be a second round trip
        // for the same screen.
        if (result.ok) return;
        const reason = knownError(result.reason ?? "failed");
        setError(reason);
        /*
         * Already answered, or there is nothing to answer: this screen is out
         * of date rather than the customer having done anything wrong. Re-read
         * it so the next thing they see is the truth.
         */
        if (reason === "alreadyAnswered" || reason === "noCorrection") {
          router.refresh();
        }
      } catch {
        setError("failed");
      } finally {
        setBusy(null);
      }
    })();
  };

  if (state === "none") return null;

  if (state === "agreed") {
    return (
      <Section
        tone="quiet"
        icon={<Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
      >
        <h2 className="text-body-md font-semibold">{t("agreedTitle")}</h2>
        {proposedLabel ? (
          <p className="mt-1 text-body-sm text-muted-foreground">
            {t("agreedProduct", { product: proposedLabel })}
          </p>
        ) : null}
        {newBandLabel ? (
          <p className="mt-1 text-body-md font-semibold tabular-nums">
            {newBandLabel}
          </p>
        ) : null}
      </Section>
    );
  }

  if (state === "refused") {
    return (
      <Section tone="quiet" icon={<X aria-hidden="true" className="size-4 shrink-0" />}>
        <h2 className="text-body-md font-semibold">{t("refusedTitle")}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("refusedBody")}
        </p>
        {/* Never a dead end. Their tap still leaks. */}
        <Button variant="outline" size="sm" className="btn-tactile mt-3" asChild>
          <a href={onAskAgain}>{t("askAgain")}</a>
        </Button>
      </Section>
    );
  }

  // awaiting-answer — the one state that is loud, because the job is stopped.
  return (
    <Section
      tone="loud"
      icon={
        <PencilRuler aria-hidden="true" className="size-4 shrink-0 text-primary" />
      }
    >
      <h2 className="text-body-sm font-semibold text-primary">
        {providerName ? t("titleNamed", { name: providerName }) : t("title")}
      </h2>

      {statedLabel ? (
        <p className="mt-1.5 text-body-sm text-muted-foreground">
          {t("bookedAs", { product: statedLabel })}
        </p>
      ) : null}
      {proposedLabel ? (
        <p className="mt-0.5 text-body-md font-semibold">
          {t("saysItIs", { product: proposedLabel })}
        </p>
      ) : null}

      {/* THEIR OWN WORDS, ABOVE THE FIGURES. A customer deciding this is
          deciding whether they believe the person who looked at it — the
          sentence is the evidence, the range is only its consequence. */}
      {reason ? (
        <figure className="mt-3 rounded-lg border border-border bg-card p-3">
          <figcaption className="text-caption text-muted-foreground">
            {t("reasonLabel")}
          </figcaption>
          <blockquote className="mt-1 text-body-sm">{reason}</blockquote>
        </figure>
      ) : null}

      {oldBandLabel || newBandLabel ? (
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {oldBandLabel ? (
            <div>
              <dt className="text-caption text-muted-foreground">
                {t("priceWas")}
              </dt>
              <dd className="text-body-sm tabular-nums line-through decoration-muted-foreground/50">
                {oldBandLabel}
              </dd>
            </div>
          ) : null}
          {newBandLabel ? (
            <div>
              <dt className="text-caption text-muted-foreground">
                {t("priceNow")}
              </dt>
              <dd className="font-display text-display-sm tabular-nums">
                {newBandLabel}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="mt-3 text-body-sm text-muted-foreground">{t("ifYouAgree")}</p>
      <p className="mt-1 text-body-sm text-muted-foreground">{t("ifYouDont")}</p>

      {error ? (
        <p
          role="alert"
          className="animate-pop-in mt-3 text-body-sm text-destructive-ink"
        >
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="btn-tactile btn-beacon"
          disabled={busy !== null}
          onClick={() => answer("agree")}
        >
          {busy === "agree" ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" />
              {t("agreeing")}
            </>
          ) : (
            <>
              <Check aria-hidden="true" />
              {t("agree")}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          className="btn-tactile"
          disabled={busy !== null}
          onClick={() => answer("decline")}
        >
          {busy === "decline" ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" />
              {t("declining")}
            </>
          ) : (
            t("decline")
          )}
        </Button>
      </div>
    </Section>
  );
}

/**
 * One frame, two weights — the same shape `QuotePanel` uses, deliberately not
 * shared with it. The two panels answer different questions about different
 * facts, and one component taking both would be the fold `enforce_survey_quote`
 * exists to keep open.
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
      id="correction"
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
