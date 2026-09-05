"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { BOOKING_TRANSITIONS, type BookingStatus } from "@/lib/booking";
import { cn } from "@/lib/utils";

/**
 * One job, from the professional's side.
 *
 * The next action is derived from the status machine rather than written out
 * per status, so a change to `BOOKING_TRANSITIONS` moves this screen with it.
 * That matters more here than anywhere else in the product: this is the screen
 * that decides what the database is asked to do, and a hand-maintained list
 * would be a second, quietly diverging copy of the machine.
 *
 * The amount form appears only at `completed`, because billing for work that
 * has not happened is refused server-side anyway and offering it earlier would
 * be an invitation to try.
 */

/**
 * Reasons the professional gets a real sentence for.
 *
 * An allow-list rather than an interpolated key: next-intl renders a missing
 * key as its own dotted path, so a reason without copy would put
 * `errors.saveFailed` on screen. Everything absent here is ours, not theirs,
 * and collapses to "try again" — which is the only useful thing to say about a
 * fault they cannot act on.
 */
const KNOWN_JOB_ERRORS = [
  "aboveCeiling",
  "illegalTransition",
  "invalidAmount",
  "network",
  "notAProvider",
  "notStarted",
  "notYours",
  "reasonRequired",
  "tooLate",
  "alreadyAppealed",
  "alreadyWaived",
  "floorNotApplied",
  // Somebody else got there first. A normal outcome in an open list, and the
  // one message that must not read like a fault.
  "alreadyTaken",
] as const;

function jobErrorKey(reason: string): string {
  return (KNOWN_JOB_ERRORS as readonly string[]).includes(reason)
    ? `errors.${reason}`
    : "failed";
}

/** The one forward move offered at each status. Cancelling is separate. */
const NEXT: Partial<Record<BookingStatus, BookingStatus>> = {
  pending: "accepted",
  accepted: "en_route",
  en_route: "in_progress",
  in_progress: "completed",
};

export type JobCardProps = {
  id: string;
  reference: string;
  status: BookingStatus;
  categoryName: string;
  description: string;
  whenLabel: string;
  quoteLabel: string;
  finalLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  addressLine: string | null;
  landmark: string | null;
  /** Twice the quoted max — nothing above it can be approved in-app at all. */
  ceiling: number;
  quotedMax: number;
  /** "paid" once the money has actually settled. */
  paymentStatus: string;
  paymentMethodLabel: string;
  /** Pre-formatted: what this professional keeps after commission. */
  earningLabel: string | null;
  /**
   * Set when the commission floor lifted the fee basis above what was
   * collected — the fee is charged on the published minimum, so reporting less
   * than the band earns nothing. Said out loud here, with the appeal beside
   * it: a blunt rule the person it lands on cannot see is how a platform loses
   * the honest half of its supply.
   */
  floorLabel: string | null;
  /** open | upheld | rejected. Null when they have not appealed this job. */
  appealStatus: string | null;
  /** Pre-formatted date this settlement becomes payable. */
  payoutLabel: string | null;
  /**
   * An open job, offered to everybody who can do it rather than assigned.
   * The only action is to take it, and the customer's details are absent
   * until somebody has.
   */
  open?: boolean;
};

export function JobCard(props: JobCardProps) {
  const t = useTranslations("provider.jobs");
  const router = useRouter();

  const [busy, setBusy] = React.useState(false);
  // The server's own reason, not a boolean. It already distinguishes "the job
  // has not started", "that is more than twice the quote" and "you need to say
  // why" — collapsing all of them into one sentence threw away the only thing
  // that tells the professional what to do next.
  const [error, setError] = React.useState<string | null>(null);
  const [declining, setDeclining] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [amountReason, setAmountReason] = React.useState("");
  const [appealing, setAppealing] = React.useState(false);
  const [appealReason, setAppealReason] = React.useState("");

  const claim = () =>
    void run(async () => {
      const { claimJobAction } = await import(
        "@/app/[locale]/(app)/provider/jobs/actions"
      );
      return claimJobAction(props.id);
    });

  const next = props.open ? undefined : NEXT[props.status];
  const canDecline =
    !props.open && BOOKING_TRANSITIONS[props.status].includes("cancelled");
  const overBand = Number(amount) > props.quotedMax;

  async function run(work: () => Promise<{ ok: boolean; reason?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result.ok) router.refresh();
      else setError(result.reason ?? "failed");
    } catch {
      // A thrown server action is ours, not theirs — a missing key, a dead
      // database. Named separately so it does not read as "you did something
      // wrong".
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  const advance = () => {
    if (!next) return;
    void run(async () => {
      const { advanceJobAction } = await import(
        "@/app/[locale]/(app)/provider/jobs/actions"
      );
      return advanceJobAction(props.id, next);
    });
  };

  const decline = () =>
    void run(async () => {
      const { declineJobAction } = await import(
        "@/app/[locale]/(app)/provider/jobs/actions"
      );
      const result = await declineJobAction(props.id, declineReason);
      if (result.ok) setDeclining(false);
      return result;
    });

  const appeal = () =>
    void run(async () => {
      const { appealCommissionAction } = await import(
        "@/app/[locale]/(app)/provider/jobs/actions"
      );
      const result = await appealCommissionAction(props.id, appealReason);
      if (result.ok) setAppealing(false);
      return result;
    });

  const submitAmount = () =>
    void run(async () => {
      const { recordAmountAction } = await import(
        "@/app/[locale]/(app)/provider/jobs/actions"
      );
      return recordAmountAction(props.id, Number(amount), amountReason);
    });

  return (
    <article className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body-md font-semibold">{props.categoryName}</h2>
        <span className="text-caption tabular-nums text-muted-foreground">
          {props.reference}
        </span>
      </div>

      <p className="mt-1 text-caption font-semibold uppercase tracking-wide text-primary">
        {props.open ? t("openNow") : t(`status.${props.status}`)}
      </p>

      <p className="mt-3 text-body-sm">{props.description}</p>

      <dl className="mt-3 space-y-1 text-caption text-muted-foreground">
        <div className="flex gap-2">
          <dt className="shrink-0">{t("when")}</dt>
          <dd>{props.whenLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0">{t("quote")}</dt>
          <dd className="tabular-nums">
            {props.finalLabel ?? props.quoteLabel}
          </dd>
        </div>
        {props.addressLine ? (
          <div className="flex gap-2">
            <dt className="sr-only">{t("address")}</dt>
            <dd className="flex items-start gap-1.5">
              <MapPin aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>
                {props.addressLine}
                {props.landmark ? ` · ${props.landmark}` : ""}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>

      {/* The customer's number, once there is a job to call about. Same
          reasoning as the customer's own call button: this is what somebody
          standing at the wrong gate actually needs. Not while pending —
          nobody has agreed to anything yet. */}
      {props.customerPhone && props.status !== "pending" ? (
        <a
          href={`tel:${props.customerPhone}`}
          className="mt-3 inline-flex items-center gap-1.5 text-body-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          <Phone aria-hidden="true" className="size-3.5" />
          {props.customerName ?? t("callCustomer")}
        </a>
      ) : null}

      {/* Did I get paid, and what do I keep?
          The card used to stop at "Done", which leaves the one question a
          professional actually has after finishing unanswered — and for cash
          they are standing there holding the money wondering whether to mark
          anything at all. The earning is the frozen split, not a recomputation:
          a later change to the commission rate must never rewrite what somebody
          was already told they had earned. */}
      {props.finalLabel !== null ? (
        <div
          className={cn(
            "mt-3 rounded-lg border p-3 text-body-sm",
            props.paymentStatus === "paid"
              ? "border-success/40 bg-success/[0.06]"
              : "border-border bg-muted/30",
          )}
        >
          <p
            className={cn(
              "font-semibold",
              props.paymentStatus === "paid"
                ? "text-success-ink"
                : "text-muted-foreground",
            )}
          >
            {props.paymentStatus === "paid"
              ? t("payment.paid")
              : t("payment.awaiting", { method: props.paymentMethodLabel })}
          </p>
          {props.earningLabel ? (
            <p className="animate-digit-in mt-1 tabular-nums">
              {t("payment.youKeep", { amount: props.earningLabel })}
            </p>
          ) : null}

          {/* When the payout lands, and why digital is sooner. The delay on
              cash is a real operational fact — it is reconciled from a
              confirmation somebody typed, not from a gateway — which is what
              makes it fair to say out loud rather than a punishment. */}
          {props.payoutLabel ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {t("payment.payout", { date: props.payoutLabel })}
            </p>
          ) : null}

          {props.floorLabel ? (
            <div className="mt-2 border-t border-border/60 pt-2">
              <p className="text-caption text-muted-foreground">
                {t("payment.floor", { basis: props.floorLabel })}
              </p>
              {props.appealStatus ? (
                <p className="mt-1 text-caption font-semibold text-primary">
                  {t(`appeal.status.${props.appealStatus}`)}
                </p>
              ) : appealing ? (
                <div className="animate-pop-in mt-2 space-y-2">
                  <Label htmlFor={`appeal-${props.id}`}>
                    {t("appeal.label")}
                  </Label>
                  <Input
                    id={`appeal-${props.id}`}
                    value={appealReason}
                    onChange={(event) => setAppealReason(event.target.value)}
                    placeholder={t("appeal.placeholder")}
                    maxLength={600}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={appeal} disabled={busy}>
                      {busy ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : null}
                      {t("appeal.submit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAppealing(false)}
                      disabled={busy}
                    >
                      {t("appeal.back")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 -ml-3"
                  onClick={() => setAppealing(true)}
                >
                  {t("appeal.trigger")}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The amount, once the work is done. */}
      {props.status === "completed" && props.finalLabel === null ? (
        <div className="animate-pop-in mt-4 space-y-2 border-t border-border pt-4">
          <Label htmlFor={`amount-${props.id}`}>{t("amount.label")}</Label>
          <Input
            id={`amount-${props.id}`}
            type="number"
            inputMode="numeric"
            min={100}
            max={props.ceiling}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={String(props.quotedMax)}
          />
          {overBand ? (
            <div className="animate-pop-in space-y-2">
              <p className="text-caption text-warning-ink">
                {t("amount.overBand")}
              </p>
              <Label htmlFor={`why-${props.id}`}>
                {t("amount.reasonLabel")}
              </Label>
              <Input
                id={`why-${props.id}`}
                value={amountReason}
                onChange={(event) => setAmountReason(event.target.value)}
                placeholder={t("amount.reasonPlaceholder")}
                maxLength={300}
              />
            </div>
          ) : null}
          <Button
            className="btn-tactile mt-1 w-full"
            onClick={submitAmount}
            disabled={busy || !amount}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {t("amount.submit")}
          </Button>
        </div>
      ) : null}

      {props.open ? (
        <div className="mt-4 border-t border-border pt-4">
          <Button
            className="btn-tactile btn-beacon"
            onClick={claim}
            disabled={busy}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {t("claim")}
          </Button>
        </div>
      ) : null}

      {next || canDecline ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {next ? (
            <Button
              className={cn(
                "btn-tactile",
                props.status === "pending" && "btn-beacon",
              )}
              onClick={advance}
              disabled={busy}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {t(`advance.${next}`)}
            </Button>
          ) : null}
          {canDecline && !declining ? (
            <Button
              variant="ghost"
              onClick={() => setDeclining(true)}
              disabled={busy}
            >
              {t("decline.trigger")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {declining ? (
        <div className="animate-pop-in mt-3 space-y-2">
          {/* SAID BEFORE THE TAP, NOT AFTER IT.
              Turning a job down is one-way: the refusal is recorded against
              the listing, the open-job policy stops showing it, and no caller
              can assign it back. That is deliberate — a customer who has been
              let go of once should not be handed back to the same person who
              changed their mind — but a rule that strict has to be legible at
              the moment it is chosen. Only support can undo it. */}
          <p className="rounded-lg border border-warning/40 bg-warning/[0.08] p-2.5 text-caption text-warning-ink">
            {t("decline.warning")}
          </p>
          <Label htmlFor={`decline-${props.id}`}>{t("decline.label")}</Label>
          <Input
            id={`decline-${props.id}`}
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
            placeholder={t("decline.placeholder")}
            maxLength={300}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={decline}
              disabled={busy}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {t("decline.confirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeclining(false)}
              disabled={busy}
            >
              {t("decline.back")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="animate-pop-in mt-3 text-caption text-destructive-ink"
        >
          {t(jobErrorKey(error))}
        </p>
      ) : null}
    </article>
  );
}
