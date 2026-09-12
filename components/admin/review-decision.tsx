"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { useSecondsOnEvidence } from "./use-seconds-on-evidence";

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
    /** Whether a file exists. The URL is fetched when it is opened. */
    hasFile: boolean;
  }>;
  /** Mints a short-lived signed URL, and records the look in the audit log. */
  openDocumentAction: (
    documentId: string,
  ) => Promise<{ ok: true; url: string } | { ok: false }>;
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
  /*
   * Recorded, never enforced. Nothing on this screen refuses a fast decision;
   * the point is that a run of two-second approvals is visible to whoever
   * reads the audit trail later. See use-seconds-on-evidence.ts.
   */
  const secondsOnEvidence = useSecondsOnEvidence();

  const openable = props.documents.filter((document) => document.hasFile);
  const [opened, setOpened] = React.useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = React.useState(false);
  const [failed, setFailed] = React.useState<Set<string>>(new Set());

  /*
   * THE TAB IS OPENED SYNCHRONOUSLY, THEN POINTED AT THE URL.
   *
   * The URL is now fetched when the reviewer asks for it, which takes a round
   * trip — and a browser blocks `window.open` that happens after an await,
   * because by then it is no longer attributable to the click. So the blank
   * tab is claimed inside the handler and its location is set once the signed
   * URL arrives.
   */
  const open = React.useCallback(
    (documentId: string) => {
      /*
       * NO `noopener` IN THE FEATURE STRING, AND THAT IS THE WHOLE BUG.
       *
       * It was there, and `noopener` makes `window.open` return null by
       * design — severing the reference is the point of it. So the new tab
       * opened and sat on about:blank for ever, while the null handle sent the
       * code down the fallback that navigated the CURRENT tab to the image.
       * The reviewer lost the application they were reading and had to find
       * their way back.
       *
       * The protection `noopener` provides is given back below by nulling
       * `opener` before navigating. That is safe here because the tab starts
       * as same-origin about:blank, so it is still ours to write to.
       */
      const tab = window.open("", "_blank");

      void (async () => {
        const result = await props.openDocumentAction(documentId);

        if (!result.ok) {
          tab?.close();
          setFailed((previous) => new Set(previous).add(documentId));
          return;
        }

        setOpened((previous) => new Set(previous).add(documentId));

        if (!tab) {
          /*
           * A popup blocker took it. The current tab is NOT navigated away —
           * losing a half-written decision to see one photograph is a worse
           * trade than asking for a second click, and it is the mistake this
           * fix exists to undo.
           */
          setFailed((previous) => new Set(previous).add(documentId));
          return;
        }

        // Hand back what `noopener` would have done for us.
        try {
          tab.opener = null;
        } catch {
          // Already navigated or cross-origin; nothing to sever.
        }
        // `replace`, so Back from the photograph does not land on about:blank.
        tab.location.replace(result.url);
      })();
    },
    [props],
  );

  const allOpened = openable.every((document) => opened.has(document.id));

  return (
    <div className="mt-8 rounded-lg border border-border p-5">
      <h2 className="font-display text-heading-sm">{t("decideTitle")}</h2>

      {/* Each document, at a size a number can be read at, opened on purpose. */}
      <ul className="mt-4 space-y-2">
        {props.documents.map((document) => (
          <li key={document.id} className="flex items-center justify-between gap-3">
            <span className="text-body-sm">{document.label}</span>
            {document.hasFile ? (
              <button
                type="button"
                onClick={() => open(document.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-body-sm underline underline-offset-2 transition-colors",
                  failed.has(document.id)
                    ? "text-destructive"
                    : opened.has(document.id)
                      ? "text-muted-foreground"
                      : "text-primary",
                )}
              >
                {failed.has(document.id) ? t("openFailed") : t("openDocument")}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </button>
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
        <input
          type="hidden"
          name="secondsOnEvidence"
          value={secondsOnEvidence()}
        />

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
