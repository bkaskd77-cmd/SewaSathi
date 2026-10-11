"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Camera, Loader2, X } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type CategoryOption = {
  slug: string;
  label: string;
  /**
   * The published band, or null on a trade that has none.
   *
   * NULL IS A REAL ANSWER HERE, not a missing value. Movers and packers is
   * priced after a free survey because no operator in the market quotes one
   * before looking, and rendering the stored numbers anyway is how the invented
   * Rs 5,000-20,000 survived on five screens after the data said otherwise.
   */
  priceMin: number | null;
  priceMax: number | null;
  /**
   * Formatted on the server — currency rules are locale-aware. On a survey
   * trade this is the sentence, not a range.
   */
  quoteLabel: string;
  /** True when this trade publishes no price at all. See `isSurveyPriced`. */
  surveyPriced: boolean;
  /**
   * The products inside this trade, for the "which of these is it?" question.
   *
   * THE QUESTION ONLY EXISTED ON THE TRIAGE CARD, which is how most bookings
   * came to carry no product at all. Somebody tapping a category on
   * `/services` reaches this flow with no band, no source and nothing that
   * ever asks — and that path is now the COMMON one, because the AI ceilings
   * suppress or refuse the card for anybody out of free questions.
   *
   * Slug and label only, with the locale already picked on the server, for the
   * same reason the triage route sends them back on its response rather than
   * shipping them in the bundle: thirty-six labels in two languages is weight
   * on a page that does not need it, and the bundle would freeze to the seed
   * while the table is what a price is read from.
   *
   * Empty on a survey trade, which sells no products to choose between.
   */
  subBands: { slug: string; label: string }[];
};

/**
 * Step a — what is wrong.
 *
 * Pre-filled from triage when they came that way, and editable, because triage
 * is good rather than infallible: a wrong category sends the wrong trade, and
 * the person who can see the problem is standing in front of it.
 *
 * The photo is compressed in the browser before it leaves — the same
 * `prepareImage` the hero uses — and imported dynamically for the same reason:
 * most people never attach one and should not download the encoder.
 */
/**
 * Rejections the customer can act on. Everything else is ours — a storage
 * outage, a missing key — and collapses to "try again", which is the only
 * useful thing to say about a fault they cannot fix.
 */
const KNOWN_PHOTO_ERRORS = [
  "tooLarge",
  "notAnImage",
  "unsupportedFormat",
  "tooManyPixels",
] as const;

export function StepProblem({
  categories,
  band,
  asked,
  category,
  description,
  photoPath,
  photoPreview,
  error,
  onChange,
  onPhoto,
}: {
  categories: CategoryOption[];
  category: string;
  description: string;
  photoPath: string | null;
  photoPreview: string | null;
  error?: string | null;
  onChange: (patch: {
    category?: string;
    description?: string;
    band?: string | null;
    bandSource?: string | null;
    asked?: boolean;
  }) => void;
  /** The product chosen so far, if any. */
  band: string | null;
  /** True once this customer has been put the product question. */
  asked: boolean;
  onPhoto: (next: {
    path: string | null;
    preview: string | null;
    /** Device-reported, read before the canvas resize destroyed the EXIF. */
    takenAt?: string | null;
  }) => void;
}) {
  const t = useTranslations("booking.flow.problem");
  const tErr = useTranslations("booking.flow.errors");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setBusy(true);
    try {
      const [{ prepareImage, ImageRejected }, { uploadPhotoAction }] =
        await Promise.all([
          import("@/lib/utils/image"),
          import("@/app/[locale]/(app)/book/actions"),
        ]);

      let prepared;
      try {
        prepared = await prepareImage(file);
      } catch (thrown) {
        setPhotoError(
          thrown instanceof ImageRejected ? thrown.message : tErr("photoFailed"),
        );
        return;
      }

      // Show it immediately; the upload can finish behind the preview.
      onPhoto({ path: null, preview: prepared.previewUrl, takenAt: prepared.takenAt });

      const result = await uploadPhotoAction(prepared.data);
      if (result.ok) {
        onPhoto({
          path: result.path,
          preview: prepared.previewUrl,
          takenAt: prepared.takenAt,
        });
      } else {
        onPhoto({ path: null, preview: null });
        // The server's own reason where there is copy for it: somebody who
        // picked a PNG or a screenshot should be told that, not told "failed".
        setPhotoError(
          (KNOWN_PHOTO_ERRORS as readonly string[]).includes(result.reason)
            ? tErr(`photo.${result.reason}`)
            : tErr("photoFailed"),
        );
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const selected = categories.find((c) => c.slug === category);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="description">{t("descriptionLabel")}</Label>
        <textarea
          id="description"
          value={description}
          onChange={(event) => onChange({ description: event.target.value })}
          rows={4}
          maxLength={1000}
          placeholder={t("descriptionPlaceholder")}
          aria-describedby="description-error"
          aria-invalid={Boolean(error)}
          className={cn(
            "mt-2 w-full rounded-lg border bg-card px-3 py-2.5 text-body-md transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            error ? "border-destructive" : "border-input hover:border-primary/40",
          )}
        />
        <FieldError
          id="description-error"
          lines={1}
          message={error ? tErr(error) : null}
        />
      </div>

      <div>
        <Label htmlFor="category">{t("categoryLabel")}</Label>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("categoryHelp")}
        </p>
        <select
          id="category"
          value={category}
          onChange={(event) => onChange({ category: event.target.value })}
          className="mt-2 h-12 w-full rounded-lg border border-input bg-card px-3 text-body-md transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <option value="" disabled>
            {t("categoryPlaceholder")}
          </option>
          {categories.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.label}
            </option>
          ))}
        </select>
        {/*
          WHICH PRODUCT, ASKED HERE BECAUSE NOTHING ELSE ASKS ON THIS PATH.
          The triage card has always put this question; a customer who picked a
          category off `/services` was never asked at all, and that is now the
          common route. Without it the booking carries no product, and a
          booking with no product teaches the duration loop nothing and holds a
          flat two hours whatever the job is.

          SHOWN ONCE, AND SKIPPABLE. `asked` is what stops it reappearing after
          somebody has answered or declined — and "I'm not sure" writes NULL
          rather than a guess, for the reason `booking_refusals.reason_code`
          records: forcing a choice pushes everybody onto whichever option is
          least wrong and makes the whole column meaningless. A product nobody
          could name is an ordinary answer.
        */}
        {selected && selected.subBands.length > 0 && !asked && !band ? (
          <div className="animate-rise mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-body-sm font-medium text-foreground">
              {t("bandQuestion")}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t("bandWhy")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.subBands.map((sub) => (
                <button
                  key={sub.slug}
                  type="button"
                  onClick={() =>
                    onChange({
                      band: sub.slug,
                      bandSource: "customer",
                      asked: true,
                    })
                  }
                  className="rounded-full border border-input bg-card px-3 py-1.5 text-caption transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {sub.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  onChange({ band: null, bandSource: null, asked: true })
                }
                className="text-caption px-2 py-1.5 text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("bandUnsure")}
              </button>
            </div>
          </div>
        ) : null}
        {/* What they chose, with a way back. A choice that cannot be undone is
            one people refuse to make. */}
        {selected && band ? (
          <p className="mt-3 text-caption text-muted-foreground">
            {t("bandChosen", {
              product:
                selected.subBands.find((sub) => sub.slug === band)?.label ??
                band,
            })}{" "}
            <button
              type="button"
              onClick={() =>
                onChange({ band: null, bandSource: null, asked: false })
              }
              className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("bandChange")}
            </button>
          </p>
        ) : null}
        {selected ? (
          <p className="mt-2 text-caption tabular-nums text-muted-foreground">
            {/* "Usually Rs 5,000-20,000" on a trade that publishes no price is
                the invented figure wearing a hedge. A survey trade says what it
                actually does instead. */}
            {selected.surveyPriced
              ? t("estimateSurvey")
              : t("estimate", { range: selected.quoteLabel })}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="photo-button">{t("photoLabel")}</Label>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("photoHelp")}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />

        {photoPreview ? (
          <div className="animate-pop-in mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL of the customer's own photo; next/image cannot optimise it and should not try. */}
            <img
              src={photoPreview}
              alt={t("photoAlt")}
              className="size-16 rounded-lg border border-border object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-body-sm">
                {busy || !photoPath ? t("photoUploading") : t("photoAttached")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onPhoto({ path: null, preview: null })}
            >
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">{t("photoRemove")}</span>
            </Button>
          </div>
        ) : (
          <Button
            id="photo-button"
            type="button"
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Camera aria-hidden="true" className="size-4" />
            )}
            {t("photoAdd")}
          </Button>
        )}

        <FieldError id="photo-error" lines={1} message={photoError} />
      </div>
    </div>
  );
}
