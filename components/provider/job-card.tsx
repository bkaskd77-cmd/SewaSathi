"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, Phone } from "lucide-react";

import { ArrivalPanel } from "@/components/provider/arrival-panel";
import {
  CorrectionPanel,
  type CorrectionProduct,
} from "@/components/provider/correction-panel";
import { VisitReview } from "@/components/provider/visit-review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BOOKING_TRANSITIONS,
  type BookingStatus,
  type CorrectionState,
  type QuoteState,
} from "@/lib/booking";
import {
  REFUSAL_REASON_CODES,
  type RefusalReasonCode,
} from "@/lib/provider";
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
  "invalidMaterials",
  "materialsOverAmount",
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
  /**
   * Twice the quoted max — nothing above it can be approved in-app at all.
   *
   * Null on a survey job nobody has priced yet, and the amount form below is
   * simply absent then: there is no ceiling to enforce and no band to be over,
   * which is exactly why `enforce_survey_quote` will not let such a job reach
   * `in_progress` in the first place.
   */
  ceiling: number | null;
  quotedMax: number | null;
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
   * The part of this earning that waits, pre-formatted, with its release date.
   *
   * BOTH NUMBERS OR NEITHER. A professional shown a smaller figure and no
   * explanation has been quietly short-changed as far as they can tell — this
   * is their own money arriving 30 days later, not a fee, and the card has to
   * say so on the same line as the amount. Null on every job that holds
   * nothing, which is most of them, and no second date is rendered for it.
   */
  holdbackAmountLabel: string | null;
  holdbackDateLabel: string | null;
  /**
   * An open job, offered to everybody who can do it rather than assigned.
   * The only action is to take it, and the customer's details are absent
   * until somebody has.
   */
  open?: boolean;
  /** ISO instant, once an arrival has been recorded for this job. */
  /**
   * The price correction, when this trade has products to correct to.
   *
   * Null on a survey job and on an open one: neither has a published band for
   * this professional to say is wrong. `correctionState` in lib/booking is what
   * decides which of the four shapes it is in.
   */
  correction?: {
    state: CorrectionState;
    products: CorrectionProduct[];
    statedLabel: string | null;
    proposedLabel: string | null;
  } | null;
  arrivedAt?: string | null;
  /** True once a wasted-trip claim exists, so the panel stops offering one. */
  noShowClaimed?: boolean;
  /** Has this professional already answered for the visit? */
  visitReviewed?: boolean;
  /**
   * This professional already has a job in this window.
   *
   * Only ever set on an OPEN job, and it turns the ordinary claim into a
   * deliberate offer. Never a standing setting and never something the customer
   * can ask for: the seat exists because one person decided, on one booking,
   * that they could genuinely fit it in.
   */
  windowFull?: boolean;
  /**
   * They offered on this job and are still holding it.
   *
   * Shows the one-tap out. Handing back a job you offered to squeeze in is not
   * refusing work and is recorded as a refusal nowhere — it is counted, for
   * ranking only, because an offer nobody can rely on is worse for the customer
   * than no offer at all.
   */
  offeredByMe?: boolean;
  /**
   * A survey-priced job, and whether it has been priced yet.
   *
   * THE FORM IS THE JOB on a movers booking. Nothing can start until the
   * professional has been, looked, and sent a range the customer accepts — so
   * this is not an extra field on a normal card, it is the step between
   * arriving and working.
   */
  survey?: {
    /** Where the quote has got to. Only `awaiting-survey` shows the form. */
    state: QuoteState;
    /** How long the price they send will hold, in hours. */
    validHours: number;
  } | null;
};

export function JobCard(props: JobCardProps) {
  const t = useTranslations("provider.jobs");
  const tSurvey = useTranslations("provider.jobs.survey");
  const tOverbook = useTranslations("provider.jobs.overbook");

  const [busy, setBusy] = React.useState(false);
  // The server's own reason, not a boolean. It already distinguishes "the job
  // has not started", "that is more than twice the quote" and "you need to say
  // why" — collapsing all of them into one sentence threw away the only thing
  // that tells the professional what to do next.
  const [error, setError] = React.useState<string | null>(null);
  const [declining, setDeclining] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  /*
   * WHICH OF THE FIVE, OR NONE. Null is the starting state and a legitimate
   * ending one: skipping writes "not recorded" rather than "no reason", and
   * forcing a choice would push everybody onto `other` and make the count
   * meaningless. Rule 6 in the shape it takes for a form rather than a column.
   */
  const [declineCode, setDeclineCode] =
    React.useState<RefusalReasonCode | null>(null);
  const [amount, setAmount] = React.useState("");
  const [amountReason, setAmountReason] = React.useState("");
  // Deliberately a string, and deliberately not defaulted to "0". An empty
  // field must reach the server as null: "nobody said" and "no parts" are
  // different facts and only the second lets a refund ceiling lose the parts.
  const [materials, setMaterials] = React.useState("");
  const [quoteMin, setQuoteMin] = React.useState("");
  const [quoteMax, setQuoteMax] = React.useState("");
  const [appealing, setAppealing] = React.useState(false);
  const [appealReason, setAppealReason] = React.useState("");

  const claim = () =>
    void run(async () => {
      const { claimJobAction } = await import(
        "@/app/[locale]/(work)/provider/jobs/actions"
      );
      return claimJobAction(props.id);
    });

  const next = props.open ? undefined : NEXT[props.status];
  const canDecline =
    !props.open && BOOKING_TRANSITIONS[props.status].includes("cancelled");
  const overBand = props.quotedMax !== null && Number(amount) > props.quotedMax;

  async function run(work: () => Promise<{ ok: boolean; reason?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      /*
       * NO router.refresh() ON SUCCESS, and that is a latency fix rather than
       * a style one.
       *
       * Every one of these actions calls `revalidatePath` for this route, so
       * Next.js re-renders the page on the server as part of the action's own
       * response — the fresh screen arrives with the answer. Calling refresh()
       * afterwards fired a SECOND full round trip to render exactly the same
       * thing, which doubled how long every button on this card appeared to
       * spin. On a connection from Kathmandu that was seconds, for nothing.
       */
      if (!result.ok) setError(result.reason ?? "failed");
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
        "@/app/[locale]/(work)/provider/jobs/actions"
      );
      return advanceJobAction(props.id, next);
    });
  };

  const decline = () =>
    void run(async () => {
      const { declineJobAction } = await import(
        "@/app/[locale]/(work)/provider/jobs/actions"
      );
      const result = await declineJobAction(
        props.id,
        declineReason,
        declineCode,
      );
      if (result.ok) setDeclining(false);
      return result;
    });

  const appeal = () =>
    void run(async () => {
      const { appealCommissionAction } = await import(
        "@/app/[locale]/(work)/provider/jobs/actions"
      );
      const result = await appealCommissionAction(props.id, appealReason);
      if (result.ok) setAppealing(false);
      return result;
    });

  const submitAmount = () =>
    void run(async () => {
      const { recordAmountAction } = await import(
        "@/app/[locale]/(work)/provider/jobs/actions"
      );
      return recordAmountAction(
        props.id,
        Number(amount),
        amountReason,
        materials.trim() === "" ? null : Number(materials),
      );
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

      {/*
        THE PRODUCT, BEFORE THE MONEY. It sits above the arrival and payment
        blocks because it is the thing that has to be settled FIRST: the
        database refuses `in_progress` while a correction is unanswered, so a
        professional who cannot start work needs to find the reason here rather
        than hunting for it under a commission line.
      */}
      {props.correction ? (
        <CorrectionPanel
          bookingId={props.id}
          state={props.correction.state}
          products={props.correction.products}
          statedLabel={props.correction.statedLabel}
          proposedLabel={props.correction.proposedLabel}
        />
      ) : null}

      {/*
        ARRIVED, AND NOBODY IS HERE.
        Only while en route: before that there is nowhere to have arrived at,
        and once the work has started somebody clearly answered the door. It
        sits above the payment block because at this moment the professional is
        standing in a street, not thinking about commission.
      */}
      {props.status === "en_route" ? (
        <ArrivalPanel
          bookingId={props.id}
          customerPhone={props.customerPhone}
          arrivedAt={props.arrivedAt ?? null}
          claimed={Boolean(props.noShowClaimed)}
          recordArrival={async (input) => {
            const { recordArrivalAction } = await import(
              "@/app/[locale]/(work)/provider/jobs/actions"
            );
            return recordArrivalAction(input);
          }}
          claimNoShow={async (input) => {
            const { claimNoShowAction } = await import(
              "@/app/[locale]/(work)/provider/jobs/actions"
            );
            return claimNoShowAction(input);
          }}
        />
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

          {/* THE HELD QUARTER, WHERE THE GUARANTEE RUNS LONG. Said as a
              deferral and never as a deduction, because that is what it is:
              the two parts add up to the whole earning above. Published in the
              same terms on /providers/standards before anybody signs up. */}
          {props.holdbackAmountLabel && props.holdbackDateLabel ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {t("payment.holdback", {
                amount: props.holdbackAmountLabel,
                date: props.holdbackDateLabel,
              })}
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

      {/* The visit answer, once the job is done. Their half of the sealed
          pair — the customer's review does not publish until this is in or the
          fortnight passes. */}
      {props.status === "completed" ? (
        <VisitReview bookingId={props.id} done={props.visitReviewed ?? false} />
      ) : null}

      {/*
          THE SURVEY, BEFORE ANY OF THIS. On a movers job the professional goes,
          looks, and sends a range; nothing else on this card can happen until
          the customer has accepted it, and `enforce_survey_quote` in Postgres
          is what makes that true rather than this screen.
       */}
      {props.survey && props.survey.state === "awaiting-survey" ? (
        <div className="animate-pop-in mt-4 space-y-2 border-t border-border pt-4">
          <Label htmlFor={`quote-min-${props.id}`}>{tSurvey("label")}</Label>
          <p className="text-caption text-muted-foreground">{tSurvey("help")}</p>
          <div className="flex items-end gap-2">
            <span className="min-w-0 flex-1">
              <Label
                htmlFor={`quote-min-${props.id}`}
                className="text-caption text-muted-foreground"
              >
                {tSurvey("min")}
              </Label>
              <Input
                id={`quote-min-${props.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                value={quoteMin}
                onChange={(event) => setQuoteMin(event.target.value)}
              />
            </span>
            <span className="min-w-0 flex-1">
              <Label
                htmlFor={`quote-max-${props.id}`}
                className="text-caption text-muted-foreground"
              >
                {tSurvey("max")}
              </Label>
              <Input
                id={`quote-max-${props.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                value={quoteMax}
                onChange={(event) => setQuoteMax(event.target.value)}
              />
            </span>
          </div>
          <p className="text-caption text-muted-foreground">
            {tSurvey("holds", { hours: String(props.survey.validHours) })}
          </p>
          <Button
            className="btn-tactile w-full"
            disabled={busy || !quoteMin || !quoteMax}
            onClick={() =>
              void run(async () => {
                const { recordSurveyQuoteAction } = await import(
                  "@/app/[locale]/(work)/provider/jobs/actions"
                );
                return recordSurveyQuoteAction(
                  props.id,
                  Number(quoteMin),
                  Number(quoteMax),
                );
              })
            }
          >
            {busy ? tSurvey("sending") : tSurvey("submit")}
          </Button>
        </div>
      ) : null}

      {/* Priced, and waiting on the customer. No action here — the next move is
          theirs, and a button that did nothing would imply otherwise. */}
      {props.survey && props.survey.state === "awaiting-approval" ? (
        <p className="animate-pop-in mt-4 border-t border-border pt-4 text-body-sm text-muted-foreground">
          {tSurvey("sent")}
        </p>
      ) : null}

      {/* The amount, once the work is done. */}
      {props.status === "completed" &&
      props.finalLabel === null &&
      props.quotedMax !== null &&
      props.ceiling !== null ? (
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
          {/*
              THE PARTS, SEPARATELY FROM THE LABOUR.

              Optional and never pre-filled. A number typed into a box that
              already had one in it is a number nobody chose, and this figure
              reduces what this professional can be asked to pay back on a
              guarantee claim — so it has to be something they actually stated.

              Blank is not zero. The field sends null when it is empty, which
              is what keeps "nobody said" tellable apart from "no parts" all
              the way down to the column.
           */}
          <div className="space-y-1 pt-1">
            <Label htmlFor={`materials-${props.id}`}>
              {t("materials.label")}
            </Label>
            <Input
              id={`materials-${props.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={amount ? Number(amount) : undefined}
              value={materials}
              onChange={(event) => setMaterials(event.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              {t("materials.help")}
            </p>
          </div>

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
          {props.windowFull ? (
            /*
                NO WARNING COLOUR. Nothing has gone wrong and nobody has been
                careless — they are simply already working then. The sentence
                below says what the offer costs them, which is the honest way
                to ask somebody to take on more than they planned.
             */
            <>
              <p className="text-body-sm font-semibold">
                {tOverbook("full")}
              </p>
              <p className="mt-1 text-caption text-muted-foreground">
                {tOverbook("note")}
              </p>
              <Button
                variant="outline"
                className="btn-tactile mt-3"
                onClick={() =>
                  void run(async () => {
                    const { offerOverbookAction } = await import(
                      "@/app/[locale]/(work)/provider/jobs/actions"
                    );
                    return offerOverbookAction(props.id);
                  })
                }
                disabled={busy}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {busy ? tOverbook("offering") : tOverbook("offer")}
              </Button>
            </>
          ) : (
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
          )}
        </div>
      ) : null}

      {/* The one-tap out, on a job they offered to squeeze in. Separate from
          the ordinary decline below because it is a different thing: that one
          is refusing work and is counted as such; this one is running out of
          day on work they volunteered for. */}
      {props.offeredByMe &&
      (props.status === "accepted" || props.status === "en_route") ? (
        <div className="mt-4 border-t border-border pt-4">
          <Button
            variant="ghost"
            className="btn-tactile"
            onClick={() =>
              void run(async () => {
                const { overbookMissAction } = await import(
                  "@/app/[locale]/(work)/provider/jobs/actions"
                );
                return overbookMissAction(props.id);
              })
            }
            disabled={busy}
          >
            {busy ? tOverbook("missing") : tOverbook("miss")}
          </Button>
          <p className="mt-1 text-caption text-muted-foreground">
            {tOverbook("missNote")}
          </p>
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
          {/*
            * ONE TAP TO SAY WHY, AND THE CONFIRM STAYS. "One tap" is the
            * reason, not the decline: the warning above says only support can
            * undo this and the customer cannot be handed back, and a rule that
            * strict must not fire from one stray tap beside four other buttons.
            *
            * THE CODES ARE A STATED PREFERENCE, NEVER SCORED. "Too far" is
            * somebody telling us where they will not travel — checkable, theirs
            * to change, and nothing reads it into ranking.
            * `withdrawalRankingPenalty` counts refusals without caring why, and
            * /providers/standards publishes turning work down under *what is
            * never a signal*.
            */}
          <p className="text-caption text-muted-foreground">
            {t("decline.whyLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {REFUSAL_REASON_CODES.map((code) => {
              const chosen = declineCode === code;
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={chosen}
                  disabled={busy}
                  // Tapping the chosen one clears it — a selection nobody can
                  // undo is a selection somebody will make by accident and then
                  // have to send.
                  onClick={() => setDeclineCode(chosen ? null : code)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-caption transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:opacity-60",
                    chosen
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                >
                  {t(`decline.why.${code}`)}
                </button>
              );
            })}
          </div>

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
