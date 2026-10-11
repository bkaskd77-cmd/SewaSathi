"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Reasons this panel has a sentence for.
 *
 * An allow-list rather than an interpolated key, the same rule
 * `KNOWN_CORRECTION_ERRORS` and `KNOWN_JOB_ERRORS` follow: next-intl renders a
 * missing key as its own dotted path, so a reason without copy would put
 * `provider.nameBand.errors.x` on a professional's phone. These are exactly
 * what `nameJobBand` and the action can return.
 */
const KNOWN_NAME_ERRORS = [
  "notAProvider",
  "notAskable",
  "notConfigured",
  "notFound",
  "notSignedIn",
  "notThisTrade",
  "notYours",
  "saveFailed",
] as const;

type NameError = (typeof KNOWN_NAME_ERRORS)[number] | "failed";

const knownError = (reason: string): NameError =>
  (KNOWN_NAME_ERRORS as readonly string[]).includes(reason)
    ? (reason as NameError)
    : "failed";

export type NameBandProduct = {
  slug: string;
  /** Already in the reader's language — the page picked the side. */
  label: string;
  /** The published range, already formatted. */
  bandLabel: string;
};

/**
 * "Which of these was it?", asked of the person who just did the work.
 *
 * WHY IT EXISTS. A booking can be worked and finished with no product at all:
 * "I'm not sure" writes null on purpose in the booking flow, and before that
 * the category picker asked nothing. Such a job teaches the duration loop
 * nothing, the per-product bands nothing and the span nothing, and it held a
 * flat two hours whatever it turned out to be. The professional standing in the
 * room at the end knows.
 *
 * ONE TAP, AND NO "NOT SURE". The customer genuinely may not know which product
 * their problem is, which is why their version of this question is skippable —
 * forcing a choice there would push everybody onto whichever option is least
 * wrong and the column would stop meaning anything, the mistake
 * `booking_refusals.reason_code` already records. The person who did the work
 * does know, so there is no third answer to offer; somebody who does not want
 * to answer simply does not tap, and nothing is written. The absence needs no
 * column of its own — `band_asked_at` records the CUSTOMER being asked, and
 * this panel's existence is a function of the job's state rather than of
 * anything stored.
 *
 * IT IS NOT THE PRICE CORRECTION. `CorrectionPanel` is for "this is a different
 * job from the one that was booked": it moves the band, needs a reason and the
 * customer has to agree before work may start. This names a job nobody ever
 * classified, after the work, and moves no money — `freeze_booking_band` pins
 * the frozen floor on every update. Two panels, because conflating them would
 * put a repricing button on a finished job.
 */
export function NameBandPanel({
  bookingId,
  products,
}: {
  bookingId: string;
  /** The trade's products. Empty means the panel renders nothing. */
  products: NameBandProduct[];
}) {
  const t = useTranslations("provider.nameBand");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<NameError | null>(null);

  if (products.length === 0) return null;

  const name = (slug: string) => {
    setBusy(slug);
    setError(null);
    void (async () => {
      try {
        const { nameBandAction } = await import(
          "@/app/[locale]/(work)/provider/jobs/actions"
        );
        const result = await nameBandAction(bookingId, slug);
        // The action revalidates the routes, so its response already carries
        // the re-rendered page — a refresh() here would be a second round trip,
        // which is what made every button on this screen feel slow once.
        if (result.ok) return;
        setError(knownError(result.reason ?? "failed"));
      } catch {
        setError("failed");
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <div className="step-forward mt-3 rounded-lg border border-dashed border-border p-3">
      <p className="text-body-sm font-semibold">{t("title")}</p>
      {/* Said plainly, because a question with no stated purpose on a finished
          job reads as a form for our benefit — which it is, and saying so is
          what makes it worth a tap. */}
      <p className="mt-1 text-caption text-muted-foreground">{t("why")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {products.map((product) => (
          <button
            key={product.slug}
            type="button"
            disabled={busy !== null}
            onClick={() => name(product.slug)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-caption transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-60",
              busy === product.slug
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            {busy === product.slug ? (
              <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" aria-hidden />
            ) : null}
            {product.label}
            {product.bandLabel ? (
              <span className="ml-1.5 text-muted-foreground/80">
                {product.bandLabel}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="step-forward mt-2 text-caption text-destructive-ink">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
