/**
 * What somebody typed into the lookup box, and which kind of thing it is.
 *
 * PURE, AND SEPARATE FROM THE READ, because the interesting half of a support
 * lookup is the tolerance rather than the query. Somebody is reading a
 * reference off a receipt, or repeating one a customer said down a phone, and
 * the difference between finding the booking and not is entirely in what the
 * box forgives.
 *
 * WHAT IT FORGIVES: case, spaces, and a missing `SK-`, because that is what a
 * person reads aloud.
 *
 * WHAT IT CANNOT FORGIVE, AND SAYS SO INSTEAD. A booking reference is `SK-`
 * plus five characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — which
 * excludes **all four** of `0`, `O`, `1` and `I`, not one of each pair. The
 * first version of this file tried to fold `0` to `O` and `1` to `I`; there is
 * nothing to fold them to, because neither survivor exists either. A typed one
 * is a misread that cannot be recovered — `Q`, `D` and `O` are the same smudge
 * on a cracked screen and we cannot know which was meant.
 *
 * So it is named rather than guessed at: `impossibleReference` lets the screen
 * say *references never contain those four characters, look again* instead of
 * running a search that was never going to match and answering "not found".
 * On a support call the difference is whether the person re-reads the
 * reference or starts doubting the booking exists.
 *
 * A PAYMENT REFERENCE IS NOT FORGIVEN THE SAME WAY. `SKP-` + base64url is
 * mixed case and contains `-` and `_`; folding or upper-casing it would turn a
 * valid handle into one that matches nothing. It arrives pasted from a receipt
 * or a gateway statement, never spoken, so it is taken as typed.
 *
 * A PHONE IS DIGITS. Nepali numbers get written `+977 98…`, `977-98…`,
 * `098…`; the digits are the only stable part.
 */

export type Handle =
  | { kind: "reference"; value: string }
  | { kind: "paymentReference"; value: string }
  | { kind: "phone"; value: string }
  /** The right shape, holding a character no reference can contain. */
  | { kind: "impossibleReference"; offending: string }
  | { kind: "none" };

/** `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — no 0, O, 1 or I. */
const REFERENCE_BODY = /^[2-9A-HJ-NP-Z]{5}$/;
const NEVER_IN_A_REFERENCE = /[01IO]/g;

export function readHandle(raw: string): Handle {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "none" };

  // Before the booking reference: `SKP-` starts with the same two letters as
  // `SK-`, and a payment reference stripped of its prefix would otherwise be
  // mangled into a booking one.
  if (/^SKP-/i.test(trimmed)) {
    return { kind: "paymentReference", value: trimmed };
  }

  const upper = trimmed.replace(/\s+/g, "").toUpperCase();
  const body = upper.startsWith("SK-") ? upper.slice(3) : upper;
  if (REFERENCE_BODY.test(body)) {
    return { kind: "reference", value: `SK-${body}` };
  }

  /*
   * Right length, wrong alphabet. Only when it is otherwise reference-shaped:
   * a phone number is full of `0`s and `1`s and must not be diagnosed as a
   * broken reference.
   */
  if (body.length === 5 && /^[0-9A-Z]{5}$/.test(body)) {
    const offending = Array.from(new Set(body.match(NEVER_IN_A_REFERENCE) ?? []));
    if (offending.length > 0) {
      return { kind: "impossibleReference", offending: offending.join(" ") };
    }
  }

  /*
   * A PHONE ONLY IF IT IS LONG ENOUGH TO BE ONE. Nepali mobiles are ten
   * digits, thirteen with the country code. Accepting anything shorter would
   * turn a mistyped reference into a phone search that scans the whole table
   * and finds nobody — a slower way of saying the same "not found", with a
   * sensitive read logged against it for no reason.
   */
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 9) return { kind: "phone", value: digits };

  return { kind: "none" };
}

/**
 * The last nine digits, which is what two ways of writing one number share.
 *
 * `profiles.phone` is stored as whatever the provider returned — `+9779800…`
 * in practice, but the column has no format check, unlike
 * `provider_contacts.phone`. Matching on the suffix is what makes
 * `9779800000011`, `+977 9800000011` and `9800000011` the same person.
 */
export function phoneSuffix(digits: string): string {
  return digits.slice(-9);
}
