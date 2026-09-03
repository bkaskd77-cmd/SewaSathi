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
  /**
   * The public origin, from NEXT_PUBLIC_SITE_URL.
   *
   * Hard-coding it meant every Open Graph preview and every absolute URL
   * advertised sajilokaam.vercel.app while the site was actually served from
   * sewasathi.vercel.app — a wrong domain on every link anyone shared. It is an
   * env var so it follows the deployment, including the move to a custom
   * domain, without a code change.
   *
   * The fallback is Vercel's own VERCEL_URL, which is correct on preview
   * deployments where nobody has set the variable, and finally localhost so a
   * fresh clone builds. Trailing slashes are stripped because everything that
   * uses this appends a path.
   */
  url: siteUrl(),

  /**
   * The number a customer rings when the product cannot help them.
   *
   * One constant because it appears on five screens and one of them is the
   * login fallback — the screen somebody reaches when nothing else in the
   * product is working for them. Five copies of a phone number means four
   * chances of a stale one, and the stale one is the one on the screen that
   * matters most.
   */
  supportPhone: "+9779800000000",
} as const;

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/** An absolute URL for `path`, for canonical and Open Graph tags. */
export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
