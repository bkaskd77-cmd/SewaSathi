"use client";

import * as React from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { ArrowRight, Camera, Search, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { triageCopyFrom, type TriageCopy } from "@/lib/ai/copy";
import {
  categoryCtaLabel,
  categoryName,
  triageProblem,
  type TriageImage,
  type TriageOutcome,
} from "@/lib/ai/triage";
import { cn, formatNpr } from "@/lib/utils";

/**
 * The hero input — the front door of the whole product.
 *
 * One controlled value and one `runTriage(text, photo)` path; the chips, the
 * debounced typing handler, the submit button and the photo picker all go
 * through it rather than having their own logic.
 *
 * Phase 4 made triage a real API call. What changed here: it awaits, it can
 * carry a photo, and an in-flight run is aborted when a newer one starts. The
 * result shape did not change, so the card below is untouched.
 */

/**
 * The chips. Keys rather than strings: the visible label is translated, and
 * the *query* sent to triage is the label itself — Claude reads Nepali, and the
 * keyword matcher underneath it matches Romanized and Devanagari terms too.
 */
const QUICK_PICKS = ["leak", "power", "today"] as const;

/**
 * Typing pause before triaging. Longer than the mock's 600ms: this is now a
 * paid API call, and the extra fifth of a second collapses a lot of them.
 */
const TYPING_DEBOUNCE_MS = 800;

/** Below this, wait — "tap" alone is not yet a description worth a call. */
const MIN_AUTO_LENGTH = 6;

/** Long enough for the thumbnail's exit animation, and no longer. */
const PHOTO_EXIT_MS = 160;

const URGENCY_VARIANT = {
  emergency: "urgent" as const,
  soon: "info" as const,
  routine: "verified" as const,
};

type Photo = TriageImage & { previewUrl: string };

export function ProblemSearch() {
  const t = useTranslations("triage");
  const locale = useLocale() as Locale;
  // The safety lines and the keyword explanations, already in the browser.
  // The fallback path runs when the network does not, so they cannot be
  // fetched at the moment they are needed.
  const messages = useMessages();
  const copy = React.useMemo<TriageCopy>(
    () => triageCopyFrom(messages),
    [messages],
  );

  const [query, setQuery] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const [outcome, setOutcome] = React.useState<TriageOutcome | null>(null);
  const [photo, setPhoto] = React.useState<Photo | null>(null);
  const [photoLeaving, setPhotoLeaving] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const debounceRef = React.useRef<number | undefined>(undefined);
  const exitRef = React.useRef<number | undefined>(undefined);
  // Guards against an earlier, slower triage overwriting a newer one.
  const runIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
      window.clearTimeout(exitRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const clearPhoto = React.useCallback(() => {
    setPhotoLeaving(true);
    exitRef.current = window.setTimeout(() => {
      setPhoto(null);
      setPhotoLeaving(false);
    }, PHOTO_EXIT_MS);
  }, []);

  const runTriage = React.useCallback(
    async (value: string, image: Photo | null) => {
      const trimmed = value.trim();
      window.clearTimeout(debounceRef.current);

      // Abort the previous call rather than letting it finish and pay for a
      // result nobody will see.
      abortRef.current?.abort();

      if (!trimmed && !image) {
        runIdRef.current++;
        setThinking(false);
        setOutcome(null);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runIdRef.current;

      setThinking(true);

      try {
        const next = await triageProblem(trimmed, {
          locale,
          copy,
          image: image
            ? { mediaType: image.mediaType, data: image.data }
            : null,
          signal: controller.signal,
        });
        if (runId !== runIdRef.current) return;

        setOutcome(next);
        setThinking(false);
        // The photo has been read. Keeping it on screen implies it will be
        // sent again with the next question, which it will not.
        if (image) clearPhoto();
      } catch {
        // Only an abort lands here, and an abort means a newer run owns the
        // screen now. triageProblem never throws for anything else.
      }
    },
    [clearPhoto, copy, locale],
  );

  const onChange = (value: string) => {
    setQuery(value);
    window.clearTimeout(debounceRef.current);

    if (!value.trim()) {
      runIdRef.current++;
      abortRef.current?.abort();
      setThinking(false);
      setOutcome(null);
      return;
    }

    if (value.trim().length < MIN_AUTO_LENGTH) return;

    debounceRef.current = window.setTimeout(
      () => void runTriage(value, photo),
      TYPING_DEBOUNCE_MS,
    );
  };

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);

    try {
      // Loaded on demand: the compression code is dead weight for the great
      // majority of visitors, who never attach a photo.
      const { prepareImage } = await import("@/lib/utils/image");
      const prepared = await prepareImage(file);

      window.clearTimeout(exitRef.current);
      setPhotoLeaving(false);
      setPhoto(prepared);
      // A photo on its own is a complete question, so triage runs immediately.
      void runTriage(query, prepared);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : t("photoFailed"));
    } finally {
      setPhotoBusy(false);
      // Let the same file be chosen again after a remove.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div id="hero-search" className="scroll-mt-24">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!query.trim() && !photo) {
            inputRef.current?.focus();
            return;
          }
          void runTriage(query, photo);
        }}
        className="flex flex-col gap-2 rounded-xl border border-input bg-card p-2 shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background sm:flex-row sm:items-center"
      >
        <label htmlFor="problem" className="sr-only">
          {t("inputLabel")}
        </label>
        <div className="flex flex-1 items-center gap-2.5 px-3">
          <Search
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <input
            id="problem"
            ref={inputRef}
            value={query}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("placeholder")}
            autoComplete="off"
            className="h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/80"
          />

          {/* capture="environment" opens the rear camera straight away on a
              phone, which is where the problem is. On desktop it is ignored
              and this is an ordinary file picker.

              Out of the accessibility tree entirely: the labelled button below
              is the control, and a bare `sr-only` file input left a second,
              unlabelled tab stop for the same action — which is what Lighthouse
              was failing the page on. `tabIndex={-1}` is what makes
              `aria-hidden` legitimate here rather than hiding something
              focusable. */}
          <input
            ref={fileRef}
            id="problem-photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void onPickPhoto(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            aria-label={photo ? t("replacePhoto") : t("addPhoto")}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-60",
              photo
                ? "border-primary/50 bg-primary/[0.06] text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
            )}
          >
            <Camera aria-hidden="true" className="size-4" />
          </button>
        </div>

        <Button
          type="submit"
          variant="gold"
          size="lg"
          className="btn-tactile shrink-0"
        >
          {t("submit")}
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>

      {photo ? (
        <div
          className={cn(
            "mt-3 flex items-center gap-3 rounded-lg border border-border bg-card p-2 pr-3",
            photoLeaving ? "animate-pop-out" : "animate-pop-in",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element --
              a data: URL from the user's own camera; next/image would only
              add a loader in front of bytes that are already in memory. */}
          <img
            src={photo.previewUrl}
            alt={t("photoAlt")}
            className="size-12 rounded-md object-cover"
          />
          <p className="flex-1 text-caption text-muted-foreground">
            {t("photoAdded")}
          </p>
          <button
            type="button"
            onClick={clearPhoto}
            aria-label={t("removePhoto")}
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      {photoBusy || photoError ? (
        <p
          role={photoError ? "alert" : undefined}
          className={cn(
            "mt-2 text-caption",
            photoError ? "text-destructive-ink" : "text-muted-foreground",
          )}
        >
          {photoError ?? t("photoShrinking")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">
          {t("commonLabel")}
        </span>
        {QUICK_PICKS.map((key) => {
          const label = t(`quickPicks.${key}`);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setQuery(label);
                void runTriage(label, photo);
              }}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-caption font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Result area. Announced politely so the outcome reaches screen
          readers once, rather than every frame of the thinking state. */}
      <div aria-live="polite" aria-atomic="true">
        {thinking ? <TriageSkeleton /> : null}
        {!thinking && outcome ? (
          <TriageCard outcome={outcome} locale={locale} />
        ) : null}
      </div>
    </div>
  );
}

function TriageSkeleton() {
  const t = useTranslations("triage");

  return (
    <div className="animate-rise mt-4 rounded-xl border border-border bg-card p-5">
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <Sparkles aria-hidden="true" className="size-3.5 text-gold-ink" />
        {t("reading")}
      </p>
      <div aria-hidden="true" className="mt-3 flex flex-col gap-2.5">
        <div className="flex gap-2">
          <span className="animate-skeleton h-6 w-28 rounded-full bg-muted" />
          <span className="animate-skeleton h-6 w-24 rounded-full bg-muted [animation-delay:120ms]" />
        </div>
        <span className="animate-skeleton h-5 w-40 rounded bg-muted [animation-delay:60ms]" />
        <span className="animate-skeleton h-4 w-full max-w-md rounded bg-muted [animation-delay:180ms]" />
      </div>
    </div>
  );
}

function TriageCard({
  outcome,
  locale,
}: {
  outcome: TriageOutcome;
  locale: Locale;
}) {
  const t = useTranslations("triage");
  const tc = useTranslations("common");
  const fallback = useTranslations("fallback");
  const result = outcome.result;
  const name = categoryName(
    result.category,
    locale,
    fallback("genericCategory"),
  );
  const ctaLabel = categoryCtaLabel(
    result.category,
    locale,
    fallback("genericCtaLabel"),
  );
  const [low, high] = result.priceRangeNPR;

  return (
    <div className="animate-rise mt-4 rounded-xl border border-border bg-card p-5 shadow-md">
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <Sparkles aria-hidden="true" className="size-3.5 text-gold-ink" />
        {t("resultLead")}
      </p>

      {/*
        The skeleton laid these out in this order; they arrive in the same
        order, 60ms apart, so the card resolves into place instead of the
        skeleton being swapped for a finished card in one frame.
      */}
      <div
        className="animate-rise mt-3 flex flex-wrap items-center gap-2"
        style={{ animationDelay: "60ms" }}
      >
        <Badge variant="verified">{name}</Badge>
        <Badge variant={URGENCY_VARIANT[result.urgency]}>
          {t(`urgency.${result.urgency}`)}
        </Badge>
      </div>

      <p
        className="animate-rise mt-3 font-display text-lg font-bold tabular-nums"
        style={{ animationDelay: "120ms" }}
      >
        {formatNpr(low, { locale })} – {formatNpr(high, { locale })}
        <span className="ml-2 text-caption font-normal text-muted-foreground">
          {tc("typicalRange")}
        </span>
      </p>

      <p
        className="animate-rise mt-2 text-pretty text-body-sm text-muted-foreground"
        style={{ animationDelay: "180ms" }}
      >
        {result.explanation}
      </p>

      <div className="animate-rise" style={{ animationDelay: "240ms" }}>
        <Button variant="gold" className={cn("btn-tactile mt-4")} asChild>
          <Link href={`/services/${result.category}?urgency=${result.urgency}`}>
            {t("findProfessionals", { category: ctaLabel })}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <TriagePathBadge outcome={outcome} />
    </div>
  );
}

/**
 * Which path served this result — Claude, the cache, or the keyword fallback.
 *
 * Exists because a silent fallback is indistinguishable from a working
 * product: with no API key every triage still answers, and the only way to
 * tell was to read the server log.
 *
 * Hidden from ordinary visitors. It shows in development, and in any
 * environment when the page is opened with `?debug=triage` — which is how it
 * can be checked on a deployment whose branch is production. Read after mount
 * rather than during render, so the server and client HTML agree.
 */
function useTriageDebug(): boolean {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      setEnabled(true);
      return;
    }
    setEnabled(
      new URLSearchParams(window.location.search).get("debug") === "triage",
    );
  }, []);

  return enabled;
}

function TriagePathBadge({ outcome }: { outcome: TriageOutcome }) {
  const t = useTranslations("triage.debug");
  const show = useTriageDebug();
  if (!show) return null;

  // "ok" has nothing to add — the path itself is the whole story.
  const reason =
    outcome.reason === "ok"
      ? ""
      : t.has(`reason.${outcome.reason}`)
        ? t(`reason.${outcome.reason}`)
        : outcome.reason;

  return (
    <p
      data-testid="triage-path"
      className={cn(
        "animate-pop-in mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-border pt-3 text-caption",
        outcome.source === "fallback"
          ? "text-warning-ink"
          : "text-muted-foreground",
      )}
    >
      <span className="font-semibold uppercase tracking-wide">{t("tag")}</span>
      <span>
        {t("servedBy", { path: t(outcome.source) })}
        {outcome.model ? ` (${outcome.model})` : ""}
      </span>
      {reason ? <span>· {reason}</span> : null}
    </p>
  );
}
