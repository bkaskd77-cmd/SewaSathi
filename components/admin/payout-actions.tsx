"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Eye, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActionResult = {
  ok: boolean;
  recomputed?: true;
  net?: number;
  reason?: string;
};

type Action = (data: FormData) => Promise<ActionResult>;

type RevealResult = {
  ok: boolean;
  accountRef?: string;
  accountName?: string;
  reason?: string;
};

/**
 * What a person can do to one payout, with the reason they have to give.
 *
 * THE REASON IS A FIELD, NOT A CONFIRMATION DIALOG. An "are you sure" teaches
 * somebody to tap through approvals — `lib/payments/pricing.ts` refuses to do that
 * to customers and there is no argument for doing it to the person moving their
 * money. Typing why is both the pause and the record, and it is the thing somebody
 * reads six months later when a professional asks what happened.
 *
 * THE RECOMPUTE IS NOT AN ERROR AND DOES NOT READ AS ONE. If the ledger moved
 * between the draft and the approval the figure is recalculated and shown; nothing
 * was approved and nothing failed. A red sentence there would send somebody looking
 * for a fault that does not exist — the correct next action is to read the new
 * number and press again.
 */
export function PayoutActions({
  payoutId,
  status,
  destinationId,
  approve,
  markSent,
  markConfirmed,
  markFailed,
  reveal,
}: {
  payoutId: string;
  status: "draft" | "approved" | "sent";
  destinationId: string | null;
  approve: Action;
  markSent: Action;
  markConfirmed: Action;
  markFailed: Action;
  reveal: (data: FormData) => Promise<RevealResult>;
}) {
  const t = useTranslations("admin.payouts");
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [revealed, setRevealed] = React.useState<RevealResult | null>(null);

  const run = (action: Action) => async (data: FormData) => {
    setResult(await action(data));
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      {status === "draft" ? (
        <form action={run(approve)} className="space-y-2">
          <input type="hidden" name="payoutId" value={payoutId} />
          <ReasonField id={`approve-${payoutId}`} label={t("approveWhy")} />
          <SubmitButton label={t("approve")} busy={t("working")} />
        </form>
      ) : null}

      {status === "approved" ? (
        <form action={run(markSent)} className="space-y-2">
          <input type="hidden" name="payoutId" value={payoutId} />
          <div className="space-y-1.5">
            <Label htmlFor={`reference-${payoutId}`}>{t("reference")}</Label>
            <Input
              id={`reference-${payoutId}`}
              name="reference"
              required
              autoComplete="off"
              placeholder={t("referencePlaceholder")}
            />
            <p className="text-body-sm text-muted-foreground">
              {t("referenceWhy")}
            </p>
          </div>
          <ReasonField id={`sent-${payoutId}`} label={t("sentWhy")} />
          <SubmitButton label={t("markSent")} busy={t("working")} />
        </form>
      ) : null}

      {status === "sent" ? (
        <form action={run(markConfirmed)}>
          <input type="hidden" name="payoutId" value={payoutId} />
          <SubmitButton label={t("markConfirmed")} busy={t("working")} />
          <p className="mt-1.5 text-body-sm text-muted-foreground">
            {t("confirmWhy")}
          </p>
        </form>
      ) : null}

      <form action={run(markFailed)} className="space-y-2">
        <input type="hidden" name="payoutId" value={payoutId} />
        <ReasonField id={`failed-${payoutId}`} label={t("failedWhy")} />
        <SubmitButton
          label={t("markFailed")}
          busy={t("working")}
          variant="outline"
        />
      </form>

      {destinationId ? (
        <form
          action={async (data) => setRevealed(await reveal(data))}
          className="space-y-2"
        >
          <input type="hidden" name="destinationId" value={destinationId} />
          <ReasonField id={`reveal-${payoutId}`} label={t("revealWhy")} />
          {revealed?.ok ? (
            <p className="animate-rise font-mono text-body-md">
              {revealed.accountRef}
              <span className="ml-2 font-sans text-body-sm text-muted-foreground">
                {revealed.accountName}
              </span>
            </p>
          ) : (
            <SubmitButton
              label={t("reveal")}
              busy={t("working")}
              variant="outline"
              icon={<Eye className="size-4" aria-hidden />}
            />
          )}
          {revealed && !revealed.ok ? (
            <p role="alert" className="animate-rise text-body-sm text-destructive-ink">
              {t(`errors.${revealed.reason}` as "errors.generic")}
            </p>
          ) : null}
        </form>
      ) : null}

      {result?.ok && result.recomputed ? (
        <p className="animate-rise text-body-sm text-warning-ink">
          {t("recomputed", { n: String(result.net ?? 0) })}
        </p>
      ) : result?.ok ? (
        <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
          <Check className="size-4" aria-hidden />
          {t("done")}
        </p>
      ) : result ? (
        <p role="alert" className="animate-rise text-body-sm text-destructive-ink">
          {t(`errors.${result.reason}` as "errors.generic")}
        </p>
      ) : null}
    </div>
  );
}

function ReasonField({ id, label }: { id: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name="reason" required minLength={4} autoComplete="off" />
    </div>
  );
}

function SubmitButton({
  label,
  busy,
  variant,
  icon,
}: {
  label: string;
  busy: string;
  variant?: "outline";
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {busy}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </Button>
  );
}
