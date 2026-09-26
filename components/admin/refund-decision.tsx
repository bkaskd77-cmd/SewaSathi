"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAYOUT_RULES, refundFunding } from "@/lib/payments/client";
import { formatNpr } from "@/lib/utils";

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
 * it. The ceiling is the SETTLED figure less any parts the attending
 * professional recorded as sound, and the database refuses a rupee over it
 * whatever this screen sends. (It used to be the lower of the recorded figure
 * and the customer's own typed one; that re-imposed somebody's mistyped number
 * as their cover after a person had established what was really paid.)
 *
 * AND THE CONSEQUENCE IS SHOWN BEFORE THE BUTTON. Approving used to print one
 * figure — the customer's — while doing three things: paying them, returning
 * our commission in proportion, and writing the rest as a debt against a
 * professional's future earnings. Two of those were invisible at the moment
 * somebody decided. `refundFunding` is the same pure rule `agreeRefund` runs
 * server-side on the same frozen split, so the preview cannot say one thing
 * and the write do another.
 *
 * IT APPROVES, IT DOES NOT SEND. The row is written at `requested` and a
 * person still has to move the money on two of our three rails. The button
 * says so.
 */
export function RefundDecision({
  claimId,
  ceiling,
  platformFee,
  providerEarning,
  locale,
}: {
  claimId: string;
  /** Null when the booking can pay nothing back — the form is not shown. */
  ceiling: number | null;
  /** The split frozen on the booking when it settled. */
  platformFee: number;
  providerEarning: number;
  locale: Locale;
}) {
  const t = useTranslations("admin.guaranteeClaims");
  const [result, action] = useFormState(decide, null);
  const [amount, setAmount] = React.useState("");

  const typed = Number(amount);
  const consequence =
    amount.trim() !== "" && Number.isFinite(typed) && typed > 0
      ? (() => {
          const funding = refundFunding({
            refund: typed,
            platformFee,
            providerEarning,
          });
          /*
           * HOW MANY PAYOUTS OF THIS SIZE IT TAKES. Measured against what this
           * professional earned on THIS job, because it is the one earning
           * figure we hold here and a job they actually did — a platform-wide
           * average would be a number about somebody else.
           *
           * Null rather than a guess when the earning is zero or missing:
           * dividing by it would print Infinity, and rule 6 says an unmeasured
           * figure says so rather than rendering something.
           */
          const perPayout =
            (providerEarning * PAYOUT_RULES.redoRecoveryCapBps) / 10000;
          return {
            ...funding,
            payouts:
              perPayout > 0 ? Math.ceil(funding.providerOwes / perPayout) : null,
          };
        })()
      : null;

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
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
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

      {/*
          WHAT THIS BUTTON ACTUALLY DOES, IN THREE LINES.

          It appears as soon as there is an amount and disappears when the
          field is cleared, because a stale preview beside an empty box is
          worse than none. The figures are `refundFunding` over the split
          frozen on the booking at settlement — the same function and the same
          inputs the server uses, so this is a preview and not a second
          opinion.
       */}
      {consequence ? (
        <dl className="animate-pop-in space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-body-sm">
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted-foreground">{t("preview.customer")}</dt>
            <dd className="tabular-nums font-semibold">
              {formatNpr(consequence.customerReceives, { locale })}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4">
            {/* Proportional, and that is the rule that lets us say we do not
                profit from failed work: a full refund returns the whole fee. */}
            <dt className="text-muted-foreground">{t("preview.commission")}</dt>
            <dd className="tabular-nums">
              {formatNpr(consequence.platformReturns, { locale })}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted-foreground">{t("preview.provider")}</dt>
            <dd className="tabular-nums">
              {formatNpr(consequence.providerOwes, { locale })}
            </dd>
          </div>

          {/*
              THE HONEST PART. "Owes Rs 2,550" sounds like money we will have;
              it is a debt netted forward at a quarter of each payout and never
              chased backward. On a job of this size that is a number of
              payouts, and on a small earner it is a lot of them — which is the
              fact a reviewer needs when they are also looking at what this
              professional already owes.
           */}
          {consequence.payouts !== null ? (
            <p className="pt-1 text-caption text-muted-foreground">
              {t("preview.recovery", {
                n: String(consequence.payouts),
                count: consequence.payouts,
                share: String(PAYOUT_RULES.redoRecoveryCapBps / 100),
              })}
            </p>
          ) : (
            <p className="pt-1 text-caption text-muted-foreground">
              {t("preview.recoveryUnknown")}
            </p>
          )}
        </dl>
      ) : null}

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
