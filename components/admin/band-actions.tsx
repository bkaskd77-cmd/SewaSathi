"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { ReauthNotice, isReauthReason } from "@/components/admin/reauth-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActionResult = { ok: boolean; reason?: string };
type Action = (data: FormData) => Promise<ActionResult>;

/**
 * Approve the proposed band, or say why not.
 *
 * THE REASON IS A FIELD ON BOTH, NOT A CONFIRMATION DIALOG — the same choice as
 * `PayoutActions`. An "are you sure" teaches somebody to tap through; typing why
 * is the pause and the record at once, and here the record does work beyond
 * history: a rejection's reason is what the screen shows the next person who sees
 * the same proposal suppressed.
 *
 * THE EVIDENCE TRAVELS WITH THE DECISION. The sample, the winsorised count and
 * the cap flag are hidden fields rather than a server-side recompute, so the
 * revision row records what the person actually read. A proposal recomputed
 * between the render and the press would be recorded as the reason for a decision
 * nobody took.
 *
 * TWO BUTTONS, ONE FORM, and the reason is shared: a reason typed for an approval
 * is the same sentence that would explain a rejection, and asking for it twice in
 * two boxes is how somebody ends up writing "." in the one they did not mean to
 * use. `formAction` picks which server action the press runs.
 */
export function BandActions({
  slug,
  low,
  high,
  sample,
  winsorised,
  capped,
  approve,
  reject,
}: {
  slug: string;
  low: number;
  high: number;
  sample: number;
  winsorised: number;
  capped: boolean;
  approve: Action;
  reject: Action;
}) {
  const t = useTranslations("admin.bands");
  const [result, setResult] = React.useState<ActionResult | null>(null);

  const run = (action: Action) => async (data: FormData) => {
    setResult(await action(data));
  };

  return (
    <form className="mt-4 space-y-2 border-t border-border pt-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="low" value={String(low)} />
      <input type="hidden" name="high" value={String(high)} />
      <input type="hidden" name="sample" value={String(sample)} />
      <input type="hidden" name="winsorised" value={String(winsorised)} />
      <input type="hidden" name="capped" value={capped ? "1" : "0"} />

      <div className="space-y-1.5">
        <Label htmlFor={`reason-${slug}`}>{t("why")}</Label>
        <Input
          id={`reason-${slug}`}
          name="reason"
          required
          minLength={4}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton
          label={t("approve")}
          busy={t("working")}
          formAction={run(approve)}
        />
        <SubmitButton
          label={t("reject")}
          busy={t("working")}
          variant="outline"
          formAction={run(reject)}
        />
      </div>

      {result?.ok ? (
        <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
          <Check className="size-4" aria-hidden />
          {t("done")}
        </p>
      ) : result ? (
        <p
          role="alert"
          className="animate-rise text-body-sm text-destructive-ink"
        >
          {t(`errors.${result.reason}` as "errors.refused")}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton({
  label,
  busy,
  variant,
  formAction,
}: {
  label: string;
  busy: string;
  variant?: "outline";
  formAction: (data: FormData) => Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      formAction={formAction}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {busy}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/**
 * State a band directly, with no sample behind it.
 *
 * WHY THERE IS A SECOND FORM AT ALL. `BandActions` above can only ever offer a
 * figure `proposeBand` computed, and that function returns nothing below 15 to 30
 * settled jobs — so until this existed, a category we had mispriced and not yet
 * sold fifteen times could only be fixed by a migration and a deploy. This is
 * the whole reason `/admin/bands` is a usable screen on a young catalogue.
 *
 * BEHIND A DISCLOSURE, WHICH IS A JUDGEMENT RATHER THAN TIDINESS. The computed
 * path is the routine one and should be what the eye lands on: a band the data
 * asked for, with the sample beside it, is better evidence than a band somebody
 * remembers. So this is always reachable and never first.
 *
 * THE BOUND IS PRINTED, NOT DISCOVERED. `STATED_BAND_MAX_FACTOR` refuses a move
 * larger than a multiple of what is published, and `/providers/standards` settled
 * the general rule for this product: a threshold people can only find by tripping
 * it is a trap, not deterrence. So the caption says what the limit is and what to
 * do about it — two steps — before anybody types.
 *
 * THE BOXES ARE NOT PRE-FILLED WITH THE CURRENT BAND, deliberately. Pre-filling
 * invites a single-digit edit, which is precisely the slip the guard exists to
 * catch, and a form that arrives looking complete is a form somebody submits
 * without reading. The current figures are the placeholders instead: the
 * reference is at the point of typing and is not the value being sent.
 */
export function StateBandForm({
  slug,
  currentLow,
  currentHigh,
  maxFactor,
  minWidth,
  state,
}: {
  slug: string;
  currentLow: number;
  currentHigh: number;
  /** `STATED_BAND_MAX_FACTOR`, passed in so the caption can name it. */
  maxFactor: number;
  /** `BAND_ROUNDING`, likewise — a band narrower than this is not a band. */
  minWidth: number;
  state: Action;
}) {
  const t = useTranslations("admin.bands.state");
  const [result, setResult] = React.useState<ActionResult | null>(null);

  return (
    <details className="mt-4 border-t border-border pt-3">
      {/*
        THE FIRST DISCLOSURE IN THE PRODUCT, so it sets the shape. A bare
        <summary> has no hover, press or focus state of its own, which the motion
        rule asks of every interactive element — and a keyboard reader needs the
        ring most, since this is how the form is reached at all.
      */}
      <summary className="-mx-1 cursor-pointer rounded-md px-1 text-body-sm font-semibold transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:text-foreground/70">
        {t("open")}
      </summary>

      {/*
        AND THE BODY ARRIVES RATHER THAN APPEARING. A browser takes <details>
        content out of flow with `display: none`, so going back into flow
        restarts a CSS animation on it — which is what makes one class enough
        here, with no JavaScript and no state of our own. `.animate-rise` carries
        its own `prefers-reduced-motion` fallback.
      */}
      <div className="animate-rise">
        <p className="mt-2 text-caption text-muted-foreground">{t("lead")}</p>
        {/*
        BOTH RULES, BEFORE ANYBODY TYPES. The numbers come from the constants
        rather than from the sentence, so a copy in the catalogue cannot go stale
        while rendering perfectly — and `/providers/standards` settled the
        general point: a threshold people can only find by tripping it is a trap
        rather than deterrence.
      */}
        <p className="mt-1 text-caption text-muted-foreground">
          {t("bound", { count: maxFactor, n: String(maxFactor) })}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("width", { gap: String(minWidth) })}
        </p>

        <form
          className="mt-3 space-y-2"
          action={async (data: FormData) => setResult(await state(data))}
        >
          <input type="hidden" name="slug" value={slug} />

          <div className="flex flex-wrap gap-3">
            <div className="min-w-32 flex-1 space-y-1.5">
              <Label htmlFor={`stated-low-${slug}`}>{t("floor")}</Label>
              <Input
                id={`stated-low-${slug}`}
                name="statedLow"
                type="number"
                inputMode="numeric"
                step={1}
                min={1}
                required
                placeholder={String(currentLow)}
                autoComplete="off"
              />
            </div>
            <div className="min-w-32 flex-1 space-y-1.5">
              <Label htmlFor={`stated-high-${slug}`}>{t("ceiling")}</Label>
              <Input
                id={`stated-high-${slug}`}
                name="statedHigh"
                type="number"
                inputMode="numeric"
                step={1}
                min={1}
                required
                placeholder={String(currentHigh)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`stated-reason-${slug}`}>{t("why")}</Label>
            <Input
              id={`stated-reason-${slug}`}
              name="reason"
              required
              minLength={4}
              autoComplete="off"
            />
          </div>

          <StateSubmit label={t("publish")} busy={t("working")} />

          {result?.ok ? (
            <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
              <Check className="size-4" aria-hidden />
              {t("done")}
            </p>
          ) : result && isReauthReason(result.reason) ? (
            /* A code, not a bug — one sentence with the link, for nine screens. */
            <ReauthNotice />
          ) : result ? (
            <p
              role="alert"
              className="animate-rise text-body-sm text-destructive-ink"
            >
              {t(`errors.${result.reason}` as "errors.refused")}
            </p>
          ) : null}
        </form>
      </div>
    </details>
  );
}

/** The same press state as above, for a form with one button rather than two. */
function StateSubmit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {busy}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
