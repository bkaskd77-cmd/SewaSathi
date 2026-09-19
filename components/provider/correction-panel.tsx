"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, PencilRuler } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CorrectionState } from "@/lib/booking";
import { cn } from "@/lib/utils";

/**
 * Reasons this screen has a sentence for.
 *
 * An allow-list rather than an interpolated key, the same rule
 * `KNOWN_JOB_ERRORS` follows in `job-card.tsx` and for the same reason:
 * next-intl renders a missing key as its own dotted path, so a reason without
 * copy would put `provider.correction.errors.x` on a professional's phone.
 * These are exactly what `proposeBandCorrection` and the action can return.
 */
const KNOWN_CORRECTION_ERRORS = [
  "notAProvider",
  "notConfigured",
  "notFound",
  "notSignedIn",
  "notYours",
  "reasonRequired",
  "saveFailed",
  "tooLate",
] as const;

type CorrectionError = (typeof KNOWN_CORRECTION_ERRORS)[number] | "failed";

const knownError = (reason: string): CorrectionError =>
  (KNOWN_CORRECTION_ERRORS as readonly string[]).includes(reason)
    ? (reason as CorrectionError)
    : "failed";

export type CorrectionProduct = {
  slug: string;
  /** Already in the reader's language — the page picked the side. */
  label: string;
  /** The published range, already formatted. */
  bandLabel: string;
};

/**
 * "This is a different job from the one that was booked."
 *
 * WHY A PROFESSIONAL NEEDS THIS AT ALL. When the triage card cannot name a
 * product it asks the customer, and their answer sets the price — which gives
 * them a reason to name a cheaper product than the one they have. They are not
 * the ones who will see the job. Somebody who arrives and finds a burst pipe
 * where "inspection only" was booked has to be able to say so, with a reason,
 * and be paid for the work that is actually there.
 *
 * IT IS NOT A PRICE FIELD, AND THAT IS THE WHOLE DESIGN. They pick a PRODUCT
 * from the trade's published list; the range comes with it. A free-text amount
 * here would be the dangerous surface `lib/payments/pricing.ts` exists to keep
 * closed — a number typed in somebody's kitchen with the customer watching.
 *
 * IT CHANGES NOTHING ON ITS OWN. The customer has to agree before work starts;
 * `enforce_price_correction` in Postgres refuses `in_progress` until they have.
 * So this panel says what happens next rather than implying the price moved.
 *
 * QUIET UNTIL IT IS USED. Most jobs are the product the customer named, and a
 * permanently open "is this wrong?" form invites second-guessing on the many to
 * catch the few.
 */
export function CorrectionPanel({
  bookingId,
  state,
  products,
  statedLabel,
  proposedLabel,
}: {
  bookingId: string;
  state: CorrectionState;
  /** The trade's products. Empty means there is nothing to correct to. */
  products: CorrectionProduct[];
  /** What the customer said it was. Null when they never named one. */
  statedLabel: string | null;
  /** What this professional already said, once they have. */
  proposedLabel: string | null;
}) {
  const t = useTranslations("provider.correction");
  const [open, setOpen] = React.useState(false);
  const [slug, setSlug] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<CorrectionError | null>(null);

  if (state === "agreed") {
    return (
      <Line tone="quiet">
        {t("agreed", { product: proposedLabel ?? t("theNewProduct") })}
      </Line>
    );
  }

  if (state === "awaiting-answer") {
    /*
     * The loud one, because the job is blocked here. A professional standing
     * in somebody's hallway needs to know why they cannot press "start work",
     * and "waiting on the customer" is the whole answer.
     */
    return (
      <Line tone="loud">
        {t("waiting", { product: proposedLabel ?? t("theNewProduct") })}
      </Line>
    );
  }

  if (state === "refused") {
    return <Line tone="quiet">{t("refused")}</Line>;
  }

  // `none`, and there is something to correct to.
  if (products.length === 0) return null;

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-caption text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t("open")}
        </button>
      </div>
    );
  }

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const { proposeCorrectionAction } = await import(
          "@/app/[locale]/(work)/provider/jobs/actions"
        );
        const result = await proposeCorrectionAction(bookingId, slug, reason);
        // The action revalidates both routes, so its response already carries
        // the re-rendered page — a refresh() here would be a second round trip.
        if (result.ok) return;
        setError(knownError(result.reason ?? "failed"));
      } catch {
        setError("failed");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="step-forward mt-3 rounded-lg border border-dashed border-border p-3">
      <p className="text-body-sm font-semibold">{t("title")}</p>
      {statedLabel ? (
        <p className="mt-1 text-caption text-muted-foreground">
          {t("bookedAs", { product: statedLabel })}
        </p>
      ) : null}

      <div className="mt-3">
        <Label htmlFor={`correction-${bookingId}`}>{t("whatItIs")}</Label>
        <select
          id={`correction-${bookingId}`}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className="mt-1.5 h-11 w-full rounded-lg border border-input bg-card px-3 text-body-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">{t("choose")}</option>
          {products.map((product) => (
            <option key={product.slug} value={product.slug}>
              {product.label} · {product.bandLabel}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        {/* A figure that moves needs a sentence. The database refuses an empty
            one too; this is so the professional is told before the round trip,
            and so the customer sees a reason rather than a new number. */}
        <Label htmlFor={`reason-${bookingId}`}>{t("why")}</Label>
        <textarea
          id={`reason-${bookingId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={400}
          placeholder={t("whyPlaceholder")}
          className="mt-1.5 w-full rounded-lg border border-input bg-card px-3 py-2 text-body-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <p className="mt-2 text-caption text-muted-foreground">{t("thenWhat")}</p>

      {error ? (
        <p className="animate-pop-in mt-2 text-caption text-destructive-ink">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          className="btn-tactile"
          disabled={busy || !slug || reason.trim().length === 0}
          onClick={submit}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <PencilRuler aria-hidden="true" className="size-4" />
          )}
          {t("send")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="btn-tactile"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

/** One sentence about where the correction has got to. */
function Line({
  tone,
  children,
}: {
  tone: "quiet" | "loud";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "animate-pop-in mt-3 flex items-start gap-2 rounded-lg p-2.5 text-body-sm",
        tone === "loud"
          ? "border border-warning/30 bg-warning/10 text-warning-ink"
          : "text-muted-foreground",
      )}
    >
      <PencilRuler aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
