/**
 * Format an amount in Nepalese rupees.
 *
 * Nepal uses the South Asian digit grouping (1,00,000 — not 100,000), which
 * `en-IN` produces correctly; `en-NP` is not reliably available across
 * runtimes.
 *
 * Digits stay Latin in both languages. `ne` renders 1,234 as १,२३४, and a page
 * that mixes Devanagari prices with a Latin phone number, a 4.8 rating and an
 * OTP is harder to read than one that picks a side. Every marketplace people
 * here already use — eSewa, Khalti, Daraz — writes prices this way. Only the
 * symbol changes: "Rs" becomes "रु".
 */
const NPR_SYMBOL = { en: "Rs", ne: "रु" } as const;

export function formatNpr(
  amount: number,
  options: { withDecimals?: boolean; locale?: "en" | "ne" } = {},
): string {
  const { withDecimals = false, locale = "en" } = options;
  const digits = withDecimals ? 2 : 0;

  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "NPR",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);

  if (locale === "en") return formatted;
  // "Rs 1,200" — the separator is a non-breaking space, and it has to survive.
  return formatted.replace(NPR_SYMBOL.en, NPR_SYMBOL.ne);
}
