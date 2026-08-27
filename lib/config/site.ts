/**
 * Single source of truth for brand strings and the marketing content that
 * appears in more than one place. Keeping it here means the rename that
 * turned Sewa[X] into SajiloKaam is a one-file change next time.
 */
export const site = {
  name: "SajiloKaam",
  /** The wordmark is two-tone: `name` in ink, `accent` in gold. */
  wordmark: { lead: "Sajilo", accent: "Kaam" },
  nameNe: "सजिलो काम",
  tagline: "Verified home help across the Kathmandu Valley.",
  taglineNe: "घरको काम, सजिलो तरिकाले।",
  description:
    "Describe what's broken and get matched with an ID-verified plumber, electrician, cleaner or repair professional — with the price agreed before anyone starts work.",
  url: "https://sajilokaam.vercel.app",
} as const;
