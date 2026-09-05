import { execSync } from "node:child_process";

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Stamp the build so a served page can say which commit produced it.
 *
 * Vercel hands us the SHA directly. Off Vercel we ask git, and a checkout that
 * has no git (a tarball, a Docker build) simply says "unknown" rather than
 * failing the build — a missing stamp is a weaker check, not a broken product.
 */
function buildCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/**
 * The security headers, and the one directive that had to stay permissive.
 *
 * `script-src` carries `'unsafe-inline'`. Three inline scripts need it and
 * none of them is ours to delete: Next's own RSC bootstrap, next-themes'
 * flash-prevention script, and the one line in the locale layout that marks
 * the document JS-capable before first paint. The correct fix is a per-request
 * nonce issued in middleware, which Next supports — it is not done here
 * because this middleware also runs next-intl, and threading a request header
 * through a rewrite it does not own is the kind of change that silently drops
 * a session cookie on a language switch. It is written down as the top of the
 * remaining-weakness list rather than quietly skipped.
 *
 * Everything else is tight, and each of these is load-bearing rather than
 * decorative:
 *
 *   frame-ancestors 'none'   Nobody frames this. A booking page in an iframe
 *                            on somebody else's site is a clickjacked
 *                            "confirm payment" button.
 *   form-action              Only ourselves and eSewa's own gateway. eSewa is
 *                            paid by a real form POST to their domain, which
 *                            is precisely what this directive governs, so it
 *                            is listed rather than left to a wildcard.
 *   object-src 'none'        No plugins, ever.
 *   base-uri 'self'          An injected <base> tag rewrites every relative
 *                            URL on the page, including the ones that post
 *                            money.
 *   connect-src              Ourselves and Supabase, including the websocket
 *                            the live booking page opens.
 *
 * `img-src` allows `https:` because provider photographs are remote URLs
 * today. It narrows to the storage host in the phase that moves them.
 */
const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self' https://epay.esewa.com.np https://rc-epay.esewa.com.np",
  "script-src 'self' 'unsafe-inline'",
  // Next inlines critical CSS; there is no nonce path for it that does not
  // also need the one above.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // next/font/google self-hosts at build time, so nothing is fetched at
  // runtime and this can be closed completely.
  "font-src 'self'",
  `connect-src 'self' ${SUPABASE_HOST} ${SUPABASE_HOST.replace("https://", "wss://")}`.trim(),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  {
    // Two years and preload-ready. Vercel terminates TLS, but a header that
    // says "never speak to me over http again" is what protects the second
    // visit on a hostile network — which in Nepal is most public wifi.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Redundant with frame-ancestors on anything current, and free on anything
  // that is not.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Nothing in this product uses any of them. A booking page that could
    // silently ask for a location is a booking page that will, one day, be
    // asked to.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  env: {
    BUILD_COMMIT: buildCommit(),
    BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);
