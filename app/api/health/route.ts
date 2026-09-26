import "server-only";

import { NextResponse } from "next/server";

import { BUILD_COMMIT_SHORT } from "@/lib/build-info";
import { hasSupabaseConfig } from "@/lib/env";
import { SMS_BUDGET, smsBudgetAlert } from "@/lib/abuse";
import { rateLimitStore, readGlobalSms } from "@/lib/server/rate-limit";
import { smsGateway } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";
import { STEP_UP_HOURS } from "@/lib/auth/admin-gate";
import FINGERPRINTS from "@/supabase/function-fingerprints.json";

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
 * Does production hold the functions this build shipped?
 *
 * THE AXIS NOTHING LOCAL CAN SEE. `check:migrations` polices the tree against
 * itself and the column manifest polices the code against the tree, both in
 * `npm run verify`. Neither can tell whether the LIVE database matches, because
 * migrations are applied through an MCP connection from a sandbox whose egress
 * policy blocks the database over HTTPS. A function applied but never
 * committed, or edited in a dashboard, is invisible to every check that runs
 * before a deploy.
 *
 * So it is checked from where it can be — the same reasoning as `server.region`
 * and the SMS gateway. A fault that lives in somebody else's dashboard needs a
 * URL, not a test.
 *
 * `unknown` when it cannot look, never `ok`. That confusion is what let a
 * broken SMS gateway run for a day.
 */
async function checkFunctions(): Promise<Check> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabaseConfig() || !key) {
    return {
      name: "db.functions",
      state: "unknown",
      detail: "No service role key, so the live definitions cannot be read.",
    };
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/function_fingerprints`,
      {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return {
        name: "db.functions",
        state: "unknown",
        detail: `function_fingerprints answered ${response.status}.`,
      };
    }

    const live = (await response.json()) as Array<{ name: string; sha: string }>;
    const expected = FINGERPRINTS as Record<string, { sha: string; file: string }>;
    const liveBy = new Map(live.map((row) => [row.name, row.sha]));

    const drifted: string[] = [];
    const missing: string[] = [];
    for (const [name, { sha }] of Object.entries(expected)) {
      const actual = liveBy.get(name);
      if (actual === undefined) missing.push(name);
      else if (actual !== sha) drifted.push(name);
    }

    if (missing.length || drifted.length) {
      return {
        name: "db.functions",
        state: "down",
        detail:
          [
            drifted.length
              ? `${drifted.length} differ from this build (${drifted.slice(0, 4).join(", ")})`
              : null,
            missing.length
              ? `${missing.length} missing (${missing.slice(0, 4).join(", ")})`
              : null,
          ]
            .filter(Boolean)
            .join("; ") +
          ". Something was applied or edited outside supabase/migrations.",
      };
    }

    return {
      name: "db.functions",
      state: "ok",
      detail: `All ${Object.keys(expected).length} match supabase/migrations.`,
    };
  } catch (error) {
    return {
      name: "db.functions",
      state: "unknown",
      detail: `Could not read the live definitions: ${(error as Error).message}`,
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

/**
 * Is the rate limiter counting somewhere both instances can see?
 *
 * In-process counters are per serverless instance, so a burst spread across
 * instances gets a multiple of every ceiling and a cold start resets them. As
 * a soft cost ceiling that is honest; as a control it is not, and the
 * difference is invisible from the outside — which is exactly what this
 * endpoint exists to make visible.
 */
function checkRateLimiter(): Check {
  return rateLimitStore() === "shared"
    ? {
        name: "rateLimit",
        state: "ok",
        detail: "Shared store — the ceilings hold across instances.",
      }
    : {
        name: "rateLimit",
        state: "unknown",
        detail:
          "In-process counters. Each serverless instance enforces its own ceiling, so the real limit is a multiple of the configured one. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      };
}

/**
 * What the platform has spent on SMS, before the invoice says so.
 *
 * A ceiling that is hit silently is an outage nobody has been told about:
 * every customer trying to sign in meets a wall while the team finds out from
 * a dashboard they are not looking at. This is the line that arrives first,
 * and it is on a URL so it needs no checkout to read.
 *
 * Reads the counters rather than spending one, so polling this endpoint can
 * never itself exhaust the budget it is reporting on.
 */
async function checkSmsBudget(): Promise<Check> {
  const spend = await readGlobalSms();
  const alert = smsBudgetAlert({
    globalLastHour: spend.lastHour,
    globalToday: spend.today,
  });

  const usage = `${spend.lastHour} this hour of ${SMS_BUDGET.perHourGlobal}, ${spend.today} today of ${SMS_BUDGET.perDayGlobal}`;

  if (alert) {
    return {
      name: "sms.budget",
      // A ceiling is a real outage for anybody trying to sign in; a warning is
      // not yet, but it is not "ok" either — unknown is never ok, and neither
      // is "on the way to a wall".
      state: alert.level === "ceiling" ? "down" : "unknown",
      detail: `${alert.level === "ceiling" ? "At the ceiling" : "Past the warning mark"} — ${usage}, about Rs ${alert.estimatedRupees}.`,
    };
  }

  if (!spend.shared) {
    return {
      name: "sms.budget",
      state: "unknown",
      detail: `Counting in-process only, so this is one instance's share rather than the platform's. ${usage}. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.`,
    };
  }

  return { name: "sms.budget", state: "ok", detail: `${usage}.` };
}

/**
 * Session lifetime — named here because it cannot be measured here.
 *
 * THE SETTING LIVES IN SOMEBODY ELSE'S DASHBOARD, which is the category of
 * dependency that broke sign-in for a day: a Supabase toggle, changed by
 * somebody not looking at this code, invisible to `npm run verify`. JWT expiry
 * and refresh-token rotation are exactly that, and reading them needs a
 * management token this product deliberately does not hold.
 *
 * SO THIS IS A SIGNPOST AND IT SAYS SO. `unknown`, never `ok` — not looking
 * must not read as working, and reporting a number nobody verified would be
 * worse than reporting none. The observable half lives on
 * `/account/security?debug=auth`, which prints `exp - iat` from a real token:
 * per session, but the same number the dashboard holds.
 *
 * What this line buys is that the dimension is on the page at all. Before it,
 * nothing anywhere in the product mentioned that session lifetime was a
 * setting, so nobody could notice it had never been chosen.
 */
function checkSessionConfig(): Check {
  return {
    name: "session.config",
    state: "unknown",
    detail:
      `Admin step-up re-challenges every ${STEP_UP_HOURS}h and that number is ours ` +
      `(lib/auth/step-up.ts). The JWT expiry and refresh-token rotation behind it ` +
      `are Supabase dashboard settings and cannot be read from here without a ` +
      `management token. Observe this session's actual token lifetime at ` +
      `/account/security?debug=auth.`,
  };
}

/**
 * Which gateway would carry a code, and is it armed?
 *
 * SEPARATE FROM `auth.sms`, which sends one and is the only proof of delivery.
 * This is the cheap half: it says what is configured without spending
 * anything, so the answer to "did the switch to Sparrow actually take?" is a
 * URL rather than a support ticket. `log` is never `ok` — it is the state
 * where every sign-in silently goes nowhere, which is precisely the failure
 * this endpoint exists to make visible.
 */
function checkSmsGateway(): Check {
  const gateway = smsGateway();

  if (gateway.id === "log") {
    return {
      name: "sms.gateway",
      state: "unknown",
      detail:
        "No SMS_GATEWAY set, so nothing is sent and Supabase's own provider carries the code. Set SMS_GATEWAY to sparrow or aakash once a contract exists.",
    };
  }
  if (!gateway.isConfigured()) {
    return {
      name: "sms.gateway",
      state: "down",
      detail: `SMS_GATEWAY is "${gateway.id}" but its credentials are missing. Every code fails.`,
    };
  }
  return {
    name: "sms.gateway",
    state: "ok",
    detail: `${gateway.id}, credentials present. Delivery is only proved by deep=1.`,
  };
}

/**
 * Is there a key, and has anything proved it works?
 *
 * "PRESENT" IS NOT "WORKING", AND THIS LINE USED TO SAY OTHERWISE. It read
 * `Boolean(process.env.ANTHROPIC_API_KEY)` and reported `Claude key present.` —
 * so a key that is mistyped, revoked or out of credit came back green while
 * every single triage was answered by the keyword matcher. That is the exact
 * shape of the failure that took sign-in down for a day: a dependency in
 * somebody else's dashboard, a check that looked at the wrong thing, and a
 * product that kept answering so nobody noticed.
 *
 * The state stays `ok` rather than becoming `unknown`, and that is deliberate
 * rather than a dodge. `ok` here is computed across every check to decide a 200
 * or a 503, so `unknown` would take the whole endpoint down for a product that
 * serves customers perfectly well without a key. `sms.gateway` already solved
 * this the same way: report `ok`, and name in the detail what is still unproven
 * and which call would prove it.
 */
function checkTriage(): Check {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "triage",
      state: "unknown",
      detail:
        "No ANTHROPIC_API_KEY. Triage still answers — the keyword matcher covers it — but every answer is the fallback.",
    };
  }
  return {
    name: "triage",
    state: "ok",
    detail:
      "ANTHROPIC_API_KEY present. Present is not working: a revoked, mistyped " +
      "or out-of-credit key looks exactly like this and every answer is still " +
      "the keyword matcher. Only deep=1 asks the model.",
  };
}

/**
 * Ask the model one real question, which is the only proof a key works.
 *
 * BEHIND deep=1 BECAUSE IT COSTS MONEY, exactly like the OTP send. One token
 * out, one token back, no prompt caching to disturb — a fraction of a cent per
 * run, and the only thing in this product that can tell a good key from a bad
 * one before a customer does.
 *
 * A REFUSAL IS REPORTED IN THE PROVIDER'S OWN WORDS. The MFA bug cost three
 * deploys because two separate catches each discarded the sentence Anthropic had
 * been returning the whole time; the fix is to pass it through, and this is a
 * private endpoint behind a secret so there is no reason not to.
 */
async function checkTriageModel(): Promise<Check> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "triage.model",
      state: "skipped",
      detail: "No ANTHROPIC_API_KEY to test.",
    };
  }
  try {
    const { getAnthropic, TRIAGE_MODEL } = await import("@/lib/ai");
    const started = Date.now();
    await getAnthropic().messages.create(
      {
        model: TRIAGE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      },
      { timeout: 10_000, maxRetries: 0 },
    );
    return {
      name: "triage.model",
      state: "ok",
      detail: `${TRIAGE_MODEL} answered in ${Date.now() - started}ms. The key works.`,
    };
  } catch (error) {
    /*
     * `classifyProviderError` rather than a second opinion written here. It is
     * the same function the triage route uses to decide what a failure was, so
     * this line and the reason written onto every `triage_logs` row cannot
     * disagree about whether a key was refused or a model merely blipped.
     */
    const { classifyProviderError } = await import("@/lib/ai/reason");
    const reason = classifyProviderError(error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "triage.model",
      // A rejected key is down: it will not fix itself and every triage is the
      // fallback until somebody rotates it. A blip or a throttle is not.
      state: reason === "auth-rejected" ? "down" : "unknown",
      detail: `${reason} — ${message}`,
    };
  }
}

/**
 * Is the key set and the matcher answering anyway?
 *
 * THE FAULT NO CONFIGURATION CHECK CAN SEE. Everything above asks whether a key
 * exists and whether it worked one second ago. This asks what actually happened
 * to real customers in the last hour, which is the only question that catches a
 * key that works for a health probe and fails under load, a model that has
 * started refusing our prompt, or a schema of ours that rejects every reply.
 *
 * Cheap: one counted read on the partial index `triage_logs` carries for exactly
 * this. `unknown` rather than `down` when it fires — the product answered every
 * one of those people, which is the whole design, so nothing is broken for a
 * customer and a 503 would be a lie.
 */
async function checkTriageFallback(): Promise<Check> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "triage.fallback",
      state: "skipped",
      detail: "No key, so every fallback is expected.",
    };
  }
  if (!hasSupabaseConfig()) {
    return {
      name: "triage.fallback",
      state: "unknown",
      detail: "Supabase not configured, so the triage log cannot be read.",
    };
  }
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();
    const [{ count: fell }, { count: all }] = await Promise.all([
      admin
        .from("triage_logs")
        .select("id", { count: "exact", head: true })
        .eq("source", "fallback")
        .gte("created_at", since),
      admin
        .from("triage_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);
    if (!all) {
      return {
        name: "triage.fallback",
        state: "ok",
        detail: "No triage in the last hour, so nothing fell back.",
      };
    }
    if (!fell) {
      return {
        name: "triage.fallback",
        state: "ok",
        detail: `0 of ${all} in the last hour fell back to the keyword matcher.`,
      };
    }
    return {
      name: "triage.fallback",
      state: "unknown",
      detail:
        `${fell} of ${all} triages in the last hour were answered by the ` +
        `keyword matcher despite a key being set. Customers all got an answer. ` +
        `/admin/triage-accuracy says which cause.`,
    };
  } catch (error) {
    return {
      name: "triage.fallback",
      state: "unknown",
      detail: `Could not read the triage log: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
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
    checkSessionConfig(),
    ...(await Promise.all([
      checkAuthConfig(),
      checkDatabase(),
      checkServiceRole(),
      checkRegion(),
      checkFunctions(),
    ])),
    checkTriage(),
    await checkTriageFallback(),
    checkSmsGateway(),
    checkRateLimiter(),
    await checkSmsBudget(),
  ];

  if (deepAllowed) {
    checks.push(...(await Promise.all([checkSmsDelivery(), checkTriageModel()])));
  }

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
