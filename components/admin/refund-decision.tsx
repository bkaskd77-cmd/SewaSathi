"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = { ok: boolean; reason?: string } | null;

/**
 * Reasons this screen has a sentence for.
 *
 * The four in the middle are the database's, and each is a policy rather than
 * a failure: `enforce_claim_refund` has no service-role bypass, so a reviewer
 * meets them here as rules and not as "save failed". `aboveCeiling` is the one
 * that matters most — the ceiling is on the card, so hitting it means somebody
 * typed past a number they were shown.
 */
const KNOWN = [
  "aboveCeiling",
  "alreadyRefunded",
  "amountDisputed",
  "notSettled",
  "outsideWindow",
  "invalid",
  "noPayment",
  "notAdmin",
  "notConfigured",
  "notFound",
  "reasonRequired",
  "saveFailed",
  // `judgeRefund`'s own outcomes, which reach here before the database does.
  "above-ceiling",
  "already-refunded",
  "unavailable",
] as const;

const errorKey = (reason: string | undefined) =>
  (KNOWN as readonly string[]).includes(reason ?? "") ? reason! : "saveFailed";

/**
 * Agree money back on one claim.
 *
 * THIS IS THE ONLY WAY A REFUND HAPPENS IN THIS PRODUCT. No verdict, and no
 * combination of verdicts, produces one — that is the whole anti-farming
 * design, because the generous half of the guarantee is labour we do not pay
 * for and the expensive half must never run on its own.
 *
 * THE AMOUNT IS TYPED AND THE CEILING IS PRINTED ABOVE IT. Not a set of
 * buttons for "half" and "all": a partial refund is a judgement about how much
 * of the work was wasted and only the person reading the visit's note can make
 * it. The ceiling is the lower of what was recorded and what the customer said
 * they handed over, and the database refuses a rupee over it whatever this
 * screen sends.
 *
 * IT APPROVES, IT DOES NOT SEND. The row is written at `requested` and a
 * person still has to move the money on two of our three rails. The button
 * says so.
 */
export function RefundDecision({
  claimId,
  ceiling,
}: {
  claimId: string;
  /** Null when the booking can pay nothing back — the form is not shown. */
  ceiling: number | null;
}) {
  const t = useTranslations("admin.guaranteeClaims");
  const [result, action] = useFormState(decide, null);

  if (ceiling === null) return null;

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="claimId" value={claimId} />

      <div className="space-y-1.5">
        <Label htmlFor={`amount-${claimId}`}>{t("amount")}</Label>
        <Input
          id={`amount-${claimId}`}
          name="amount"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={ceiling}
          step={1}
          className="max-w-40"
        />
      </div>

      <div className="space-y-1.5">
        {/* Required, and stored. This is the only record of why money went
            back, and the one a person reads if it is ever questioned. */}
        <Label htmlFor={`why-${claimId}`}>{t("why")}</Label>
        <textarea
          id={`why-${claimId}`}
          name="note"
          rows={2}
          required
          minLength={3}
          maxLength={500}
          className="w-full rounded-md border border-input bg-background p-3 text-body-md"
        />
      </div>

      {result && !result.ok ? (
        <p
          role="alert"
          className="animate-pop-in text-body-sm text-destructive-ink"
        >
          {t(`errors.${errorKey(result.reason)}`)}
        </p>
      ) : null}

      <Approve label={t("approve")} />
    </form>
  );
}

function Approve({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" className="btn-tactile" disabled={pending}>
      {pending ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : null}
      {label}
    </Button>
  );
}

/** Bound at call time so this stays a plain client component. */
async function decide(_previous: Result, formData: FormData): Promise<Result> {
  const { issueRefundAction } = await import(
    "@/app/[locale]/(admin)/admin/guarantee-claims/actions"
  );
  return issueRefundAction(formData);
}
