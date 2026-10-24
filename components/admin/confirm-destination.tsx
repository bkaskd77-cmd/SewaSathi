"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { isReauthReason, ReauthNotice } from "@/components/admin/reauth-notice";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * "I have looked at this, and the first payment may go."
 *
 * THE ID AND, ON ONE PATH, A TYPED SENTENCE. Who confirmed it comes from the
 * session, and the trigger refuses a second confirmation outright. A form
 * carrying the account, the name or the admin's id would be a browser asserting
 * any of them — and `soleControl` is NOT on the wire either: the action re-reads
 * it, because whether a reason is required is a rule and not a claim a browser
 * gets to make.
 *
 * NO CONFIRMATION DIALOG. The act is itself the check — a reviewer who has read
 * the row and pressed the button has done the thing an "are you sure" would be
 * asking about, and a second tap is what teaches people to tap through
 * approvals, which `lib/payments/pricing.ts` already refuses to do to customers.
 *
 * `soleControl` ASKS FOR WORDS, AND THE OTHER PATH DELIBERATELY DOES NOT. Where
 * the change notice reached a device, the professional was told and had 72 hours
 * to object — the admin's yes is a second chance and the silence is the record.
 * Where it reached nobody, this yes is the only control there is, cleared on a
 * phone call to a number an account takeover would also have changed, so how
 * they were reached is the only evidence there will ever be. Asking on both
 * paths is how people learn to type anything into the box that matters.
 */
export function ConfirmDestination({
  destinationId,
  soleControl,
  action,
}: {
  destinationId: string;
  /** Is this yes the only check there is? Decides whether words are required. */
  soleControl?: boolean;
  action: (data: FormData) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const t = useTranslations("admin.payoutDestinations");
  const [result, setResult] = React.useState<{
    ok: boolean;
    reason?: string;
  } | null>(null);

  return (
    <form
      action={async (data) => setResult(await action(data))}
      className="mt-3"
    >
      <input type="hidden" name="destinationId" value={destinationId} />
      {result?.ok ? (
        <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
          <Check className="size-4" aria-hidden />
          {t("confirmed")}
        </p>
      ) : (
        <>
          {/*
            WHY THE BOX IS HERE, ABOVE THE BOX. A required field with no reason
            given is the trap `/providers/standards` refuses one layer out:
            somebody discovers the rule by tripping it. The sentence names what
            makes this row different and what the words are for.
          */}
          {soleControl ? (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-body-sm text-warning-ink">{t("soleControl")}</p>
              <Label htmlFor={`reason-${destinationId}`} className="mt-2 block">
                {t("reasonLabel")}
              </Label>
              <textarea
                id={`reason-${destinationId}`}
                name="reason"
                rows={2}
                required
                maxLength={280}
                placeholder={t("reasonPlaceholder")}
                className="mt-1 w-full rounded-md border border-input bg-background p-2 text-body-sm"
              />
            </div>
          ) : null}
          <ConfirmButton />
          {result && !result.ok ? (
            isReauthReason(result.reason) ? (
              <ReauthNotice />
            ) : (
              <p
                role="alert"
                className="animate-rise mt-2 text-body-sm text-destructive-ink"
              >
                {t(`errors.${result.reason}` as "errors.generic")}
              </p>
            )
          ) : null}
        </>
      )}
    </form>
  );
}

function ConfirmButton() {
  const t = useTranslations("admin.payoutDestinations");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("confirming")}
        </>
      ) : (
        t("confirm")
      )}
    </Button>
  );
}
