/**
 * Nepali mobile numbers.
 *
 * NTC and Ncell mobiles are 10 digits beginning 97 or 98. Landlines start
 * with an area code (01 for Kathmandu, 021 for Biratnagar and so on) and
 * cannot receive SMS, so they are rejected explicitly rather than failing
 * later with an opaque provider error.
 *
 * Stored and sent as E.164 (+977XXXXXXXXXX); displayed grouped, because that
 * is how people read their own number back.
 */

export const NEPAL_DIAL_CODE = "+977";

export type PhoneCheck =
  { ok: true; e164: string; national: string } | { ok: false; reason: string };

/** Digits only, with any +977 / 977 / leading 0 prefix removed. */
export function toNationalDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("977")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits;
}

export function checkNepaliMobile(input: string): PhoneCheck {
  const national = toNationalDigits(input);

  if (national.length === 0) {
    return { ok: false, reason: "Enter your mobile number." };
  }

  // Landlines first: "01…" numbers are 7-8 digits and would otherwise read as
  // "too short", which is not the actual problem. Every Nepali mobile begins
  // with 9, so anything else is a fixed line — don't try to enumerate area
  // codes, that list is long and it changes.
  if (!national.startsWith("9")) {
    return {
      ok: false,
      reason: "That's a landline. We can only text a mobile.",
    };
  }

  // 96 is a live prefix on some networks but not one we serve yet, so it gets
  // the prefix message rather than being mislabelled a landline.
  if (!/^9[78]/.test(national)) {
    return {
      ok: false,
      reason: "Mobile numbers here start 97 or 98.",
    };
  }

  if (national.length < 10) {
    return {
      ok: false,
      reason: "Too short — a mobile number is 10 digits.",
    };
  }

  if (national.length > 10) {
    return {
      ok: false,
      reason: "Too long — a mobile number is 10 digits.",
    };
  }

  return {
    ok: true,
    e164: `${NEPAL_DIAL_CODE}${national}`,
    national,
  };
}

/** 98XX XXX XXX — grouped as people say it aloud. */
export function formatNepaliMobile(input: string): string {
  const d = toNationalDigits(input).slice(0, 10);
  const parts = [d.slice(0, 4), d.slice(4, 7), d.slice(7, 10)].filter(Boolean);
  return parts.join(" ");
}

/** For display next to "we sent a code to…". */
export function formatE164ForDisplay(e164: string): string {
  return `${NEPAL_DIAL_CODE} ${formatNepaliMobile(e164)}`;
}
