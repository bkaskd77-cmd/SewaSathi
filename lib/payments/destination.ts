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
  | { ok: false; reason: "retired" | "cooling" | "unconfirmed"; usableFrom?: Date };

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
  },
  now: Date = new Date(),
): DestinationReadiness {
  if (destination.retiredAt !== null) return { ok: false, reason: "retired" };

  if (destination.usableFrom.getTime() > now.getTime()) {
    return { ok: false, reason: "cooling", usableFrom: destination.usableFrom };
  }

  if (destination.firstPayoutConfirmedAt === null) {
    return { ok: false, reason: "unconfirmed" };
  }

  return { ok: true };
}
