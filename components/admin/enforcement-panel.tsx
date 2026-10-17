"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = { ok: true } | { ok: false; reason: string };
type Action = (data: FormData) => Promise<Result>;

/**
 * Raise or lift a step, with the reason the page promises an appeal can read.
 *
 * THE REASON IS A REQUIRED FIELD AND NOT A COURTESY. `/providers/standards`
 * says "At every step you can see what triggered it, in numbers, and ask a
 * person to look again." A step recorded with no words is one nobody can answer
 * an appeal about — so the form requires it, the writer requires it, and
 * `providers_enforcement_shape` refuses it. Three layers, because this is the
 * sentence a professional is owed when their livelihood changes.
 *
 * WHAT EACH STEP COSTS IS ON THE BUTTON, not in a tooltip and not on another
 * page. Somebody choosing between step 3 and step 4 is choosing between closing
 * the open pool and holding a week of earnings, and a screen that makes those
 * look like adjacent numbers is how the wrong one gets picked.
 */

function Submitting({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : null}
      {label}
    </Button>
  );
}

export function EnforcementPanel({
  providerId,
  displayName,
  step,
  reason,
  setAction,
  liftAction,
  inFlight,
}: {
  providerId: string;
  displayName: string;
  step: number | null;
  reason: string | null;
  setAction: Action;
  liftAction: Action;
  /**
   * The jobs already in flight, rendered by the server and passed in.
   *
   * A SLOT RATHER THAN A FETCH, because this is a Client Component and the read
   * is `createAdminClient()`. Passing the element keeps the service-role query
   * on the server where it belongs — the alternative is an endpoint that hands
   * a browser somebody else's bookings.
   */
  inFlight?: React.ReactNode;
}) {
  const t = useTranslations("admin.enforcement");
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: Action, data: FormData) {
    const result = await action(data);
    setError(result.ok ? null : result.reason);
  }

  return (
    <article className="rounded-lg border border-border bg-card p-4 transition-colors">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium text-foreground">{displayName}</h3>
        {step === null ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden />
            {t("noneInForce")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-warning-ink">
            <ShieldAlert className="size-4" aria-hidden />
            {t("inForce", { n: String(step) })}
          </span>
        )}
      </header>

      {reason ? (
        <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
      ) : null}

      <form action={(data) => run(setAction, data)} className="mt-3 space-y-2">
        <input type="hidden" name="providerId" value={providerId} />
        <Label htmlFor={`reason-${providerId}`} className="text-sm">
          {t("reasonLabel")}
        </Label>
        <Input
          id={`reason-${providerId}`}
          name="reason"
          required
          minLength={1}
          placeholder={t("reasonPlaceholder")}
        />
        <div className="flex flex-wrap gap-2">
          {[3, 4, 5].map((value) => (
            <button
              key={value}
              type="submit"
              name="step"
              value={value}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
            >
              {t(`step${value}` as "step3" | "step4" | "step5")}
            </button>
          ))}
        </div>
      </form>

      {step !== null && step !== 5 ? (
        <form action={(data) => run(liftAction, data)} className="mt-3 space-y-2">
          <input type="hidden" name="providerId" value={providerId} />
          <Label htmlFor={`lift-${providerId}`} className="text-sm">
            {t("liftReasonLabel")}
          </Label>
          <Input id={`lift-${providerId}`} name="reason" required minLength={1} />
          <Submitting label={t("lift")} />
        </form>
      ) : null}

      {step === 5 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("permanent")}</p>
      ) : null}

      {inFlight}

      {error ? (
        <p className="animate-rise mt-3 text-sm text-destructive-ink">
          {t(`error.${error}` as "error.needsReason")}
        </p>
      ) : null}
    </article>
  );
}

/**
 * Suspend a customer, or let them back in.
 *
 * SAME REASON RULE AND SAME GATE. A suspension stops every future booking that
 * account could make; `customer_risk_ban_shape` refuses one with no words, and
 * the action needs the same fifteen-minute proof a payout does.
 */
export function CustomerSuspension({
  profileId,
  fullName,
  reason,
  suspendAction,
  reinstateAction,
}: {
  profileId: string;
  fullName: string | null;
  reason: string | null;
  suspendAction: Action | null;
  reinstateAction: Action | null;
}) {
  const t = useTranslations("admin.enforcement");
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: Action, data: FormData) {
    const result = await action(data);
    setError(result.ok ? null : result.reason);
  }

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-base font-medium text-foreground">
        {fullName ?? t("unnamed")}
      </h3>
      {reason ? (
        <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
      ) : null}

      <form
        action={(data) =>
          run((suspendAction ?? reinstateAction) as Action, data)
        }
        className="mt-3 space-y-2"
      >
        <input type="hidden" name="profileId" value={profileId} />
        <Label htmlFor={`cr-${profileId}`} className="text-sm">
          {t("reasonLabel")}
        </Label>
        <Input id={`cr-${profileId}`} name="reason" required minLength={1} />
        <Submitting label={suspendAction ? t("suspend") : t("reinstate")} />
      </form>

      {error ? (
        <p className="animate-rise mt-3 text-sm text-destructive-ink">
          {t(`error.${error}` as "error.needsReason")}
        </p>
      ) : null}
    </article>
  );
}

type JobResult = { ok: true } | { ok: false; reason: string };
type JobAction = (data: FormData) => Promise<JobResult>;

export type InFlightRow = {
  id: string;
  reference: string;
  status: string;
  scheduledFor: string | null;
  releasable: boolean;
};

/**
 * The jobs a suspension leaves hanging, and the two ways out of each.
 *
 * WHY THIS IS ON THE SAME SCREEN AS THE SUSPENSION. Raising a step stops NEW
 * work and does nothing to a job already accepted — so without this list a
 * suspension leaves customers waiting at home for somebody who is never coming,
 * and nothing anywhere says so. "They cannot take more work" and "the work they
 * have is handled" are different facts, and only the second is a customer not
 * being let down.
 *
 * `in_progress` HAS NEITHER BUTTON. The status machine allows `accepted` and
 * `en_route` back to `pending` and deliberately not this one: somebody is in
 * the customer's house with the floor up, and walking out of that is a phone
 * call. It is still listed, because the job a screen hides is the one nobody
 * deals with.
 *
 * RELEASING IS SAFE ONLY BECAUSE OF THE SUSPENSION. `provider_can_serve`
 * excludes anybody with a step in force, so the pool this returns the job to is
 * one they cannot reach — otherwise the obvious failure is the same person
 * claiming it straight back.
 */
export function InFlightJobs({
  rows,
  releaseAction,
  cancelAction,
}: {
  rows: InFlightRow[] | null;
  releaseAction: JobAction;
  cancelAction: JobAction;
}) {
  const t = useTranslations("admin.enforcement");
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: JobAction, data: FormData) {
    const result = await action(data);
    setError(result.ok ? null : result.reason);
  }

  if (rows === null) {
    return (
      <p className="mt-3 text-sm text-warning-ink">{t("jobsUnreadable")}</p>
    );
  }
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("noJobs")}</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-foreground">{t("jobsLead")}</p>
      {rows.map((row) => (
        <div
          key={row.id}
          className="rounded-md border border-border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">{row.reference}</span>
            <span className="text-muted-foreground">{row.status}</span>
          </div>

          {row.releasable ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={(data) => run(releaseAction, data)}>
                <input type="hidden" name="bookingId" value={row.id} />
                <Submitting label={t("release")} />
              </form>
              <form
                action={(data) => run(cancelAction, data)}
                className="flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="bookingId" value={row.id} />
                <Input
                  name="reason"
                  required
                  minLength={1}
                  className="h-9 w-56"
                  placeholder={t("cancelReasonPlaceholder")}
                />
                <Submitting label={t("cancelJob")} />
              </form>
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground">{t("inProgressRing")}</p>
          )}
        </div>
      ))}

      {error ? (
        <p className="animate-rise text-sm text-destructive-ink">
          {t(`error.${error}` as "error.needsReason")}
        </p>
      ) : null}
    </div>
  );
}
