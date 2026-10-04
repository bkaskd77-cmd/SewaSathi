"use client";

import { useTranslations } from "next-intl";
import {
  Banknote,
  Info,
  Pencil,
  ReceiptText,
  Smartphone,
  Wallet,
} from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import type { FlowStep } from "@/lib/booking";
import { CannotCome } from "@/components/booking/cannot-come";
import { DigitalBenefits } from "@/components/booking/digital-benefits";
import type { ServingVerdict } from "@/lib/provider";
import { cn } from "@/lib/utils";

export type PaymentMethod = "cash" | "esewa" | "khalti";

const PAYMENTS: Array<{ value: PaymentMethod; icon: typeof Wallet }> = [
  { value: "cash", icon: Banknote },
  { value: "esewa", icon: Smartphone },
  { value: "khalti", icon: Wallet },
];

/**
 * A trip debt the customer is carrying into this booking.
 *
 * WHY IT IS ON THIS SCREEN. It is the only charge on this platform beyond the work
 * itself, and the recovery happens at settlement — so without a line here it would
 * first appear on the final bill, which is a charge added unseen. Every field arrives
 * formatted, because a currency formatter cannot cross the server boundary.
 */
export type CarriedTripDebt = {
  /** The whole balance, formatted. It bounds the total across however many jobs. */
  outstandingLabel: string;
  /** The share of any one bill, as a plain number string off `recoveryCapBps`. */
  sharePercent: string;
  /** True while the customer is disputing it, in which case nothing is taken. */
  disputed: boolean;
};

export type ReviewRow = {
  step: FlowStep;
  label: string;
  value: string;
  hint?: string | null;
};

/**
 * Everything the screen needs to say whether the chosen professional can come.
 *
 * Passed in rather than computed here: the provider step already holds the
 * shortlist, and a second fetch on this screen could disagree with the first
 * — which would mean the customer being told two different things about the
 * same person on two consecutive screens.
 */
export type ServingNotice = {
  verdict: ServingVerdict;
  providerName: string;
  /** True when the urgency makes this a stop rather than a note. */
  blocking: boolean;
  holdMinutes: number;
  freeFromLabel: string | null;
  onChooseAnother: () => void;
};

/**
 * Step e — everything on one screen, then confirm.
 *
 * Two things make this screen the one that matters.
 *
 * The first is that every row links back to the step that produced it. A
 * summary you cannot correct is a summary people do not read, and the address
 * is the field most often wrong.
 *
 * The second is the estimate line. That the band is an estimate and the final
 * figure is agreed on site *before work starts* is the product's core promise
 * — the whole reason somebody would use this over calling a number from a
 * lamp post. So it is a panel with a border, above the confirm button, not
 * fine print underneath it.
 */
export function StepReview({
  rows,
  quoteLabel,
  surveyPriced = false,
  tripDebt = null,
  payment,
  error,
  serving,
  onJump,
  onPayment,
}: {
  rows: ReviewRow[];
  quoteLabel: string;
  /**
   * True on a trade that publishes no price at all.
   *
   * The estimate panel is the product's core promise and it cannot simply be
   * dropped here — a screen that says nothing about money before a confirm
   * button is worse than one that says a range. So the panel stays and the
   * promise changes: not "this is roughly the price", but "we look first, free,
   * and you approve the price before anything is loaded".
   */
  surveyPriced?: boolean;
  /** Null for almost everybody — see `CarriedTripDebt`. */
  tripDebt?: CarriedTripDebt | null;
  payment: PaymentMethod;
  error?: string | null;
  /** Null when the customer let us assign, or when nobody is chosen yet. */
  serving?: ServingNotice | null;
  onJump: (step: FlowStep) => void;
  onPayment: (method: PaymentMethod) => void;
}) {
  const t = useTranslations("booking.flow.review");
  const tErr = useTranslations("booking.flow.errors");

  return (
    <div className="flex flex-col gap-5">
      {/*
        FIRST, ABOVE THE SUMMARY. Whether the person they picked can come is a
        precondition for everything below it — putting it under the payment
        buttons would mean somebody reaches the confirm button having read the
        whole screen and not the one line that changes the answer.
      */}
      {serving ? (
        <CannotCome
          verdict={serving.verdict}
          providerName={serving.providerName}
          blocking={serving.blocking}
          holdMinutes={serving.holdMinutes}
          freeFromLabel={serving.freeFromLabel}
          onChooseAnother={serving.onChooseAnother}
        />
      ) : null}

      <dl
        className="assemble divide-y divide-border rounded-xl border border-border"
        style={{ ["--assemble-step" as string]: "0.05s" }}
      >
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{ ["--i" as string]: i }}
            className="flex items-start gap-3 p-4"
          >
            <div className="min-w-0 flex-1">
              <dt className="text-caption uppercase text-muted-foreground">
                {row.label}
              </dt>
              <dd className="mt-1 text-body-md">{row.value}</dd>
              {row.hint ? (
                <dd className="mt-0.5 text-caption text-muted-foreground">
                  {row.hint}
                </dd>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onJump(row.step)}
              className="shrink-0 rounded p-1 text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t("change", { field: row.label })}</span>
            </button>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-body-sm font-semibold">{t("paymentTitle")}</p>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("paymentHelp")}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {PAYMENTS.map((method) => {
            const active = payment === method.value;
            const Icon = method.icon;
            return (
              <button
                key={method.value}
                type="button"
                onClick={() => onPayment(method.value)}
                aria-pressed={active}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all duration-200 active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-5",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="text-caption font-medium">
                  {t(`payments.${method.value}`)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Beside the buttons, not after the choice: a reason revealed once
            somebody has already picked cannot inform the picking. */}
        <DigitalBenefits className="mt-4 rounded-xl border border-border bg-muted/30 p-3" />
      </div>

      {/*
        The promise. Prominent on purpose — this sentence is the difference
        between this product and a phone number on a lamp post.
      */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
        <p className="flex items-center gap-2 text-body-sm font-semibold text-primary">
          <Info aria-hidden="true" className="size-4 shrink-0" />
          {t(surveyPriced ? "surveyTitle" : "estimateTitle")}
        </p>
        {surveyPriced ? null : (
          <p className="mt-1.5 text-body-md tabular-nums">{quoteLabel}</p>
        )}
        <p className="mt-1.5 text-body-sm text-muted-foreground">
          {t(surveyPriced ? "surveyBody" : "estimateBody")}
        </p>
        <Badge variant="verified" className="mt-3">
          {t(surveyPriced ? "surveyBadge" : "estimateBadge")}
        </Badge>
      </div>

      {/*
        THE CARRIED TRIP CHARGE, BELOW THE ESTIMATE AND ABOVE THE CONFIRM BUTTON.
        Deliberately its own panel rather than a row in the summary: the summary rows
        are things the customer chose and can edit, and this is neither. Warning
        colouring rather than destructive — it is money owed for a visit that happened,
        not a problem with this booking, and a red panel on the confirm screen reads as
        "something is wrong with what you are doing".

        A DISPUTE CHANGES THE SENTENCE, NOT THE VISIBILITY. While one is open nothing
        is taken, and saying so is the point: somebody who has objected wants to see
        that we know rather than to find the line gone and wonder.
      */}
      {tripDebt ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="flex items-center gap-2 text-body-sm font-semibold">
            <ReceiptText aria-hidden="true" className="size-4 shrink-0" />
            {t("tripDebtTitle")}
          </p>
          <p className="mt-1.5 text-body-md tabular-nums">
            {tripDebt.outstandingLabel}
          </p>
          <p className="mt-1.5 text-body-sm text-muted-foreground">
            {tripDebt.disputed
              ? t("tripDebtDisputed")
              : t("tripDebtBody", { percent: tripDebt.sharePercent })}
          </p>
          {tripDebt.disputed ? null : (
            /*
             * TO `/account`, NOT A FORM HERE. A dispute opened mid-flow would mean
             * leaving the booking anyway, and the objection belongs on the screen
             * somebody can find again — the activity opt-out's argument one panel
             * over. The draft is in sessionStorage, so coming back restores it.
             *
             * `Link` from `@/i18n/navigation`, so a Nepali reader lands on
             * `/ne/account`. One stray `next/link` drops them into English and
             * nothing fails.
             */
            <Link
              href="/account"
              className="mt-2 inline-block text-body-sm underline underline-offset-2"
            >
              {t("tripDebtDispute")}
            </Link>
          )}
        </div>
      ) : null}

      <FieldError id="confirm-error" message={error ? tErr(error) : null} />
    </div>
  );
}
