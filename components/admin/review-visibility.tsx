"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HOMEPAGE_HIDE_CODES } from "@/lib/reviews";

type Result = { ok: true; hidden: boolean } | { ok: false; why: string };
type Action = (data: FormData) => Promise<Result>;

/**
 * Take one review off the homepage, or put it back.
 *
 * THE CHIPS ARE RENDERED FROM `HOMEPAGE_HIDE_CODES`, never typed out here —
 * `REFUSAL_REASON_CODES`' rule, and for the same reason: a label added to a
 * screen whose write the check constraint refuses loses the decision in the
 * same statement that records it. `tests/db/review-homepage.test.ts` compares
 * the offered set against the constraint out of `pg_constraint`.
 *
 * THERE ARE TWO CHIPS AND NEITHER MEANS "NEGATIVE". That is the whole reason
 * this is a closed set rather than a free-text field: somebody in a hurry with
 * a text box writes "unfair", and the next person reads that as a precedent.
 *
 * THE SENTENCE IS REQUIRED IN BOTH DIRECTIONS, including putting a review back.
 * A restore with no reason leaves a log entry saying a decision was reversed
 * and nothing about why, and the reversal is as worth reading as the hide.
 *
 * NO CONFIRMATION DIALOG — `DurationRevert`'s choice: an "are you sure" teaches
 * somebody to tap through, where typing why is the pause and the record at once.
 */
export function ReviewVisibility({
  reviewId,
  hidden,
  action,
}: {
  reviewId: string;
  hidden: boolean;
  action: Action;
}) {
  const t = useTranslations("admin.reviews");
  const [error, setError] = React.useState<string | null>(null);

  async function submit(data: FormData) {
    const result = await action(data);
    setError(result.ok ? null : result.why);
  }

  return (
    <form action={submit} className="mt-3 border-t border-border pt-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="hidden" value={hidden ? "false" : "true"} />

      <div className="flex flex-wrap items-end gap-3">
        {hidden ? null : (
          <div className="min-w-[8rem]">
            <Label htmlFor={`code-${reviewId}`}>{t("codeLabel")}</Label>
            <select
              id={`code-${reviewId}`}
              name="code"
              required
              defaultValue={HOMEPAGE_HIDE_CODES[0]}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {HOMEPAGE_HIDE_CODES.map((code) => (
                <option key={code} value={code}>
                  {t(`codes.${code}`)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="min-w-[12rem] flex-1">
          <Label htmlFor={`reason-${reviewId}`}>{t("reasonLabel")}</Label>
          <Input
            id={`reason-${reviewId}`}
            name="reason"
            required
            minLength={2}
            maxLength={600}
            className="mt-1"
            placeholder={hidden ? t("restorePlaceholder") : t("hidePlaceholder")}
          />
        </div>

        <Submit hidden={hidden} />
      </div>

      {error ? (
        <p className="animate-rise mt-2 text-caption text-destructive-ink">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </form>
  );
}

function Submit({ hidden }: { hidden: boolean }) {
  const { pending } = useFormStatus();
  const t = useTranslations("admin.reviews");

  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : hidden ? (
        <Eye aria-hidden="true" />
      ) : (
        <EyeOff aria-hidden="true" />
      )}
      {hidden ? t("restore") : t("hide")}
    </Button>
  );
}
