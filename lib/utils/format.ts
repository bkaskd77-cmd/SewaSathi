/**
 * Format an amount in Nepalese rupees.
 *
 * Nepal uses the South Asian digit grouping (1,00,000 — not 100,000), which
 * `en-IN` produces correctly; `en-NP` is not reliably available across runtimes.
 */
export function formatNpr(
  amount: number,
  options: { withDecimals?: boolean } = {},
): string {
  const { withDecimals = false } = options;
  const digits = withDecimals ? 2 : 0;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "NPR",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
