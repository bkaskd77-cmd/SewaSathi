"use client";

import * as React from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { ArrowRight, Camera, Search, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fallbackCause, firedDespiteKey } from "@/lib/ai/accuracy";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { triageCopyFrom, type TriageCopy } from "@/lib/ai/copy";
import { applySafetyFloor, HAZARD_BANDS } from "@/lib/ai/safety";
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
 * The two controls this file repeats, defined once.
 *
 * The quick picks and the sub-band ask are the same object — a small round
 * chip that puts a word into the triage — and they were two near-identical
 * className strings, which is landing-page JavaScript spent on saying one
 * thing twice and an invitation for them to drift apart visually. `/[locale]`
 * sits on a 155 kB ceiling and the ask is what pushed it over; extracting
 * these is what paid for it, which is a better answer than raising a number
 * that exists to be hard to raise.
 */
const CHIP =
  "rounded-full border border-border bg-card px-3 py-1.5 text-caption font-medium transition-all duration-200 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** A quiet text action: "I'm not sure", "Change". Never a primary path. */
const QUIET_LINK =
  "text-caption text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

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

  /*
   * "Book a service" scrolls to the whole hero, then puts the cursor here.
   *
   * The anchor alone would leave somebody looking at a composed page with no
   * idea they are meant to type. Focusing without scrolling first would jump
   * past the headline. Doing both, in that order, is what makes the button
   * mean what it says.
   *
   * `hashchange` as well as mount, because clicking the same anchor twice does
   * not remount anything.
   */
  React.useEffect(() => {
    const focusIfTargeted = () => {
      if (window.location.hash !== "#hero") return;
      // After the scroll settles, or the browser fights the focus for it.
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 420);
    };
    focusIfTargeted();
    window.addEventListener("hashchange", focusIfTargeted);
    return () => window.removeEventListener("hashchange", focusIfTargeted);
  }, []);

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
              className={CHIP}
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
          <TriageCard outcome={outcome} locale={locale} copy={copy} />
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
  copy,
}: {
  outcome: TriageOutcome;
  locale: Locale;
  /** The safety lines, already in the reader's language. See the ask below. */
  copy: TriageCopy;
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

  /*
   * WHICH PRODUCT, WHEN THE TRIAGE COULD NOT TELL.
   *
   * `null` means unanswered — no tap yet. The empty string is "I'm not sure",
   * which is a real answer and not the same thing: it closes the question
   * without naming a band, so the card stops asking and the link carries no
   * band, exactly as it does today.
   *
   * Keyed on the result so a second search clears an answer to the first.
   * Without the key somebody who triages a leaking tap, taps "Blocked drain",
   * then searches for something else would carry that answer onto the new
   * result.
   */
  const [stated, setStated] = React.useState<string | null>(null);
  const answeredFor = React.useRef(outcome);
  if (answeredFor.current !== outcome) {
    answeredFor.current = outcome;
    if (stated !== null) setStated(null);
  }

  const chosen = stated
    ? (outcome.subBands.find((sub) => sub.slug === stated) ?? null)
    : null;
  const asking = !result.band && outcome.subBands.length > 0 && stated === null;

  /*
   * WHETHER THE QUESTION WAS PUT, which is a different fact from whether it was
   * answered and the one that is otherwise unrecoverable. "Never asked" and "I
   * am not sure" both arrive at the booking as a null band; without this they
   * are the same row, and the only number that says whether the ask is worth
   * its tap has no denominator. True for "not sure" as much as for an answer.
   */
  const wasAsked = !result.band && outcome.subBands.length > 0;

  /*
   * THE SAFETY FLOOR, RE-APPLIED OVER THE CUSTOMER'S OWN STATEMENT.
   *
   * The ask only appears when the description said too little to name a
   * product, so somebody tapping "short circuit, sparking or burning smell"
   * has told us something their words never did — and the text guard reads
   * only their words. Same one-way rule as the photo read: it can raise this
   * to an emergency and add the line about what to do right now, and there is
   * no branch that lets it lower anything. The server floor still ran on this
   * result and is not replaced; this is additive, on information the server
   * never had.
   */
  const guarded = React.useMemo(() => {
    if (!chosen) return result;
    const hazard = HAZARD_BANDS[`${result.category}/${chosen.slug}`] ?? null;
    if (!hazard) return result;
    return applySafetyFloor("", result, {
      copy: copy.safety,
      statedHazard: hazard,
    }).result;
  }, [chosen, copy.safety, result]);

  /*
   * A CUSTOMER'S STATEMENT REPLACES OUR GUESS, and only theirs does. The
   * figure on the card is the model's own number clamped to the CATEGORY band,
   * which is how AC servicing can read 1,800-5,500 while the `repair` product
   * it named is 500-1,500. Their answer swaps in the published, dated range
   * for the product they named. A model- or matcher-named band is left alone:
   * it is our guess about their words, and trusting its slug over its own
   * number would make the price wrong rather than merely wide.
   */
  const [low, high] = chosen
    ? [chosen.low, chosen.high]
    : guarded.priceRangeNPR;

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
        <Badge variant={URGENCY_VARIANT[guarded.urgency]}>
          {t(`urgency.${guarded.urgency}`)}
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
        {guarded.explanation}
      </p>

      {/*
        ONE QUESTION, AND ONLY WHEN THERE IS ONE WORTH ASKING.

        A category band spans 10-13x, so the narrowed product is what carries
        "no surprises" — and the matcher names one for about a sixth of
        requests. Asking is one tap on a screen the customer is already
        reading, before the link they were going to press anyway, so it adds no
        step to the booking. Skipping it leaves the card exactly as it was.
      */}
      {asking ? (
        <div
          className="animate-rise mt-4 rounded-lg border border-dashed border-border p-3"
          style={{ animationDelay: "240ms" }}
        >
          <p id="sub-band-ask" className="text-body-sm font-semibold">
            {t("ask.question")}
          </p>
          <div
            role="group"
            aria-labelledby="sub-band-ask"
            className="mt-2 flex flex-wrap gap-2"
          >
            {outcome.subBands.map((sub, index) => (
              <button
                key={sub.slug}
                type="button"
                onClick={() => setStated(sub.slug)}
                // Staggered like every other list in the product, capped so a
                // seven-product trade does not crawl.
                style={{ animationDelay: `${Math.min(index * 0.04, 0.2)}s` }}
                className={cn("animate-rise active:scale-[0.98]", CHIP)}
              >
                {sub.label}
              </button>
            ))}
            {/*
              NOT SURE IS A REAL ANSWER, not a way out of the question. It
              closes the ask and leaves the band null, which is what every
              other path does when nothing can tell — a guess filed under the
              wrong product is worse than no product at all.
            */}
            <button
              type="button"
              onClick={() => setStated("")}
              className={cn("animate-rise px-3 py-1.5", QUIET_LINK)}
              style={{ animationDelay: "0.24s" }}
            >
              {t("ask.unsure")}
            </button>
          </div>
        </div>
      ) : null}

      {/* What they told us, and a way back. An answer that cannot be changed
          is a trap on a screen where one tap decides the price shown. */}
      {chosen ? (
        <p className="animate-pop-in mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
          <span className="font-semibold">{chosen.label}</span>
          <button
            type="button"
            onClick={() => setStated(null)}
            className={QUIET_LINK}
          >
            {t("ask.change")}
          </button>
        </p>
      ) : null}

      <div className="animate-rise" style={{ animationDelay: "300ms" }}>
        <Button variant="gold" className={cn("btn-tactile mt-4")} asChild>
          {/* The product travels with the urgency. Without it the one thing
              the triage worked out about how long this job takes — a touch-up
              or a whole flat — is lost at the first link, and the booking
              falls back to reserving two hours for everything.

              `customer` outranks both of ours in the provenance: a statement
              is evidence, a guess is not. It is still a browser-supplied hint
              and the column's comment says so.

              `triage` is the log row this answer came from, and it is the one
              parameter here that changes nothing about the booking. It is the
              join the accuracy loop reads: without it every booking is
              unattributable, which is what every booking made so far is.
              Absent whenever nothing was logged. */}
          <Link
            href={`/services/${result.category}?urgency=${guarded.urgency}${
              chosen
                ? `&band=${encodeURIComponent(chosen.slug)}&bandSource=customer`
                : result.band
                  ? `&band=${encodeURIComponent(result.band)}&bandSource=${
                      outcome.source === "fallback" ? "matcher" : "model"
                    }`
                  : ""
            }${wasAsked ? "&asked=1" : ""}${
              outcome.triageLogId
                ? `&triage=${encodeURIComponent(outcome.triageLogId)}`
                : ""
            }`}
          >
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

  /*
   * WHETHER A KEY WAS IN PLACE, SAID RATHER THAN IMPLIED.
   *
   * The badge already printed the reason, and that was enough while there was
   * no key: every fallback was `no-api-key` and the sentence told the whole
   * story. With a key live the important half became inferential — a reader has
   * to already know that `provider-error` and `unparseable` can only happen
   * AFTER a key was accepted, and that `auth-rejected` means one is set and
   * wrong. Those are different problems with different fixes, and "the key is
   * set" is the clause that separates them from the setup step.
   *
   * `firedDespiteKey` is the same judgement `/admin/triage-accuracy` counts, so
   * the card and the screen cannot disagree about what counts as a live key.
   */
  const despiteKey =
    outcome.source === "fallback" &&
    firedDespiteKey(fallbackCause({ reason: outcome.reason, recorded: true }));

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
      {despiteKey ? <span>· {t("despiteKey")}</span> : null}
      {reason ? <span>· {reason}</span> : null}
      {/*
        WHICH PRODUCT IT NAMED, or that it named none.
        The band decides how much of a professional's week gets reserved, and
        for most requests it is deliberately null — "I need a painter" does not
        say whether that is a touch-up or a whole flat. Printing "no product"
        rather than nothing is the point: a blank would be indistinguishable
        from the badge not knowing, which is the confusion every other debug
        line here exists to avoid.
      */}
      <span>· {outcome.result.band ? t("band", { band: outcome.result.band }) : t("noBand")}</span>
    </p>
  );
}
