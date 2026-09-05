import { NextResponse } from "next/server";

import { BUILD_COMMIT_SHORT } from "@/lib/build-info";
import { hasSupabaseConfig } from "@/lib/env";

/**
 * Can this product actually serve a customer right now?
 *
 * WHY THIS EXISTS. Sign-in broke in production and nothing in the app said so:
 * Supabase's Twilio credentials were placeholders, every OTP failed, and the
 * only signal was a customer-facing sentence — "we couldn't send the code just
 * now" — that by design says nothing about the cause. It was found by a person
 * trying to log in. That is the worst way to find it.
 *
 * The lesson is not "add a try/catch". Every dependency this product has lives
 * in somebody else's dashboard: a Supabase auth toggle, a Twilio credential, a
 * Vercel environment variable. None of them are in our repository, none of
 * them are covered by `npm run verify`, and any of them can be changed by a
 * person who is not looking at this code. So the product needs one URL that
 * answers the question directly, and it needs to be honest about the
 * difference between "I checked" and "I cannot check from here".
 *
 * TWO DEPTHS:
 *
 *   GET /api/health           Public, cheap, sends nothing. Configuration and
 *                             reachability only.
 *
 *   GET /api/health?deep=1    Adds the checks that cost something — including
 *                             actually asking Supabase to send an OTP to
 *                             `SMS_HEALTH_NUMBER`, which is the only way to
 *                             know the gateway credentials are real. Guarded
 *                             by `CRON_SECRET`, because it sends messages and
 *                             an open endpoint that sends messages is a bill.
 *
 * `ok` is false when something a customer would hit is broken. `unknown` is
 * its own state and never counted as healthy — an unverifiable dependency is
 * exactly what caused this.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type State = "ok" | "down" | "unknown" | "skipped";

type Check = {
  name: string;
  state: State;
  /** What was actually determined. Never a secret, never a credential. */
  detail: string;
};

/** Supabase publishes which auth providers are on. Cheap, and no send. */
async function checkAuthConfig(): Promise<Check> {
  if (!hasSupabaseConfig()) {
    return {
      name: "auth.config",
      state: "down",
      detail: "Supabase is not configured — nobody can sign in.",
    };
  }

  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`;
    const response = await fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        name: "auth.config",
        state: "down",
        detail: `Supabase auth answered ${response.status}.`,
      };
    }

    const body = (await response.json()) as {
      external?: Record<string, boolean>;
      disable_signup?: boolean;
    };

    if (!body.external?.phone) {
      return {
        name: "auth.config",
        state: "down",
        detail: "Phone sign-in is disabled. This is the only way in.",
      };
    }
    if (body.disable_signup) {
      return {
        name: "auth.config",
        state: "down",
        detail: "New sign-ups are disabled — a first-time customer cannot get in.",
      };
    }

    return {
      name: "auth.config",
      state: "ok",
      detail: "Phone sign-in enabled, sign-ups allowed.",
    };
  } catch (error) {
    return {
      name: "auth.config",
      state: "unknown",
      detail: `Could not reach Supabase auth: ${(error as Error).message}`,
    };
  }
}

/** Can we read the catalogue? A dead database is a dead product. */
async function checkDatabase(): Promise<Check> {
  if (!hasSupabaseConfig()) {
    return {
      name: "database",
      state: "down",
      detail: "Supabase is not configured — every page is serving seed data.",
    };
  }
  const startedAt = performance.now();
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/categories?select=slug&limit=1`;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const response = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    return response.ok
      ? {
          name: "database",
          state: "ok",
          detail: `Categories readable in ${Math.round(performance.now() - startedAt)}ms.`,
        }
      : {
          name: "database",
          state: "down",
          detail: `REST answered ${response.status}. Pages are falling back to seed data.`,
        };
  } catch (error) {
    return {
      name: "database",
      state: "unknown",
      detail: `Could not reach the database: ${(error as Error).message}`,
    };
  }
}

/**
 * The one that matters, and the one that cannot be faked.
 *
 * Asks Supabase to send a real OTP to a number we own. A misconfigured
 * gateway answers within a second and says so — which is exactly the failure
 * that reached production undetected. Skipped unless a number is set, and
 * reported as `skipped` rather than `ok`, because "we did not look" must never
 * read as "it works".
 */
async function checkSmsDelivery(): Promise<Check> {
  const number = process.env.SMS_HEALTH_NUMBER;
  if (!number) {
    return {
      name: "auth.sms",
      state: "skipped",
      detail:
        "Set SMS_HEALTH_NUMBER to a number you own (ideally a Supabase test number, which costs nothing to send to) and this becomes a real end-to-end check.",
    };
  }
  if (!hasSupabaseConfig()) {
    return { name: "auth.sms", state: "down", detail: "Supabase not configured." };
  }

  try {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/otp`,
      {
        method: "POST",
        headers: { apikey: key, "content-type": "application/json" },
        body: JSON.stringify({ phone: number }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );

    if (response.ok) {
      return {
        name: "auth.sms",
        state: "ok",
        detail: "Supabase accepted an OTP send. The gateway credentials work.",
      };
    }

    // The provider's own wording, which is what actually names the fault —
    // "Error sending confirmation OTP to provider: Authenticate" is a
    // credential problem and says so.
    const body = (await response.json().catch(() => null)) as {
      msg?: string;
      error_description?: string;
    } | null;
    return {
      name: "auth.sms",
      state: "down",
      detail: `${response.status}: ${body?.msg ?? body?.error_description ?? "no message"}`,
    };
  } catch (error) {
    return {
      name: "auth.sms",
      state: "unknown",
      detail: `Could not reach Supabase auth: ${(error as Error).message}`,
    };
  }
}

/**
 * The service role key, and whether it actually works.
 *
 * Not a nice-to-have: `payments`, `notifications` and `provider_contacts` all
 * grant nobody insert or update through RLS, by design, so every write to them
 * goes through the server role. Without this key a professional cannot record
 * a final amount, no payment can settle, and no notification is written — and
 * because `createAdminClient()` throws rather than returning an error, every
 * one of those surfaces as the same generic "that didn't work" on a button.
 *
 * Three of those buttons were reported as separate bugs before the cause was
 * found. That is exactly the class of thing this endpoint exists to name.
 *
 * The key itself is never echoed. Only whether it is present and whether the
 * database accepted it.
 */
async function checkServiceRole(): Promise<Check> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return {
      name: "server.serviceRole",
      state: "down",
      detail:
        "SUPABASE_SERVICE_ROLE_KEY is not set. Final amounts, payments and notifications all fail, each as a generic button error.",
    };
  }
  if (!hasSupabaseConfig()) {
    return { name: "server.serviceRole", state: "down", detail: "Supabase not configured." };
  }

  try {
    // A read no anonymous caller could make: RLS grants `payments` to nobody
    // for insert or update and only to the people involved for select, so a
    // 200 here means the key is genuinely being honoured as the service role.
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/payments?select=id&limit=1`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    return response.ok
      ? {
          name: "server.serviceRole",
          state: "ok",
          detail: "Present, and the database accepts it.",
        }
      : {
          name: "server.serviceRole",
          state: "down",
          detail: `Present but rejected (${response.status}). Wrong project, or a rotated key.`,
        };
  } catch (error) {
    return {
      name: "server.serviceRole",
      state: "unknown",
      detail: `Could not check: ${(error as Error).message}`,
    };
  }
}

/** Triage falls back to the keyword matcher without a key, so this is a warning. */
function checkTriage(): Check {
  return process.env.ANTHROPIC_API_KEY
    ? { name: "triage", state: "ok", detail: "Claude key present." }
    : {
        name: "triage",
        state: "unknown",
        detail:
          "No ANTHROPIC_API_KEY. Triage still answers — the keyword matcher covers it — but every answer is the fallback.",
      };
}

/**
 * WHERE IS THIS FUNCTION RUNNING, AND HOW FAR IS THE DATABASE?
 *
 * The single largest performance fault this product has had was not in the
 * code: functions defaulted to `iad1` (Washington DC) while Supabase sits in
 * `ap-southeast-1` (Singapore). Every query crossed the Pacific — about 250ms
 * — and a signed-in page makes a dozen of them. The app felt broken with
 * almost no data in it, because the cost was distance and distance does not
 * care how many rows there are.
 *
 * `vercel.json` pins the region now, and this check is how anybody confirms it
 * actually applied — from a browser, with no checkout, no Node and no
 * terminal. A setting that silently fails to apply is exactly the class of
 * fault this endpoint exists for: it lives in somebody else's dashboard and
 * nothing in `npm run verify` can see it.
 *
 * The round trip is measured rather than assumed, because the region name
 * being right is not proof — it is the milliseconds that customers feel.
 */
const EXPECTED_REGION = "sin1";
/** Same region as the database should be single-digit or low-double-digit ms. */
const CLOSE_ENOUGH_MS = 80;

async function checkRegion(): Promise<Check> {
  const region = process.env.VERCEL_REGION;

  if (!region) {
    return {
      name: "server.region",
      state: "unknown",
      detail:
        "Not running on Vercel, so there is no region to check. Locally this is expected.",
    };
  }

  if (!hasSupabaseConfig()) {
    return {
      name: "server.region",
      state: "unknown",
      detail: `Running in ${region}, but Supabase is unconfigured so the distance cannot be measured.`,
    };
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/categories?select=slug&limit=1`;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const samples: number[] = [];

  try {
    // Three, and the median: the first call after a cold start pays for the
    // TLS handshake and would libel a perfectly good region.
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      await fetch(url, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      samples.push(performance.now() - started);
    }
  } catch (error) {
    return {
      name: "server.region",
      state: "unknown",
      detail: `Running in ${region}; could not measure the database: ${(error as Error).message}`,
    };
  }

  const median = Math.round(samples.sort((a, b) => a - b)[1]);
  const where = region === EXPECTED_REGION ? region : `${region} (expected ${EXPECTED_REGION})`;

  if (median <= CLOSE_ENOUGH_MS) {
    return {
      name: "server.region",
      state: "ok",
      detail: `${where} — database round trip ${median}ms.`,
    };
  }

  return {
    name: "server.region",
    state: "down",
    detail:
      `${where} — database round trip ${median}ms, which is a continent away. ` +
      `Every page makes several of these. Check "regions" in vercel.json and ` +
      `redeploy; a region change needs a new deployment to take effect.`,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wantsDeep = url.searchParams.get("deep") === "1";

  const secret = process.env.CRON_SECRET;
  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const deepAllowed = wantsDeep && Boolean(secret) && offered === secret;

  if (wantsDeep && !deepAllowed) {
    return NextResponse.json(
      { error: "unauthorized", hint: "deep=1 needs the CRON_SECRET bearer token" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const checks: Check[] = [
    ...(await Promise.all([
      checkAuthConfig(),
      checkDatabase(),
      checkServiceRole(),
      checkRegion(),
    ])),
    checkTriage(),
  ];

  if (deepAllowed) checks.push(await checkSmsDelivery());

  // `unknown` is not healthy. The whole point of this endpoint is that an
  // unverifiable dependency is what broke sign-in in the first place.
  const ok = checks.every((check) => check.state === "ok" || check.state === "skipped");

  return NextResponse.json(
    { ok, commit: BUILD_COMMIT_SHORT, deep: deepAllowed, checks },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store", "cdn-cache-control": "no-store" },
    },
  );
}
