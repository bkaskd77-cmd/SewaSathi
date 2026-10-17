import {
  DESTINATION_COOLDOWN_HOURS,
  MIN_LENGTH_TO_REVEAL_TAIL,
  REVEALED_TAIL,
} from "@/lib/config/payout-policy";

/**
 * How a payout destination is shown, and when it may be used.
 *
 * ONE PLACE DECIDES HOW MUCH OF AN ACCOUNT NUMBER APPEARS. Every surface asks
 * this rather than slicing the string itself — the same arrangement as
 * `lib/provider/measured.ts` deciding what counts as evidence, and for the same
 * reason: the moment two surfaces each decide, they disagree, and here the
 * disagreement is how much of somebody's bank account is on a screen.
 *
 * Pure: no database, no `server-only`. It is reached from server code today and
 * the masking has to be testable without either.
 */

/**
 * `••••4821`, or `••••••••` when the reference is too short to reveal any of.
 *
 * THE LENGTH IS NOT REVEALED EITHER. A fixed run of dots rather than one per
 * hidden character, because the length of an account number narrows which bank
 * it belongs to, and the mask exists so somebody can recognise their own
 * account — not so a reader can reconstruct it.
 *
 * WHAT THIS IS NOT. It is not a security control on its own: four digits of a
 * wallet number, with Nepali mobiles all starting `+9779`, is a real hint to
 * anybody who already knows the person. It is a recognition aid, and the
 * control is that the whole value never leaves the service role.
 */
export function maskAccountRef(ref: string): string {
  const trimmed = (ref ?? "").trim();
  if (trimmed.length < MIN_LENGTH_TO_REVEAL_TAIL) return "••••••••";
  return `••••${trimmed.slice(-REVEALED_TAIL)}`;
}

/**
 * When a destination created now becomes usable.
 *
 * Stamped onto the row at insert as `usable_from`. Returned as a `Date` so the
 * caller writes an ISO string once, at the edge.
 *
 * THE COOLDOWN IS A CHANGE CONTROL, NOT AN ARRIVAL TAX. It exists because an
 * account takeover's first move is to redirect the money, and the window is the
 * time the real person has to see the notice and object. A professional who has
 * never named a destination is not being redirected from anywhere — there is no
 * notice to read and nobody to object. Making them wait three days for their
 * first payment would be a delay with no attacker on the other side of it.
 *
 * WHAT GUARDS THE FIRST ONE INSTEAD is `first_payout_confirmed_at`: a person
 * looks before any money goes to a destination nobody has paid before.
 * `destinationReadiness` returns `unconfirmed` until then, so a first row is
 * immediately usable and still not payable — two different gates, and the screen
 * says so rather than leaving somebody to infer it.
 *
 * `isFirst` IS DECIDED BY THE CALLER COUNTING EVERY ROW THAT HAS EVER EXISTED,
 * retired ones included. Counting only live rows would make this the bypass:
 * retire the destination, add another, and the cooldown never applies — the
 * takeover path with one extra step. The rule is stated here because this is
 * where somebody reads it; `changeDestination` is where it is enforced.
 */
export function destinationUsableFrom(
  createdAt: Date,
  options: { isFirst: boolean } = { isFirst: false },
): Date {
  if (options.isFirst) return createdAt;
  return new Date(
    createdAt.getTime() + DESTINATION_COOLDOWN_HOURS * 60 * 60 * 1000,
  );
}

export type DestinationReadiness =
  | { ok: true }
  | {
      ok: false;
      reason: "retired" | "cooling" | "unwitnessed" | "unconfirmed";
      usableFrom?: Date;
    };

/**
 * Could the change notice reach a device this professional holds?
 *
 * PURE, AND SEPARATE, BECAUSE IT IS THE ONE JUDGEMENT THAT DECIDES WHETHER A
 * PERSON MUST BE RUNG. `notice_devices` is a count taken at the instant the
 * destination was recorded; this reduces it to the only question anybody asks
 * of it.
 *
 * NULL IS NOT ZERO AND NOT "YES" — rule 6. A row written before the column
 * existed cannot say, and "cannot say" has to behave like "nobody was reached",
 * because the alternative is a payout released on the strength of a notice we
 * have no evidence anybody could read. Being wrong this way costs a phone call.
 *
 * A PUSH SERVICE ACCEPTING A MESSAGE IS NOT A PERSON READING IT, which is why
 * nothing here is named `delivered`. What this establishes is weaker and is the
 * most that can be established: there was a device to address.
 */
export function noticeCouldReachSomebody(noticeDevices: number | null): boolean {
  return noticeDevices !== null && noticeDevices > 0;
}

/**
 * May this destination receive the payout being prepared?
 *
 * THREE REFUSALS AND THEY ARE NOT THE SAME FACT, which is why this returns a
 * reason rather than a boolean:
 *
 *   retired      it was replaced; money must never follow a superseded address
 *   cooling      inside the takeover window — a delay, and the date says when
 *   unconfirmed  nobody has looked at the first payout to this destination yet
 *
 * `unconfirmed` is deliberately last: a destination can be live and past its
 * cooldown and still need a person, and reporting "cooling" for it would tell
 * the professional to wait for a date that has already passed.
 */
export function destinationReadiness(
  destination: {
    retiredAt: Date | null;
    usableFrom: Date;
    firstPayoutConfirmedAt: Date | null;
    /**
     * Did this row REPLACE another? A first destination redirects nobody, so
     * there was no warning anybody needed to read and `unwitnessed` cannot
     * apply to it — it is gated by `unconfirmed` like any other new address.
     */
    replacedAnother?: boolean;
    /** Live push subscriptions when it was recorded. Null is "not recorded". */
    noticeDevices?: number | null;
  },
  now: Date = new Date(),
): DestinationReadiness {
  if (destination.retiredAt !== null) return { ok: false, reason: "retired" };

  /*
   * UNWITNESSED OUTRANKS COOLING, AND THAT ORDER IS THE WHOLE POINT. The
   * 72-hour window is not a delay for its own sake — it is time to OBJECT, and
   * an account with no device was told nothing to object to. Reporting
   * "cooling until Thursday" there would name a date as though a protection
   * were running, which is the `server.region` mistake in a place where it
   * costs somebody their earnings rather than a 503.
   *
   * IT CLEARS ON CONFIRMATION, which is what makes this a gate rather than a
   * wall: a person speaks to the professional, confirms, and the money moves.
   * Holding it past that would be refusing the only control we have while
   * demanding it be exercised.
   */
  if (
    destination.replacedAnother === true &&
    destination.firstPayoutConfirmedAt === null &&
    !noticeCouldReachSomebody(destination.noticeDevices ?? null)
  ) {
    return { ok: false, reason: "unwitnessed" };
  }

  if (destination.usableFrom.getTime() > now.getTime()) {
    return { ok: false, reason: "cooling", usableFrom: destination.usableFrom };
  }

  if (destination.firstPayoutConfirmedAt === null) {
    return { ok: false, reason: "unconfirmed" };
  }

  return { ok: true };
}

/** What a payout may be held for. The closed set `payouts.held_reason` allows. */
export type PayoutHeldReason =
  | "cooling"
  /** Changed, and no device could be told. A person must speak to them. */
  | "unwitnessed"
  | "unconfirmed"
  | "no_destination"
  | "negative"
  /**
   * Step 4 of the published enforcement ladder: the review is running and the
   * money waits. It is not taken, and it is released in full if the review
   * clears — which is why this is a hold and never a deduction.
   */
  | "under_review";

/**
 * The closed set, as one list.
 *
 * IT IS WRITTEN TWICE — here and in `payouts_held_reason_check` — and a db test
 * compares them out of `pg_constraint`. A reason the constraint does not know
 * is refused at the insert, so a payout that should have been held would fail
 * to draft at all: the run counts it as an error and the week goes unpaid, on
 * the one path where a silent failure means somebody is not paid.
 */
export const PAYOUT_HELD_REASONS: readonly PayoutHeldReason[] = [
  "cooling",
  "unwitnessed",
  "unconfirmed",
  "no_destination",
  "negative",
  "under_review",
];

/** The hold reasons, in precedence order. Pure so the test can read it directly. */
export function heldReasonFor(
  net: number,
  destination: { readiness: { ok: boolean; reason?: string } } | null,
  /**
   * The enforcement step in force, or null.
   *
   * STEP 4 IS "money already earned waits rather than being paid out. It is not
   * taken." — `/providers/standards`, published in both languages. Held, never
   * deducted: the ledger is untouched and the next run drafts the same sum once
   * the review clears, which is what lets the page promise "released in full
   * with an apology".
   *
   * ITS OWN REASON RATHER THAN REUSING ONE. The professional's own screen prints
   * this through `whyWaiting`, and "we are reviewing your account" and "we do
   * not know where to send it" are not the same sentence to be told — one is
   * ours to explain and the other asks them to go and fix something.
   */
  step: number | null = null,
): PayoutHeldReason | null {
  /*
   * NEGATIVE FIRST, because where they owe us the destination is irrelevant: we
   * are not sending anything, and asking "is their bank account confirmed" about a
   * week they owe us would report a hold for the wrong reason. It is carried
   * forward and never collected — CLAUDE.md refuses backward recovery, so next
   * week's net absorbs it.
   */
  if (net < 0) return "negative";

  /*
   * AFTER `negative` AND BEFORE EVERY DESTINATION REASON. A week they owe us
   * drafts nothing at all, so there is nothing to hold and reporting a review
   * would describe a payout that does not exist. Above the destination reasons
   * because a review is ours and a cooling account is theirs: telling somebody
   * under review to go and confirm their bank details sends them to fix a thing
   * that is not what is stopping the money.
   */
  if (step !== null && step >= 4) return "under_review";

  if (!destination) return "no_destination";
  if (destination.readiness.ok) return null;

  /*
   * `destinationReadiness` ALREADY DECIDED THIS and is composed rather than
   * re-asked. Its three refusals map onto three of ours; `retired` cannot reach
   * here because `currentDestination` reads only the live row, and if it ever did
   * it means there is no address to pay — which is what `no_destination` says.
   */
  switch (destination.readiness.reason) {
    case "cooling":
      return "cooling";
    case "unwitnessed":
      return "unwitnessed";
    case "unconfirmed":
      return "unconfirmed";
    default:
      return "no_destination";
  }
}

/**
 * Why this week's payout has not arrived, in the professional's terms.
 *
 * WHAT THIS IS FOR. `payouts_one_in_flight_idx` refuses a second unresolved
 * payout, which is what stops two drafts describing the same money — and the cost
 * is that an unapproved draft stops the next week being drafted at all. The run
 * counts that as `blocked` in a `cron_runs` summary nobody opens. A guard whose
 * cost only shows up in a log is how somebody's week quietly becomes a month, so
 * the person it happens to is told.
 *
 * PURE, and in this module rather than in `lib/data/payouts.ts`, for the reason
 * `heldReasonFor` is here: a judgement inside a `server-only` module is one no test
 * can reach, which this repository has paid for five times now — the last of them
 * in the commit that added `heldReasonFor` itself.
 *
 * `waiting` IS NOT THE SAME AS `held`, and that distinction is the whole value of
 * the function. A held payout is waiting on something nameable — an account inside
 * its cooldown, one nobody has checked, no account at all. A drafted one that is
 * not held is waiting on **us**: a person has to approve it, and saying "held"
 * about that would blame the professional's own paperwork for our queue.
 */
export type PayoutWait =
  /** Nothing drafted and nothing owed. The ordinary state between weeks. */
  | { state: "nothing" }
  /** Drafted, unheld: a person here has to approve it. Carries its age in days. */
  | { state: "approval"; days: number }
  /** Approved and not yet sent, or sent and not yet confirmed. */
  | { state: "onItsWay" }
  /** Held, and `reason` says which. */
  | { state: "held"; reason: PayoutHeldReason }
  /** We could not read it — never rendered as "nothing is waiting". */
  | { state: "unreadable" };

export function whyWaiting(
  payout:
    | {
        status: "draft" | "approved" | "sent" | "confirmed" | "failed";
        heldReason: PayoutHeldReason | null;
        createdAt: Date;
      }
    | null,
  options: { readable: boolean; now?: Date } = { readable: true },
): PayoutWait {
  /*
   * UNREADABLE OUTRANKS EVERYTHING. A failed read has no payout to describe, and
   * `null` from a broken query looks exactly like `null` from a quiet week — rule
   * 6 on the screen where the professional is asking where their money is.
   */
  if (!options.readable) return { state: "unreadable" };
  if (!payout) return { state: "nothing" };

  if (payout.heldReason) return { state: "held", reason: payout.heldReason };

  if (payout.status === "approved" || payout.status === "sent") {
    return { state: "onItsWay" };
  }

  if (payout.status === "draft") {
    const now = options.now ?? new Date();
    const elapsed = now.getTime() - payout.createdAt.getTime();
    /*
     * FLOORED, so a draft made this morning reads as 0 days rather than 1. The age
     * is what makes the sentence actionable — "waiting since Tuesday" is a
     * different fact from "waiting since last month" — and rounding it up would
     * make every fresh draft look a day stale.
     */
    const days = Math.max(0, Math.floor(elapsed / 86_400_000));
    return { state: "approval", days };
  }

  // `confirmed` and `failed` are finished. Neither is waiting on anything, and a
  // failed one is reported by its own line rather than as a wait.
  return { state: "nothing" };
}
