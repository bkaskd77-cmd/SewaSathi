"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Loader2,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { paymentErrorKey, type PaymentMethod } from "@/lib/payments/client";
import { cn } from "@/lib/utils";

/**
 * Everything the customer does about money, in one panel.
 *
 * The stage is decided on the server — this component never works out from
 * amounts and statuses what the customer is allowed to do, it is told. That
 * keeps the one screen where a mistake costs somebody money reading from the
 * same judgement the server enforces, rather than a second implementation of
 * it that can drift.
 *
 * All the money strings arrive pre-formatted, because `formatNpr` needs the
 * locale and a function cannot cross the server/client boundary.
 */

export type PaymentStage =
  | "notYet"
  | "awaitingAmount"
  | "needsApproval"
  | "ready"
  | "processing"
  | "cashPending"
  | "paid";

export type PaymentPanelProps = {
  bookingId: string;
  stage: PaymentStage;
  /** "Rs 1,200–1,800", already formatted for the reader's language. */
  quoteLabel: string;
  finalLabel: string | null;
  /** The raw figure, sent back with an approval so it cannot drift underneath. */
  finalAmount: number | null;
  overByLabel: string | null;
  reason: string | null;
  /** Methods with credentials configured. Cash is always among them. */
  methods: PaymentMethod[];
  defaultMethod: PaymentMethod;
  /** The live attempt's reference, when there is one. */
  reference: string | null;
  /** When the gateway attempt started, so the wait can be given a floor. */
  inFlightSince: string | null;
  receipt: {
    reference: string;
    method: PaymentMethod;
    amountLabel: string;
    settledAt: string;
    providerTxnId: string | null;
  } | null;
  /** Why the last attempt failed, for the retry copy. */
  failureReason: string | null;
  supportPhone: string;
};

const METHOD_ICON: Record<PaymentMethod, typeof Wallet> = {
  cash: Banknote,
  esewa: Wallet,
  khalti: Wallet,
};

export function PaymentPanel(props: PaymentPanelProps) {
  const t = useTranslations("booking.payment");
  const router = useRouter();

  const [method, setMethod] = React.useState<PaymentMethod>(props.defaultMethod);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [disputing, setDisputing] = React.useState(false);
  const [note, setNote] = React.useState("");

  /**
   * eSewa takes a signed form POST rather than a redirect, so the handoff can
   * be a URL or a set of fields. Building and submitting a real form is the
   * only way to express the second — the signature covers the field values, so
   * they cannot be moved onto a query string.
   */
  function handOff(url: string, fields: Record<string, string>) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { startPaymentAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await startPaymentAction(props.bookingId, method);
      if (!result.ok) {
        setError(result.reason);
        setBusy(false);
        return;
      }
      if (result.kind === "cash") {
        router.refresh();
        setBusy(false);
        return;
      }
      // Leaving the page — `busy` stays true so the button cannot be tapped
      // again while the browser is navigating away.
      if (result.kind === "form") handOff(result.url, result.fields);
      else window.location.href = result.url;
    } catch {
      setError("network");
      setBusy(false);
    }
  }

  async function approve() {
    if (busy || props.finalAmount === null) return;
    setBusy(true);
    setError(null);
    try {
      const { approveAmountAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await approveAmountAction(props.bookingId, props.finalAmount);
      if (result.ok) router.refresh();
      else setError(result.reason ?? "failed");
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  async function dispute() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { disputeAmountAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await disputeAmountAction(props.bookingId, note);
      if (result.ok) {
        setDisputing(false);
        router.refresh();
      } else setError("failed");
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  /** Ask the gateway again, rather than just re-reading what we believed. */
  async function recheck() {
    if (busy || !props.reference) return;
    setBusy(true);
    setError(null);
    try {
      const { recheckPaymentAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      await recheckPaymentAction(props.bookingId, props.reference);
      // Refreshed either way: "still pending" is a real answer and the panel
      // re-renders from the row, not from this call's return.
      router.refresh();
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCash() {
    if (busy || !props.reference) return;
    setBusy(true);
    setError(null);
    try {
      const { confirmCashAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await confirmCashAction(props.bookingId, props.reference);
      if (result.ok) router.refresh();
      else setError(result.reason ?? "failed");
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  const problem = error ? (
    <p role="alert" className="animate-pop-in mt-3 text-caption text-destructive-ink">
      {t(paymentErrorKey(error))}
    </p>
  ) : null;

  if (props.stage === "notYet") {
    return (
      <Section tone="quiet" title={t("notYet.title")}>
        <p className="text-body-md text-muted-foreground">
          {t("notYet.body", { quote: props.quoteLabel })}
        </p>
      </Section>
    );
  }

  if (props.stage === "awaitingAmount") {
    return (
      <Section tone="quiet" title={t("awaitingAmount.title")}>
        <p className="text-body-md text-muted-foreground">
          {t("awaitingAmount.body")}
        </p>
        <div
          aria-hidden="true"
          className="animate-skeleton mt-3 h-7 w-40 rounded-md bg-muted"
        />
      </Section>
    );
  }

  if (props.stage === "paid" && props.receipt) {
    const Icon = METHOD_ICON[props.receipt.method];
    return (
      <Section tone="settled" title={t("paid.title")}>
        <div className="flex items-start gap-3">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-success-ink"
          />
          <div className="min-w-0 flex-1">
            <p className="animate-digit-in font-display text-display-sm tabular-nums">
              {props.receipt.amountLabel}
            </p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              {t("paid.body")}
            </p>

            <dl className="mt-4 space-y-1.5 text-caption">
              <ReceiptRow label={t("receipt.method")}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon aria-hidden="true" className="size-3.5" />
                  {t(`methods.${props.receipt.method}`)}
                </span>
              </ReceiptRow>
              <ReceiptRow label={t("receipt.reference")}>
                <span className="tabular-nums">{props.receipt.reference}</span>
              </ReceiptRow>
              {props.receipt.providerTxnId ? (
                <ReceiptRow label={t("receipt.providerTxn")}>
                  <span className="break-all tabular-nums">
                    {props.receipt.providerTxnId}
                  </span>
                </ReceiptRow>
              ) : null}
              <ReceiptRow label={t("receipt.settledAt")}>
                {props.receipt.settledAt}
              </ReceiptRow>
            </dl>
          </div>
        </div>
      </Section>
    );
  }

  if (props.stage === "processing") {
    /*
     * A wait with no floor is a dead end.
     *
     * "A few seconds" is true of a gateway that answers. One that does not
     * leaves somebody watching a spinner with their money already gone and no
     * idea whether to pay again — and the honest thing to say at that point is
     * that we can see it too and here is a number. Two minutes because that is
     * already far beyond any normal eSewa or Khalti round trip; below it the
     * reassurance is accurate and adding an alarm would be the false one.
     */
    const stale = props.inFlightSince
      ? Date.now() - new Date(props.inFlightSince).getTime() > 120_000
      : false;

    return (
      <Section tone="quiet" title={t("processing.title")}>
        <div className="flex items-start gap-3">
          <Loader2
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
          />
          <div>
            <p className="text-body-md text-muted-foreground">
              {stale ? t("processing.stalled") : t("processing.body")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void recheck()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {t("processing.recheck")}
            </Button>
            {stale ? (
              <a
                href={`tel:${props.supportPhone}`}
                className="mt-3 inline-flex items-center gap-1.5 text-body-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t("processing.callUs")}
              </a>
            ) : null}
            {problem}
          </div>
        </div>
      </Section>
    );
  }

  if (props.stage === "needsApproval") {
    return (
      <Section tone="warning" title={t("needsApproval.title")}>
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-warning-ink"
          />
          <div className="min-w-0 flex-1">
            <p className="text-body-md">
              {t("needsApproval.body", {
                quote: props.quoteLabel,
                final: props.finalLabel ?? "",
                over: props.overByLabel ?? "",
              })}
            </p>
            {props.reason ? (
              <blockquote className="mt-3 border-l-2 border-warning pl-3 text-body-sm italic text-muted-foreground">
                {props.reason}
              </blockquote>
            ) : null}

            {disputing ? (
              <div className="animate-pop-in mt-4 space-y-2">
                <Label htmlFor="dispute-note">{t("dispute.label")}</Label>
                <Input
                  id="dispute-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("dispute.placeholder")}
                  maxLength={250}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void dispute()}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : null}
                    {t("dispute.submit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDisputing(false)}
                    disabled={busy}
                  >
                    {t("dispute.back")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  className="btn-tactile"
                  onClick={() => void approve()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {t("needsApproval.approve", { final: props.finalLabel ?? "" })}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDisputing(true)}
                  disabled={busy}
                >
                  {t("needsApproval.dispute")}
                </Button>
              </div>
            )}
            {problem}
          </div>
        </div>
      </Section>
    );
  }

  if (props.stage === "cashPending") {
    return (
      <Section tone="quiet" title={t("cashPending.title")}>
        <p className="text-body-md">
          {t("cashPending.body", { final: props.finalLabel ?? "" })}
        </p>
        <Button
          className="btn-tactile mt-4"
          onClick={() => void confirmCash()}
          disabled={busy}
        >
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {t("cashPending.confirm")}
        </Button>
        {problem}
      </Section>
    );
  }

  // `ready` — the amount is agreed and nothing is in flight.
  return (
    <Section tone="ready" title={t("ready.title")}>
      <p className="animate-digit-in font-display text-display-sm tabular-nums">
        {props.finalLabel}
      </p>
      {props.failureReason ? (
        <p className="animate-pop-in mt-2 text-caption text-destructive-ink">
          {t("ready.retry")}
        </p>
      ) : null}

      <fieldset className="mt-4">
        <legend className="text-caption uppercase text-muted-foreground">
          {t("ready.chooseMethod")}
        </legend>
        <div className="assemble mt-2 grid gap-2 sm:grid-cols-3">
          {props.methods.map((option, i) => {
            const Icon = METHOD_ICON[option];
            const active = option === method;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setMethod(option)}
                aria-pressed={active}
                style={{ ["--i" as string]: i }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-left text-body-sm transition-all duration-200",
                  "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/[0.06] font-semibold text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {t(`methods.${option}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button
        className="btn-tactile btn-beacon mt-4 w-full sm:w-auto"
        size="lg"
        onClick={() => void pay()}
        disabled={busy}
      >
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {method === "cash"
          ? t("ready.payCash")
          : t("ready.pay", { method: t(`methods.${method}`) })}
      </Button>
      <p className="mt-2 text-caption text-muted-foreground">
        {method === "cash" ? t("ready.cashNote") : t("ready.gatewayNote")}
      </p>
      {problem}
    </Section>
  );
}

/**
 * The one card shape, four tones. `settled` is the only one that animates on
 * arrival — see `.animate-settle` in globals.css.
 */
function Section({
  tone,
  title,
  children,
}: {
  tone: "quiet" | "ready" | "warning" | "settled";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "relative mt-6 rounded-xl border p-4",
        tone === "quiet" && "animate-pop-in border-border bg-muted/30",
        tone === "ready" && "animate-pop-in border-primary/30 bg-primary/[0.04]",
        tone === "warning" && "animate-pop-in border-warning/40 bg-warning/[0.07]",
        tone === "settled" && "animate-settle border-success/40 bg-success/[0.06]",
      )}
      aria-live="polite"
    >
      <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ReceiptRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
