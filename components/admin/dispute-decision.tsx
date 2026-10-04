"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Decide one customer's objection to a carried trip charge.
 *
 * THE TWO OUTCOMES ARE NOT SYMMETRICAL AND THE LABELS SAY SO. "Cancel the charge"
 * writes the balance to zero — we absorb the trip, which is what the first-one-free
 * rule already does in the ordinary case. "The charge stands" clears the hold and the
 * next bill recovers as it would have. Neither touches the professional: they were paid
 * when the claim was upheld, and whether we recover it from the customer was always a
 * separate question.
 *
 * A REASON IS REQUIRED, and the field enforces it as well as the server — the same
 * arrangement as `ClaimDecision` beside it. A decision that moves or confirms what
 * somebody owes has to be answerable later from one row.
 *
 * NO `useSecondsOnEvidence` HERE, deliberately: there is no evidence to spend time on
 * beyond a sentence the customer wrote. A timer on this form would record a number that
 * means nothing, which is worse than recording none.
 */
export function DisputeDecision({ customerId }: { customerId: string }) {
  const t = useTranslations("admin.claims");
  const [, action] = useFormState(resolve, null);

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="customerId" value={customerId} />

      <div className="space-y-1.5">
        <Label htmlFor={`dispute-reason-${customerId}`}>{t("reason")}</Label>
        <textarea
          id={`dispute-reason-${customerId}`}
          name="reason"
          rows={2}
          required
          minLength={5}
          className="w-full rounded-md border border-input bg-background p-3 text-body-md"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Send label={t("disputeCancel")} value="cancel" primary />
        <Send label={t("disputeStands")} value="stands" />
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
      name="outcome"
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
async function resolve(
  _previous: { ok: boolean } | null,
  formData: FormData,
): Promise<{ ok: boolean }> {
  const { resolveDisputeAction } = await import(
    "@/app/[locale]/(admin)/admin/claims/actions"
  );
  return resolveDisputeAction(formData);
}
