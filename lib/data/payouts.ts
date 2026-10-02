import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { isPayoutRunDay, payoutPeriod } from "@/lib/config/payout-policy";
import { currentDestination, isFresh } from "@/lib/data/payout-destinations";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import {
  heldReasonFor,
  needsReversal,
  UNRESOLVED_PAYOUT_STATUSES,
  payableTranches,
  type PayableTranche,
  type PayoutStatus,
  type SettledBooking,
} from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The payout run, and the three things a person does to one afterwards.
 *
 * WHAT WAS OPEN. `settleSplit` freezes a split onto a booking, `payoutDueAt`
 * dates it, `payoutPlan` splits it into tranches, `applyRedoRecovery` nets a debt
 * forward and `provider_ledger` records all of it append-only. Nothing grouped
 * those earnings into a payment, nothing sent money, and nothing recorded that it
 * had. Every link was built and the chain was never closed — which is
 * `applyRedoRecovery` having no caller for four phases, at the scale of a product.
 *
 * THE RUN ONLY EVER CREATES DRAFTS, and that is structural rather than a habit:
 * `payout_transition_allowed` refuses `draft -> sent` however it is called, so no
 * cron can reach a rail. A person approves, a person sends, a person records what
 * came back.
 *
 * A PAYOUT IS A PERIOD, NOT A BOOKING. One professional, one week, one net
 * figure: the two-way sum of what we owe them on digital jobs and what they owe us
 * in commission on cash ones. Paying per booking would mean a transfer fee per job
 * and a statement nobody can reconcile against a week's work.
 *
 * THIS FILE HOLDS THE SERVICE-ROLE KEY ON A MONEY PATH, like
 * `lib/data/payments.ts`. Treat an edit here the way you would treat shared code:
 * no id is believed, every subject is re-read, and the ledger is the truth while
 * `payouts` is only the instruction.
 */

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/** What one run did. Counted, because a cron that says nothing proves nothing. */
export type PayoutRun = {
  /**
   * The period drafted, or null when today is not the run day.
   *
   * NULL IS "NOT THE DAY", NEVER "NOTHING TO DO" — rule 6 on a cron summary. The
   * reconcile sweep calls this every night and only Tuesday produces anything, so
   * a reader of `cron_runs` must be able to tell a quiet Tuesday from a Wednesday.
   */
  ranFor: { start: string; end: string } | null;
  /** Professionals examined. */
  considered: number;
  /** Drafts created. A second run in the same week creates none. */
  drafted: number;
  /** Drafts carrying a `held_reason` — created, and nothing will be sent. */
  held: number;
  /**
   * Professionals skipped because their destination could not be READ.
   *
   * Not folded into `held`: "nobody has told us where to pay them" and "our query
   * failed" are opposite facts, and writing the second as `no_destination` would
   * put a measurement into a column that had none.
   */
  unreadable: number;
  /**
   * Professionals whose draft was refused because an earlier payout is still open.
   *
   * COUNTED RATHER THAN SILENT. `payouts_one_in_flight_idx` refuses a second
   * unresolved payout, which is what stops two drafts describing the same money —
   * but a refused insert and a professional with nothing owed both produce no
   * draft, and those are opposite facts. A reader of `cron_runs` has to be able to
   * tell "the queue is clear" from "somebody's week has been stuck since the 14th".
   */
  blocked: number;
  /**
   * Professionals whose week went the other way, so no payout was drafted at all.
   *
   * A NEGATIVE WEEK IS NOT AN INSTRUCTION TO PAY, so it gets no row. The first
   * version drafted one carrying `held_reason = 'negative'`, which read tidily and
   * cost something real: `payouts_one_in_flight_idx` then blocked every later week
   * until a person failed it by hand, and a professional whose work is all cash
   * would need that doing every Tuesday for a row nobody could act on. The ledger
   * already carries the balance forward by construction — that is what a ledger is —
   * so the row added no fact and took a decision away from nobody.
   */
  carried: number;
  /** `earning` and `commission_due` rows written. */
  ledgerRows: number;
  /** Rupees across the drafts that are payable — held ones excluded. */
  rupees: number;
};

const NOT_TODAY: PayoutRun = {
  ranFor: null,
  considered: 0,
  drafted: 0,
  held: 0,
  unreadable: 0,
  blocked: 0,
  carried: 0,
  ledgerRows: 0,
  rupees: 0,
};

/**
 * Bounded per run, like `sweepRedoRecovery`. The run is weekly and idempotent, so
 * a low ceiling costs only that a large backlog takes two Tuesdays — and a backlog
 * that size means something else has already gone wrong.
 */
const RUN_LIMIT = 300;

type BookingRow = SettledBooking & {
  payment_method: string;
  platform_fee: number | null;
};

/** One ledger row the run intends to write. */
type LedgerWrite = {
  provider_id: string;
  booking_id: string;
  tranche: "main" | "holdback";
  kind: "earning" | "commission_due";
  amount_rupees: number;
  note: string;
};

/**
 * What this tranche puts into the professional's account.
 *
 * DIGITAL AND CASH ARE NOT MIRROR IMAGES. On a digital job we hold the customer's
 * money and owe them their share, so each tranche is an `earning` — the amount
 * actually landing on that date, which is what makes the published quarter a
 * quarter of what lands. On a cash job they already hold the notes and owe us the
 * fee, so there is one `commission_due` and no earning at all; the holdback
 * columns may be set on such a booking by `payoutPlan`, and they are ignored here
 * because there is nothing of OURS to hold back.
 */
function ledgerWriteFor(
  tranche: PayableTranche,
  booking: BookingRow,
): LedgerWrite | null {
  const digital = booking.payment_method !== "cash";

  if (digital) {
    return {
      provider_id: tranche.providerId,
      booking_id: tranche.bookingId,
      tranche: tranche.tranche,
      kind: "earning",
      amount_rupees: tranche.earning,
      note:
        tranche.tranche === "holdback"
          ? `The held part of ${tranche.reference ?? "a job"}, now due`
          : `Your share of ${tranche.reference ?? "a job"}`,
    };
  }

  // Cash: the fee is owed in full once, on the main tranche.
  if (tranche.tranche !== "main") return null;

  const fee = Number(booking.platform_fee ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) return null;

  return {
    provider_id: tranche.providerId,
    booking_id: tranche.bookingId,
    tranche: "main",
    kind: "commission_due",
    amount_rupees: fee,
    note: `Our fee on ${tranche.reference ?? "a job"}, which you took in cash`,
  };
}

/**
 * Draft this week's payouts.
 *
 * SAFE TO CALL ON ANY DAY, TWICE, OR LATE — the same property `applyDispatch` has
 * and for the same reason: the reconcile cron is daily because daily is the most
 * frequent schedule every Vercel plan accepts, so the weekly-ness has to live in
 * code where it can be tested.
 */
export async function runPayouts(
  options: { now?: Date; limit?: number } = {},
): Promise<PayoutRun> {
  const now = options.now ?? new Date();
  if (!hasSupabaseConfig()) return NOT_TODAY;
  if (!isPayoutRunDay(now)) return NOT_TODAY;

  const limit = options.limit ?? RUN_LIMIT;
  const { start, end } = payoutPeriod(now);
  const ranFor = { start: start.toISOString(), end: end.toISOString() };

  try {
    const admin = createAdminClient();

    /*
     * EVERY TRANCHE PAYABLE BY THE END OF THE PERIOD, not only the ones that fell
     * inside it. The period NAMES the payout; it does not filter the work. A run
     * that was missed — a deploy on a Tuesday, a cron that did not fire — would
     * otherwise lose a week's earnings permanently, since nothing else ever looks
     * at those tranches again.
     */
    const { data: bookingRows, error } = await admin
      .from("bookings")
      .select(
        "id, reference, provider_id, provider_earning, platform_fee, payment_method, payout_due_at, payout_holdback_rupees, payout_holdback_until",
      )
      .eq("payment_status", "paid")
      .not("provider_id", "is", null)
      .gt("provider_earning", 0)
      .lte("payout_due_at", ranFor.end)
      .order("payout_due_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error(`[payouts] due read failed — ${describeError(error)}`);
      return { ...NOT_TODAY, ranFor };
    }

    const bookings = (bookingRows ?? []) as unknown as BookingRow[];
    const byBooking = new Map(bookings.map((b) => [b.id, b]));

    /*
     * `payableTranches` AND NOTHING ELSE decides what a payout is. The redo
     * recovery takes its quarter from the same function, so the two cannot
     * disagree about what the quarter is a quarter of — which is the whole reason
     * that rule lives in `lib/payments/tranches.ts` rather than in either caller.
     */
    const tranches = payableTranches(bookings, end);

    /* ---- the ledger rows ------------------------------------------------- */

    const intended = tranches
      .map((t) => {
        const booking = byBooking.get(t.bookingId);
        return booking ? ledgerWriteFor(t, booking) : null;
      })
      .filter((write): write is LedgerWrite => write !== null);

    let ledgerRows = 0;

    if (intended.length > 0) {
      /*
       * Which are already recorded. One read rather than one per booking, and
       * KEYED ON `(booking, tranche, kind)` — the same lesson
       * `provider_ledger_recovery_tranche_idx` taught: a filter keyed more loosely
       * than the index drops a row before any insert is attempted, and a guard
       * that has quietly stopped guarding looks exactly like one that works.
       */
      const { data: doneRows } = await admin
        .from("provider_ledger")
        .select("booking_id, tranche, kind")
        .in("kind", ["earning", "commission_due"])
        .in("booking_id", Array.from(new Set(intended.map((w) => w.booking_id))));

      const already = new Set(
        ((doneRows ?? []) as {
          booking_id: string | null;
          tranche: string | null;
          kind: string;
        }[])
          .filter((r) => Boolean(r.booking_id))
          .map((r) => `${r.booking_id}:${r.tranche ?? "main"}:${r.kind}`),
      );

      const pending = intended.filter(
        (w) => !already.has(`${w.booking_id}:${w.tranche}:${w.kind}`),
      );

      /*
       * ONE ROW AT A TIME, deliberately. A batch insert is one round trip and
       * fails whole: a single duplicate — a retried run, two overlapping sweeps —
       * would discard every other row in it. The unique indexes are the rule here
       * and a duplicate is them working, so each insert absorbs its own.
       */
      for (const write of pending) {
        const { error: insertError } = await admin
          .from("provider_ledger")
          .insert(write);

        if (insertError) {
          if (/duplicate key|unique constraint/i.test(describeError(insertError))) {
            continue;
          }
          console.error(
            `[payouts] ledger insert failed on ${write.booking_id}/${write.tranche} — ${describeError(insertError)}`,
          );
          continue;
        }
        ledgerRows += 1;
      }
    }

    /* ---- who gets a draft ------------------------------------------------ */

    /*
     * THE TRANCHES ARE NOT THE WHOLE CANDIDATE LIST. Somebody whose payout was
     * held last week — a cooling destination, since confirmed — has no new work
     * this week and is owed money all the same. So the candidates are everybody
     * with a ledger row, and the balance decides whether there is anything to do.
     */
    const { data: ledgerProviders } = await admin
      .from("provider_ledger")
      .select("provider_id")
      .limit(5000);

    const candidates = Array.from(
      new Set([
        ...intended.map((w) => w.provider_id),
        ...((ledgerProviders ?? []) as { provider_id: string }[]).map(
          (r) => r.provider_id,
        ),
      ]),
    ).slice(0, limit);

    const newRows = new Map<string, { earnings: number; commission: number }>();
    for (const write of intended) {
      const entry = newRows.get(write.provider_id) ?? { earnings: 0, commission: 0 };
      if (write.kind === "earning") entry.earnings += write.amount_rupees;
      else entry.commission += write.amount_rupees;
      newRows.set(write.provider_id, entry);
    }

    let considered = 0;
    let drafted = 0;
    let held = 0;
    let unreadable = 0;
    let blocked = 0;
    let carried = 0;
    let rupees = 0;

    for (const providerId of candidates) {
      considered += 1;

      const { data: balance, error: balanceError } = await admin.rpc(
        "provider_balance",
        { target: providerId },
      );

      if (balanceError) {
        // One unreadable balance must not abandon the rest of the run. Logged,
        // skipped, drafted next week — nothing is lost, because the ledger rows
        // are already written and the balance is derived from them.
        console.error(
          `[payouts] balance unreadable for ${providerId} — ${describeError(balanceError)}`,
        );
        continue;
      }

      const net = Number(balance ?? 0);
      if (!Number.isFinite(net) || net === 0) continue;

      const lines = newRows.get(providerId) ?? { earnings: 0, commission: 0 };

      /*
       * WHY THE LINES NEED NOT SUBTRACT TO THE NET, said here because it looks
       * like a bug otherwise. `earnings_rupees` and `commission_rupees` are what
       * THIS run put into the account; `net_rupees` is the whole position, so it
       * already carries a week they owed us, a recovery taken off a debt, and
       * anything held last Tuesday. The screen names that difference rather than
       * hiding it — a statement that silently disagrees with its own arithmetic is
       * worse than one that explains itself.
       */
      const destination = await currentDestination(providerId);

      if (!destination.ok) {
        unreadable += 1;
        continue;
      }

      const heldReason = heldReasonFor(net, destination.destination);

      /*
       * A WEEK THEY OWE US DRAFTS NOTHING. `heldReasonFor` still names it, because
       * the question "why would this not be sent" has an answer worth having on the
       * other surfaces that ask it — but a payout row is an instruction to pay, and
       * there is no such instruction here. It comes off what they earn next, which
       * `net_rupees` picks up on its own because it is the whole position.
       */
      if (heldReason === "negative") {
        carried += 1;
        continue;
      }

      const { error: draftError } = await admin.from("payouts").insert({
        provider_id: providerId,
        period_start: ranFor.start,
        period_end: ranFor.end,
        earnings_rupees: lines.earnings,
        commission_rupees: lines.commission,
        net_rupees: net,
        destination_id: destination.destination?.id ?? null,
        held_reason: heldReason,
        ledger_rows_at_draft: await ledgerRowCount(admin, providerId),
      });

      if (draftError) {
        /*
         * A UNIQUE VIOLATION IS AN INDEX DOING ITS JOB, and there are two of them
         * here saying different things.
         *
         * `payouts_provider_period_idx` means this week is already drafted — a
         * second run, an overlapping cron, a button pressed twice. Nothing to say.
         *
         * `payouts_one_in_flight_idx` means an EARLIER payout of theirs is still
         * unresolved, and that is worth counting: `net_rupees` is the whole
         * position, so two unresolved drafts would describe the same money and each
         * send would write its own `payout` row. The way out is a person — approve
         * the open one, or fail it with a reason — so the run reports it rather than
         * producing the same silence as a professional who is owed nothing.
         */
        const message = describeError(draftError);
        if (/payouts_one_in_flight_idx/i.test(message)) {
          blocked += 1;
          continue;
        }
        if (/duplicate key|unique constraint/i.test(message)) {
          continue;
        }
        console.error(
          `[payouts] draft failed for ${providerId} — ${describeError(draftError)}`,
        );
        continue;
      }

      drafted += 1;
      if (heldReason) held += 1;
      else rupees += net;
    }

    return {
      ranFor,
      considered,
      drafted,
      held,
      unreadable,
      blocked,
      carried,
      ledgerRows,
      rupees,
    };
  } catch (thrown) {
    console.error(`[payouts] run threw — ${describeError(thrown)}`);
    return { ...NOT_TODAY, ranFor };
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * How many ledger rows this professional has.
 *
 * THE STALENESS CURSOR, and a count is enough ONLY because
 * `provider_ledger_append_only` refuses UPDATE and DELETE for every caller, the
 * service role included. The ledger can change in exactly one way — by growing —
 * so a different number means rows arrived. If that trigger ever goes this reads
 * as unchanged while the figures move underneath it, which is why
 * `tests/db/payout-run.test.ts` asserts the trigger is still attached rather than
 * assuming it.
 */
async function ledgerRowCount(
  admin: AdminClient,
  providerId: string,
): Promise<number> {
  const { count } = await admin
    .from("provider_ledger")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", providerId);

  return count ?? 0;
}

/* ------------------------------------------------------------------ *
 * What a person does to a draft
 * ------------------------------------------------------------------ */

export type PayoutActionResult =
  | { ok: true }
  /** The ledger moved. The draft has been recomputed; approve the new figure. */
  | { ok: true; recomputed: true; net: number }
  | {
      ok: false;
      reason:
        | "notFound"
        | "notFresh"
        | "needsReason"
        | "needsReference"
        | "held"
        | "wrongStatus"
        | "destinationChanged"
        | "generic";
    };

/** At least this much of a sentence, so "ok" cannot be a reason. */
const MIN_REASON = 4;

type PayoutRow = {
  id: string;
  provider_id: string;
  status: PayoutStatus;
  net_rupees: number;
  held_reason: string | null;
  ledger_rows_at_draft: number;
  destination_id: string | null;
};

const PAYOUT_COLUMNS =
  "id, provider_id, status, net_rupees, held_reason, ledger_rows_at_draft, destination_id";

/**
 * Is the money still going where this payout said it was going?
 *
 * THE TAKEOVER THE COOLDOWN WOULD OTHERWISE MISS, and it is worth spelling out
 * because every individual piece was already right. A draft is created against a
 * destination that is live, past its cooldown and confirmed. Somebody then changes
 * where the money goes — which is allowed, and starts a fresh 72-hour window on the
 * NEW row. The draft still says `approved`-able, and nothing in it mentions an
 * account, so an approval and a send would release digits for a destination no
 * window has elapsed on and no person has confirmed. `destinationReadiness` was
 * asked at draft time and would never be asked again.
 *
 * So both money-moving actions re-ask it, against the LIVE row, and compare the id
 * as well: a different id is a different account, whatever its readiness says.
 * An unreadable destination refuses too — rule 6 on a gate rather than a screen,
 * since "we could not check" must not pass as "we checked".
 */
async function destinationStillGood(
  payout: PayoutRow,
): Promise<"ok" | "changed" | "unreadable"> {
  const read = await currentDestination(payout.provider_id);
  if (!read.ok) return "unreadable";

  const live = read.destination;
  if (!live) return "changed";
  if (live.id !== payout.destination_id) return "changed";
  if (!live.readiness.ok) return "changed";

  return "ok";
}

async function readPayout(
  admin: AdminClient,
  payoutId: string,
): Promise<PayoutRow | null> {
  const { data, error } = await admin
    .from("payouts")
    .select(PAYOUT_COLUMNS)
    .eq("id", payoutId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PayoutRow;
}

/**
 * Approve a draft.
 *
 * THREE GATES, AND EACH ONE EXISTS BECAUSE OF SOMETHING ALREADY WRITTEN DOWN.
 *
 *   1. FRESH PROOF OF IDENTITY, `REAUTH_WINDOW_MINUTES` read off `amr` — not
 *      `iat`, which resets on every silent token refresh and therefore means
 *      "recently active", which is what a stolen session is. Deliberately not
 *      `STEP_UP_HOURS`: eight hours is right for batched admin work and wrong for
 *      the write that sends somebody's money.
 *   2. A REASON, recorded. "Who approved this" without "why" is a name beside a
 *      number, and the question asked afterwards is always the second one.
 *   3. THE LEDGER HAS NOT MOVED. A refund agreed or a recovery taken between the
 *      draft and the approval means the figure no longer has a ledger behind it.
 *      The draft is RECOMPUTED IN PLACE rather than failed, because
 *      `payouts_provider_period_idx` is unique on `(provider_id, period_start)` —
 *      failing it would block that week for ever — and
 *      `enforce_payout_transition` already permits figures to change while the row
 *      is still `draft`. The caller is told, and approves the new number.
 */
export async function approvePayout(input: {
  payoutId: string;
  adminId: string;
  reauthenticatedAt: Date | null;
  reason: string;
}): Promise<PayoutActionResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };
  if (!isFresh(input.reauthenticatedAt)) return { ok: false, reason: "notFresh" };

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, reason: "needsReason" };

  try {
    const admin = createAdminClient();
    const payout = await readPayout(admin, input.payoutId);
    if (!payout) return { ok: false, reason: "notFound" };
    if (payout.status !== "draft") return { ok: false, reason: "wrongStatus" };
    if (payout.held_reason) return { ok: false, reason: "held" };

    const destination = await destinationStillGood(payout);
    if (destination !== "ok") {
      return {
        ok: false,
        reason: destination === "unreadable" ? "generic" : "destinationChanged",
      };
    }

    const rows = await ledgerRowCount(admin, payout.provider_id);

    if (rows !== payout.ledger_rows_at_draft) {
      const { data: balance } = await admin.rpc("provider_balance", {
        target: payout.provider_id,
      });
      const net = Number(balance ?? 0);

      const { error: recomputeError } = await admin
        .from("payouts")
        .update({ net_rupees: net, ledger_rows_at_draft: rows })
        .eq("id", payout.id)
        .eq("status", "draft");

      if (recomputeError) {
        console.error(
          `[payouts] recompute failed on ${payout.id} — ${describeError(recomputeError)}`,
        );
        return { ok: false, reason: "generic" };
      }

      return { ok: true, recomputed: true, net };
    }

    // The audit row FIRST, the ordering `revealDestination` uses: `lib/audit`
    // never throws, so nothing can be conditional on it, and writing first means
    // an approval that dies mid-call still left the record that somebody tried.
    await recordSecurityEvent({
      kind: "payout.approved",
      actorId: input.adminId,
      actorRole: "admin",
      subjectType: "provider",
      subjectId: payout.provider_id,
      detail: { payoutId: payout.id, net: payout.net_rupees, reason },
    });

    const { error: updateError } = await admin
      .from("payouts")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: input.adminId,
      })
      .eq("id", payout.id)
      .eq("status", "draft");

    if (updateError) {
      console.error(
        `[payouts] approve failed on ${payout.id} — ${describeError(updateError)}`,
      );
      return { ok: false, reason: "generic" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[payouts] approve threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/**
 * Hand an approved payout to a rail, and record that the money left.
 *
 * THE REFERENCE IS REQUIRED. Until a remittance adapter exists somebody is typing
 * into a bank's own screen, and the transaction id is the only thing that can
 * answer "where did my money go" afterwards. A `sent` row without one is a claim
 * with no evidence.
 *
 * THE LEDGER ROW IS WRITTEN BEFORE THE STATUS, and the order is the safe one: if
 * the status write fails the ledger says paid while the payout says approved,
 * which leaves the balance correct and the retry idempotent on
 * `provider_ledger_payout_once_idx`. The other order would mark a payout sent with
 * nothing in the ledger — money gone, and a balance still saying we owe it.
 */
export async function markPayoutSent(input: {
  payoutId: string;
  adminId: string;
  reauthenticatedAt: Date | null;
  reference: string;
  reason: string;
}): Promise<PayoutActionResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };
  if (!isFresh(input.reauthenticatedAt)) return { ok: false, reason: "notFresh" };

  const reference = input.reference.trim();
  if (!reference) return { ok: false, reason: "needsReference" };

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, reason: "needsReason" };

  try {
    const admin = createAdminClient();
    const payout = await readPayout(admin, input.payoutId);
    if (!payout) return { ok: false, reason: "notFound" };
    if (payout.status !== "approved") return { ok: false, reason: "wrongStatus" };

    /*
     * ASKED AGAIN AT THE SEND, not only at the approval. The approval may be
     * minutes or days old and this is the step that releases an account number; a
     * destination changed in between is exactly the case the re-check exists for.
     */
    const destination = await destinationStillGood(payout);
    if (destination !== "ok") {
      return {
        ok: false,
        reason: destination === "unreadable" ? "generic" : "destinationChanged",
      };
    }

    await recordSecurityEvent({
      kind: "payout.sent",
      actorId: input.adminId,
      actorRole: "admin",
      subjectType: "provider",
      subjectId: payout.provider_id,
      detail: {
        payoutId: payout.id,
        net: payout.net_rupees,
        reference,
        reason,
      },
    });

    const { error: ledgerError } = await admin.from("provider_ledger").insert({
      provider_id: payout.provider_id,
      payout_id: payout.id,
      kind: "payout",
      amount_rupees: payout.net_rupees,
      note: `Paid out for the week — reference ${reference}`,
    });

    if (
      ledgerError &&
      !/duplicate key|unique constraint/i.test(describeError(ledgerError))
    ) {
      console.error(
        `[payouts] payout row failed on ${payout.id} — ${describeError(ledgerError)}`,
      );
      return { ok: false, reason: "generic" };
    }

    const { error: updateError } = await admin
      .from("payouts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        external_reference: reference,
      })
      .eq("id", payout.id)
      .eq("status", "approved");

    if (updateError) {
      console.error(
        `[payouts] send failed on ${payout.id} — ${describeError(updateError)}`,
      );
      return { ok: false, reason: "generic" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[payouts] send threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/**
 * The rail says it arrived.
 *
 * NO RE-CHALLENGE HERE, and that is a decision rather than an omission. The other
 * three actions move money or decide that it did not move; this one records an
 * answer that came from outside and changes no figure. A code demanded for a
 * write that cannot cost anybody anything is how people learn to tap through the
 * ones that can — `lib/payments/pricing.ts` names that failure. It is audited as
 * an ordinary admin action, and `confirmed` is terminal: a confirmed payout that
 * later bounces is a new fact handled by a reversal and a fresh draft, never an
 * edit of this one.
 */
export async function markPayoutConfirmed(input: {
  payoutId: string;
  adminId: string;
}): Promise<PayoutActionResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };

  try {
    const admin = createAdminClient();
    const payout = await readPayout(admin, input.payoutId);
    if (!payout) return { ok: false, reason: "notFound" };
    if (payout.status !== "sent") return { ok: false, reason: "wrongStatus" };

    await recordSecurityEvent({
      kind: "admin.action",
      actorId: input.adminId,
      actorRole: "admin",
      subjectType: "provider",
      subjectId: payout.provider_id,
      detail: { action: "payout.confirmed", payoutId: payout.id },
    });

    const { error } = await admin
      .from("payouts")
      .update({ status: "confirmed", settled_at: new Date().toISOString() })
      .eq("id", payout.id)
      .eq("status", "sent");

    if (error) {
      console.error(
        `[payouts] confirm failed on ${payout.id} — ${describeError(error)}`,
      );
      return { ok: false, reason: "generic" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[payouts] confirm threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/**
 * It did not go.
 *
 * WHAT GETS REVERSED IS DECIDED BY `needsReversal`, not by this file: only a
 * `sent` payout put a `payout` row into the ledger, so only a `sent` one has
 * anything to take back. A draft or an approval moved nothing, and reversing one
 * would credit a professional for a payment nobody made.
 *
 * THE `payout` ROW IS NEVER DELETED. An append-only ledger forbids it, and it is
 * the one piece of evidence that a remittance was attempted — which is exactly
 * what somebody investigating a missing payment needs. The reversal sits beside
 * it, and the pair reads as what happened.
 */
export async function markPayoutFailed(input: {
  payoutId: string;
  adminId: string;
  reauthenticatedAt: Date | null;
  reason: string;
}): Promise<PayoutActionResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };
  if (!isFresh(input.reauthenticatedAt)) return { ok: false, reason: "notFresh" };

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, reason: "needsReason" };

  try {
    const admin = createAdminClient();
    const payout = await readPayout(admin, input.payoutId);
    if (!payout) return { ok: false, reason: "notFound" };
    if (payout.status === "confirmed" || payout.status === "failed") {
      return { ok: false, reason: "wrongStatus" };
    }

    await recordSecurityEvent({
      kind: "payout.failed",
      actorId: input.adminId,
      actorRole: "admin",
      subjectType: "provider",
      subjectId: payout.provider_id,
      detail: {
        payoutId: payout.id,
        from: payout.status,
        net: payout.net_rupees,
        reason,
      },
    });

    if (needsReversal(payout.status)) {
      const { error: reversalError } = await admin
        .from("provider_ledger")
        .insert({
          provider_id: payout.provider_id,
          payout_id: payout.id,
          kind: "payout_reversal",
          amount_rupees: payout.net_rupees,
          note: "The payout did not arrive. The amount is back on your balance.",
        });

      if (
        reversalError &&
        !/duplicate key|unique constraint/i.test(describeError(reversalError))
      ) {
        console.error(
          `[payouts] reversal failed on ${payout.id} — ${describeError(reversalError)}`,
        );
        return { ok: false, reason: "generic" };
      }
    }

    const { error } = await admin
      .from("payouts")
      .update({ status: "failed", failure_reason: reason })
      .eq("id", payout.id)
      .eq("status", payout.status);

    if (error) {
      console.error(
        `[payouts] fail failed on ${payout.id} — ${describeError(error)}`,
      );
      return { ok: false, reason: "generic" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[payouts] fail threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/* ------------------------------------------------------------------ *
 * What the screen reads
 * ------------------------------------------------------------------ */

export type PayoutForReview = {
  id: string;
  providerId: string;
  providerName: string | null;
  periodStart: Date;
  periodEnd: Date;
  status: PayoutStatus;
  earnings: number;
  commission: number;
  net: number;
  /**
   * `net − (earnings − commission)`: what the week's own rows do not explain.
   *
   * SHOWN RATHER THAN HIDDEN. A recovery, a week they owed us, or a payout held
   * last Tuesday all land here, and a statement whose lines do not add up to its
   * total is one nobody trusts — including the person deciding whether to approve
   * it.
   */
  carried: number;
  heldReason: string | null;
  externalReference: string | null;
  /** The destination this was drafted against, which may since have retired. */
  destinationId: string | null;
  /**
   * The LIVE destination, masked — where money would go if it went now.
   *
   * `id` is carried so the screen can see that it is not the one the payout was
   * drafted against. That difference is the takeover case, and a screen that
   * printed only the masked tail would show four plausible digits of an account
   * nobody has confirmed.
   */
  destination: { id: string; masked: string; name: string; kind: string } | null;
  createdAt: Date;
};

/**
 * Everything not yet finished, newest period first.
 *
 * A FAILED READ IS NOT AN EMPTY QUEUE — the `/services` lesson on the screen where
 * it decides whether money moves. `null` means the read failed and the page says
 * so; `[]` means there is genuinely nothing to approve.
 */
export async function payoutsForReview(): Promise<PayoutForReview[] | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("payouts")
      .select(
        "id, provider_id, period_start, period_end, status, earnings_rupees, commission_rupees, net_rupees, held_reason, external_reference, destination_id, created_at, providers(display_name)",
      )
      .in("status", UNRESOLVED_PAYOUT_STATUSES)
      .order("period_start", { ascending: false })
      .limit(100);

    if (error) {
      console.error(`[payouts] review read failed — ${describeError(error)}`);
      return null;
    }

    const rows = (data ?? []) as unknown as (Record<string, unknown> & {
      providers: { display_name: string | null } | null;
    })[];

    /*
     * The masked destination comes from `currentDestination`, which is the only
     * thing that opens an envelope to mask it. A payout's own `destination_id` may
     * name a row that has since retired — which is precisely why the column is
     * kept — so the screen shows where money is going NOW beside a payout that
     * remembers where it was going then.
     */
    const masked = new Map<
      string,
      { id: string; masked: string; name: string; kind: string }
    >();
    const providerIds = Array.from(new Set(rows.map((r) => String(r.provider_id))));
    for (const providerId of providerIds) {
      const read = await currentDestination(providerId);
      if (read.ok && read.destination) {
        masked.set(providerId, {
          id: read.destination.id,
          masked: read.destination.accountMasked,
          name: read.destination.accountName,
          kind: read.destination.kind,
        });
      }
    }

    return rows.map((row) => {
      const earnings = Number(row.earnings_rupees ?? 0);
      const commission = Number(row.commission_rupees ?? 0);
      const net = Number(row.net_rupees ?? 0);
      const providerId = String(row.provider_id);

      return {
        id: String(row.id),
        providerId,
        providerName: row.providers?.display_name ?? null,
        periodStart: new Date(String(row.period_start)),
        periodEnd: new Date(String(row.period_end)),
        status: row.status as PayoutStatus,
        earnings,
        commission,
        net,
        carried: net - (earnings - commission),
        heldReason: (row.held_reason as string | null) ?? null,
        externalReference: (row.external_reference as string | null) ?? null,
        destinationId: (row.destination_id as string | null) ?? null,
        destination: masked.get(providerId) ?? null,
        createdAt: new Date(String(row.created_at)),
      };
    });
  } catch (thrown) {
    console.error(`[payouts] review read threw — ${describeError(thrown)}`);
    return null;
  }
}
