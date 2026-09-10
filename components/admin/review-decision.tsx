"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The step where verification actually happens.
 *
 * THE REAL FAILURE MODE IS NOT A CLEVER FORGERY. It is a tired person at the
 * end of an afternoon with eleven applications left, clicking approve because
 * the page looked like every other page. Everything else in this phase — the
 * match keys, the capture checks, the scoring — is preparation for this one
 * moment, and none of it helps if the moment is a reflex.
 *
 * SO APPROVING REQUIRES HAVING OPENED THE EVIDENCE, and not merely having
 * ticked a box saying so. Each document opens in a new tab and is counted; the
 * confirmation cannot be ticked until every one of them has been opened, and
 * the decision cannot be sent until it is ticked. It is a small amount of
 * friction placed at exactly the point where friction is worth paying for.
 *
 * IT IS NOT A LOCK. There is no way to make somebody LOOK at a photograph, and
 * pretending otherwise would be theatre. What this does is make skipping it a
 * deliberate act rather than the path of least resistance — which is the most
 * an interface can honestly do.
 */

export type ReviewDecisionProps = {
  applicationId: string;
  /**
   * Every document with a URL. Missing ones are shown but need no opening.
   *
   * `label` arrives already translated. The document names live in the
   * applicant's namespace, and shipping that whole catalogue to this screen
   * just to name five rows would be the wrong trade.
   */
  documents: Array<{
    id: string;
    kind: string;
    label: string;
    url: string | null;
  }>;
  /** Duplicate hits the reviewer must have scrolled past. */
  duplicateCount: number;
  decideAction: (
    previous: { ok: boolean; error?: string } | null,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string }>;
};

function Send({ label, tone }: { label: string; tone: "approve" | "reject" | "more" }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={
        tone === "approve" ? "approved" : tone === "reject" ? "rejected" : "more_info"
      }
      variant={tone === "approve" ? "default" : "outline"}
      className={cn("btn-tactile", tone === "reject" && "text-destructive")}
      disabled={pending}
    >
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function ReviewDecision(props: ReviewDecisionProps) {
  const t = useTranslations("admin.detail");
  const [state, action] = useFormState(props.decideAction, null);

  const openable = props.documents.filter((document) => document.url);
  const [opened, setOpened] = React.useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = React.useState(false);

  const allOpened = openable.every((document) => opened.has(document.id));

  return (
    <div className="mt-8 rounded-lg border border-border p-5">
      <h2 className="font-display text-heading-sm">{t("decideTitle")}</h2>

      {/* Each document, at a size a number can be read at, opened on purpose. */}
      <ul className="mt-4 space-y-2">
        {props.documents.map((document) => (
          <li key={document.id} className="flex items-center justify-between gap-3">
            <span className="text-body-sm">{document.label}</span>
            {document.url ? (
              <a
                href={document.url}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  setOpened((previous) => new Set(previous).add(document.id))
                }
                className={cn(
                  "inline-flex items-center gap-1.5 text-body-sm underline underline-offset-2 transition-colors",
                  opened.has(document.id)
                    ? "text-muted-foreground"
                    : "text-primary",
                )}
              >
                {t("openDocument")}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : (
              <span className="text-body-sm text-warning-ink">
                {t("documentMissing")}
              </span>
            )}
          </li>
        ))}
      </ul>

      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="applicationId" value={props.applicationId} />

        <div className="space-y-1.5">
          <Label htmlFor="reason">{t("reasonLabel")}</Label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            required
            minLength={5}
            className="w-full rounded-md border border-input bg-background p-3 text-body-md"
          />
          <p className="text-caption text-muted-foreground">{t("reasonHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="internalNote">{t("internalLabel")}</Label>
          <textarea
            id="internalNote"
            name="internalNote"
            rows={2}
            className="w-full rounded-md border border-input bg-background p-3 text-body-md"
          />
        </div>

        <label
          className={cn(
            "flex items-start gap-2.5 rounded-md border p-3 text-body-sm transition-colors",
            allOpened ? "border-border" : "border-warning/40 bg-warning/5",
          )}
        >
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!allOpened}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-40"
          />
          <span className={cn(!allOpened && "text-muted-foreground")}>
            {t("confirmSeen")}
          </span>
        </label>

        {!allOpened ? (
          <p className="animate-rise text-body-sm text-warning-ink" role="status">
            {t("mustConfirm")}
          </p>
        ) : null}

        {state && !state.ok ? (
          <p className="animate-rise text-body-sm text-destructive" role="alert">
            {t("reasonHint")}
          </p>
        ) : null}

        <fieldset disabled={!confirmed} className="flex flex-wrap gap-2">
          <Send label={t("approve")} tone="approve" />
          <Send label={t("moreInfo")} tone="more" />
          <Send label={t("reject")} tone="reject" />
        </fieldset>
      </form>
    </div>
  );
}
