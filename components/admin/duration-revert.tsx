"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RevertResult =
  | { ok: true; from: number; to: number; releaseAt: number }
  | { ok: false; why: string };

type Action = (data: FormData) => Promise<RevertResult>;

/**
 * Take a published duration back down, in one action.
 *
 * ONE BUTTON AND NO NUMBER FIELD. The figure it reverts TO is read off the
 * promotion's own observation row — the value and provenance in force the
 * moment the loop replaced them — so there is nothing for anybody to type. A
 * box here would be a second way to publish a duration nobody measured, which
 * is exactly what `duration_source = 'invented'` already means and what the
 * loop exists to get away from.
 *
 * THE REASON IS A FIELD, NOT A CONFIRMATION DIALOG — `BandActions`'s choice and
 * for its reason: an "are you sure" teaches somebody to tap through, where
 * typing why is the pause and the record at once. Here the record does work
 * beyond history: the sentence is what the screen shows the next person who
 * finds this figure suppressed.
 *
 * IT IS DELIBERATELY NOT DESTRUCTIVE-STYLED. A revert is an ordinary
 * correction, forward-only — the loop will publish again once the evidence
 * moves — and colouring it like a deletion would overstate what it does, the
 * same reason `WITHDRAWAL_RANKING_PENALTY_MAX` says "ranking" rather than
 * reading as a fine.
 */
export function DurationRevert({
  categorySlug,
  bandSlug,
  kind,
  unit,
  revert,
}: {
  categorySlug: string;
  bandSlug: string;
  kind: "minutes" | "span";
  unit: string;
  revert: Action;
}) {
  const t = useTranslations("admin.duration.revert");
  const [result, setResult] = React.useState<RevertResult | null>(null);
  const id = `${categorySlug}-${bandSlug}-${kind}`;

  return (
    <form
      className="mt-2 space-y-2"
      action={async (data: FormData) => setResult(await revert(data))}
    >
      <input type="hidden" name="categorySlug" value={categorySlug} />
      <input type="hidden" name="bandSlug" value={bandSlug} />
      <input type="hidden" name="kind" value={kind} />

      <div className="space-y-1.5">
        <Label htmlFor={`revert-${id}`} className="text-caption">
          {t("why")}
        </Label>
        <Input
          id={`revert-${id}`}
          name="reason"
          required
          minLength={4}
          autoComplete="off"
        />
      </div>

      <SubmitButton label={t("button")} busy={t("working")} />

      {result?.ok ? (
        <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
          <Check className="size-4" aria-hidden />
          {/* THE RELEASE SAMPLE IS IN THE CONFIRMATION, not only on the row
              afterwards. Somebody who has just reverted a figure needs to know
              the loop is held rather than defeated, because the alternative
              reading — "it will be back tonight" — is what a revert without
              suppression actually did. */}
          {t("done", {
            from: String(result.from),
            to: String(result.to),
            unit,
            n: String(result.releaseAt),
          })}
        </p>
      ) : result ? (
        <p role="alert" className="animate-rise text-body-sm text-destructive-ink">
          {t(`errors.${result.why}` as "errors.writeFailed")}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {busy}
        </>
      ) : (
        <>
          <Undo2 className="size-4" aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}
