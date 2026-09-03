import { NextResponse } from "next/server";

import { routing, type Locale } from "@/i18n/routing";
import { findPaymentByReference, verifyAndSettle } from "@/lib/data/payments";
import { isPaymentMethod, readCallback } from "@/lib/payments";

/**
 * Where a gateway sends the customer back to.
 *
 * Outside `app/[locale]/` on purpose — the same reason `/api/triage` is. It is
 * not a page, and a gateway's stored return URL must never be rewritten to
 * `/ne/api/...` by the locale middleware.
 *
 * What this route is NOT: a place where a payment succeeds. It is a browser
 * arriving with a query string, and the query string is a claim. The route's
 * whole job is to turn "somebody came back" into "ask the gateway", then send
 * the customer to their booking to see the answer.
 *
 * It is safe to hit repeatedly, by anyone, with anything:
 *
 *   - `verifyAndSettle` re-reads the payment and asks the gateway's own
 *     servers; nothing in the URL decides the outcome.
 *   - Settling is guarded on the row's current status, so a refresh, a
 *     duplicate callback and the reconciliation sweep can all race and only
 *     one moves money.
 *   - An unknown reference gets a redirect to /bookings and nothing else.
 *
 * There is no session check here, and that is deliberate: a customer can come
 * back from a bank app in a browser that never had our cookie. The route
 * reveals nothing — it redirects — and the booking page behind it is RLS'd.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function localeFrom(request: Request): Locale {
  const cookie = request.headers
    .get("cookie")
    ?.match(/sajilokaam-locale=([^;]+)/)?.[1];
  return routing.locales.includes(cookie as Locale)
    ? (cookie as Locale)
    : routing.defaultLocale;
}

/** `/bookings/x` in English, `/ne/bookings/x` in Nepali. */
function bookingUrl(request: Request, path: string, query: string) {
  const locale = localeFrom(request);
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return new URL(`${prefix}${path}?${query}`, request.url);
}

async function handle(request: Request, gateway: string) {
  if (!isPaymentMethod(gateway) || gateway === "cash") {
    return NextResponse.redirect(bookingUrl(request, "/bookings", "payment=unknown"));
  }

  const { reference, params } = readCallback(
    gateway,
    new URL(request.url).searchParams,
  );

  if (!reference) {
    return NextResponse.redirect(bookingUrl(request, "/bookings", "payment=unknown"));
  }

  const found = await findPaymentByReference(reference);
  if (!found) {
    return NextResponse.redirect(bookingUrl(request, "/bookings", "payment=unknown"));
  }

  const result = await verifyAndSettle(reference, params);

  // The outcome is a hint for the page's entrance animation and its heading —
  // the page re-reads the payment itself rather than believing this.
  const outcome = result.ok
    ? "paid"
    : result.reason === "stillPending" || result.reason === "verificationUnavailable"
      ? "pending"
      : "failed";

  return NextResponse.redirect(
    bookingUrl(request, `/bookings/${found.bookingId}`, `payment=${outcome}`),
  );
}

export async function GET(
  request: Request,
  { params }: { params: { gateway: string } },
) {
  return handle(request, params.gateway);
}

/**
 * Some gateways POST the return rather than redirecting with a query string.
 * The body is merged into the URL's search params so the reader sees one shape.
 */
export async function POST(
  request: Request,
  { params }: { params: { gateway: string } },
) {
  const url = new URL(request.url);
  try {
    const form = await request.formData();
    // forEach rather than for..of: the tsconfig target predates downlevel
    // iteration of these iterators, and this is not worth moving it for.
    form.forEach((value, key) => {
      if (typeof value === "string") url.searchParams.set(key, value);
    });
  } catch {
    // No body, or not a form. The query string alone still has our `ref`.
  }
  return handle(new Request(url, { headers: request.headers }), params.gateway);
}
