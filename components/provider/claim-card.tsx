"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A job that has come back, on the screen of the professional whose it was.
 *
 * GOING BACK IS OFFERED, NEVER ASSIGNED. Somebody ordered to return to a job
 * they believe they did correctly is somebody who stops taking our work, and
 * the verdict they would then record is worth nothing. So this is a button
 * they press, and declining reopens the claim rather than stalling it.
 *
 * THE VERDICT IS THE WHOLE POINT AND IT COSTS THEM MONEY TO BE HONEST. Only
 * `sameFault` is unpaid; the other three are ordinary jobs at ordinary prices.
 * That conflict of interest is named in `lib/config/guarantee.ts` and answered
 * the same way as under-reporting: not policed, measured. Nothing on this card
 * hints at which answer pays better, because a screen that did would be
 * teaching people to game it.
 */
export type ProviderClaim = {
  id: string;
  reference: string;
  status: string;
  description: string;
  /** True when this professional did the original job. */
  mine: boolean;
  /** True when they are the one who went, or is going, to look. */
  attending: boolean;
  verdict: string | null;
};

const VERDICTS = [
  "sameFault",
  "differentProblem",
  "nothingWrong",
  "customerCaused",
] as const;

export function ClaimCard({ claim }: { claim: ProviderClaim }) {
  const t = useTranslations("provider.dashboard.claims");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [verdict, setVerdict] = React.useState<string>("");
  const [note, setNote] = React.useState("");

  async function run(work: () => Promise<{ ok: boolean }>) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await work();
      if (!result.ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="animate-rise rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body-sm font-semibold text-foreground">
          {claim.reference}
        </p>
        <p className="text-caption text-muted-foreground">
          {t(`status.${claim.status}`)}
        </p>
      </div>

      <p className="text-caption mt-2 text-muted-foreground">
        {claim.description}
      </p>

      {claim.status === "open" ? (
        <div className="mt-3 space-y-2">
          <p className="text-caption text-foreground">{t("askToGo")}</p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { acceptClaimAction } = await import(
                  "@/app/[locale]/(work)/provider/actions"
                );
                return acceptClaimAction(claim.id);
              })
            }
          >
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("accept")}
          </Button>
        </div>
      ) : null}

      {claim.status === "dispatched" && claim.attending ? (
        <div className="mt-3 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-caption font-medium text-foreground">
              {t("whatDidYouFind")}
            </legend>
            {VERDICTS.map((option) => (
              <label
                key={option}
                className="flex items-start gap-2 text-caption text-muted-foreground"
              >
                <input
                  type="radio"
                  name={`verdict-${claim.id}`}
                  value={option}
                  checked={verdict === option}
                  onChange={() => setVerdict(option)}
                  className="mt-1"
                />
                <span>{t(`verdict.${option}`)}</span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor={`note-${claim.id}`}>{t("noteLabel")}</Label>
            <Input
              id={`note-${claim.id}`}
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !verdict}
              onClick={() =>
                void run(async () => {
                  const { recordVerdictAction } = await import(
                    "@/app/[locale]/(work)/provider/actions"
                  );
                  return recordVerdictAction(claim.id, verdict, note);
                })
              }
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {t("record")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { releaseClaimAction } = await import(
                    "@/app/[locale]/(work)/provider/actions"
                  );
                  return releaseClaimAction(claim.id);
                })
              }
            >
              {t("cannotGo")}
            </Button>
          </div>
        </div>
      ) : null}

      {claim.verdict ? (
        <p className="text-caption mt-2 text-foreground">
          {t(`verdict.${claim.verdict}`)}
        </p>
      ) : null}

      {failed ? (
        <p role="alert" className="text-caption mt-2 text-destructive-ink">
          {t("failed")}
        </p>
      ) : null}
    </li>
  );
}
