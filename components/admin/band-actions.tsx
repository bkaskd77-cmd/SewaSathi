"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

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
        <p role="alert" className="animate-rise text-body-sm text-destructive-ink">
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
