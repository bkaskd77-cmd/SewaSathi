/**
 * Single source of truth for brand strings and the marketing content that
 * appears in more than one place. Keeping it here means the rename that
 * turned Sewa[X] into SajiloKaam is a one-file change next time.
 */
import { checkNepaliMobile, formatE164ForDisplay } from "@/lib/auth";

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
   * The number a customer rings when the product cannot help them, or `null`
   * when there is not one yet.
   *
   * NULL IS A REAL STATE AND EVERY CALLER HANDLES IT. It used to be the
   * placeholder `+977 9800 000 000`, which does not ring. That is worse than
   * having no number at all, and the day sign-in broke it was proved: the
   * gateway refused every code, the login screen fell back to "call us and
   * we'll take your booking over the phone", and the number beside that
   * sentence was invented. A customer met a dead door and a dead escape hatch
   * as one wall, and the second one is the one that reads as contempt —
   * the product did not merely fail, it offered help that was not there.
   *
   * So there is no placeholder any more. Where there is no number, the call is
   * not offered and the screen says plainly what is true.
   * `npm run check:contacts` fails the build if a placeholder ever comes back.
   *
   * One constant because it appears on nine screens and one of them is that
   * login fallback. Nine copies means eight chances of a stale one, and the
   * stale one is always the one on the screen that matters most.
   */
  supportPhone: readSupportPhone(),
} as const;

/** Formatted for reading aloud — `+977 98XX XXX XXX`. Null when unset. */
export const supportPhoneDisplay: string | null = site.supportPhone
  ? formatE164ForDisplay(site.supportPhone)
  : null;

/**
 * From the environment, so the day a real line exists it is one Vercel
 * variable and a redeploy rather than a code change.
 *
 * VALIDATED, AND A BAD VALUE BECOMES NULL RATHER THAN REACHING A SCREEN.
 * The whole point of this constant is that nothing unreachable is ever offered
 * to somebody who is already stuck, and a typo in a dashboard is exactly as
 * unreachable as a placeholder. Silence is the safe failure here.
 */
function readSupportPhone(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim();
  if (!configured) return null;
  const checked = checkNepaliMobile(configured);
  return checked.ok ? checked.e164 : null;
}

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
