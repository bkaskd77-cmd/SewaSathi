"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Result = { ok: boolean; reason?: string } | null;

/**
 * Reasons this screen has a sentence for.
 *
 * `monthlyCap` is the one that matters and it is not an error: the fifth
 * approved trip in one month is refused by `enforce_survey_visit_fee`, and a
 * reviewer who sees "save failed" instead will try again, then ask somebody.
 * The cap is a policy, so it reads as one.
 */
const KNOWN = [
  "alreadyDecided",
  "monthlyCap",
  "notAdmin",
  "notConfigured",
  "notFound",
  "reasonRequired",
  "saveFailed",
] as const;

/**
 * Pay this trip, or refuse it.
 *
 * WHAT IS BEING DECIDED. Not whether the professional did anything wrong —
 * the customer declined the quote or let it lapse, and neither is a fault.
 * It is whether this particular trip is one we cover. The buttons say "pay the
 * trip" rather than "approve" for the same reason the wasted-trip queue's do:
 * a reviewer should never be unsure which question is in front of them.
 *
 * A REASON IS REQUIRED IN BOTH DIRECTIONS. A refusal with no sentence is a
 * professional out of pocket with nothing to read, and this is the only record
 * of why — `decision_note` is what a person sees if they ever ask.
 */
export function SurveyFeeDecision({ feeId }: { feeId: string }) {
  const t = useTranslations("admin.surveyFees");
  const [result, action] = useFormState(decide, null);

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="feeId" value={feeId} />

      <div className="space-y-1.5">
        <Label htmlFor={`note-${feeId}`}>{t("note")}</Label>
        <textarea
          id={`note-${feeId}`}
          name="note"
          rows={2}
          required
          minLength={3}
          className="w-full rounded-md border border-input bg-background p-3 text-body-md"
        />
      </div>

      {result && !result.ok ? (
        <p
          role="alert"
          className="animate-pop-in text-body-sm text-destructive-ink"
        >
          {t(
            `errors.${
              (KNOWN as readonly string[]).includes(result.reason ?? "")
                ? result.reason
                : "saveFailed"
            }`,
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Send label={t("approve")} value="approve" primary />
        <Send label={t("refuse")} value="refuse" />
      </div>
    </form>
  );
}

function Send({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="verdict"
      value={value}
      variant={primary ? "default" : "outline"}
      className="btn-tactile"
      disabled={pending}
    >
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}

/** Bound at call time so the component stays a plain client component. */
async function decide(_previous: Result, formData: FormData): Promise<Result> {
  const { decideSurveyFeeAction } = await import(
    "@/app/[locale]/(admin)/admin/survey-fees/actions"
  );
  return decideSurveyFeeAction(formData);
}
