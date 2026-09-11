import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { smsGateway } from "@/lib/sms";

/**
 * Supabase's Send SMS Hook: the one seam where our gateway replaces theirs.
 *
 * WHY A HOOK RATHER THAN OUR OWN OTP. Supabase Auth supports Twilio,
 * MessageBird, Vonage and TextLocal, and no Nepali gateway is among them. The
 * obvious-looking answer is to stop using Supabase's OTP and issue our own —
 * and it is wrong. Issuance is the part that is easy to get subtly,
 * expensively wrong: expiry, single use, attempt counting, constant-time
 * comparison, and minting a session afterwards. Supabase already does all of
 * it. Delivery is the only part that is Nepal-specific.
 *
 * So Supabase keeps generating and verifying the code and calls this endpoint
 * to carry it. Switching gateway stays one environment variable, and none of
 * the session machinery is ours to get wrong.
 *
 * THE CODE NOW PASSES THROUGH OUR SERVER. That is the price, and it is what
 * every rule below exists for:
 *
 *   * THE SIGNATURE IS CHECKED BEFORE ANYTHING ELSE. Unsigned, this is a
 *     public endpoint that sends SMS on demand — somebody else's bill and our
 *     sender ID. Standard Webhooks signing, compared in constant time.
 *   * THE CODE IS NEVER LOGGED, never returned, and never put in an error.
 *     Not on the happy path and not on the failure path, where it is most
 *     tempting.
 *   * A FAILURE IS REPORTED TO SUPABASE, not swallowed. Supabase turns a
 *     non-200 into an error on `signInWithOtp`, which is what reaches
 *     `strandsCustomer()` and puts the honest "sign-in isn't working" card in
 *     front of the customer. Answering 200 on a failed send would mean the
 *     login screen cheerfully asking for a code that was never sent — the
 *     August outage again, with better manners.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Standard Webhooks, which is what Supabase signs hook calls with.
 *
 * The secret arrives base64 after a `v1,whsec_` prefix. The signed payload is
 * `id.timestamp.body`, and the header can carry several space-separated
 * signatures during a rotation, so every one is checked.
 */
function signatureIsValid(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  header: string,
): boolean {
  const key = Buffer.from(secret.replace(/^v1,whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const expectedBytes = Buffer.from(expected);

  return header.split(" ").some((entry) => {
    const offered = Buffer.from(entry.replace(/^v1,/, ""));
    // timingSafeEqual throws on a length mismatch, which is itself a leak of
    // sorts and certainly a 500. Checked first.
    return (
      offered.length === expectedBytes.length &&
      timingSafeEqual(offered, expectedBytes)
    );
  });
}

/** Five minutes, so a captured request cannot be replayed tomorrow. */
const MAX_SKEW_SECONDS = 300;

export async function POST(request: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret) {
    // Refuses rather than sends. An unsigned endpoint that dispatches SMS is
    // somebody else's flood on our bill, and the same rule the payment
    // reconciliation sweep follows when CRON_SECRET is unset.
    return NextResponse.json(
      { error: "hook secret not configured" },
      { status: 503 },
    );
  }

  const body = await request.text();
  const id = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signature = request.headers.get("webhook-signature") ?? "";

  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "unsigned" }, { status: 401 });
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS) {
    return NextResponse.json({ error: "stale" }, { status: 401 });
  }

  if (!signatureIsValid(secret, id, timestamp, body, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payload = JSON.parse(body) as {
    user?: { phone?: string };
    sms?: { otp?: string };
  };

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return NextResponse.json({ error: "incomplete payload" }, { status: 400 });
  }

  const gateway = smsGateway();
  const result = await gateway.send({
    to: phone,
    // Written here rather than in a catalogue: this is read on a lock screen
    // by somebody with the app open in front of them, in either language, so
    // it is short, names us, and leads with the digits. The brand word is the
    // anti-phishing part — a code with no sender is a code for anything.
    text: `${otp} is your SajiloKaam code. सजिलो काम कोड: ${otp}`,
  });

  if (!result.ok) {
    console.error(`[sms] send failed via ${gateway.id} — ${result.detail}`);
    return NextResponse.json(
      { error: { http_code: 502, message: result.detail } },
      { status: 502 },
    );
  }

  /*
   * DELIBERATELY NOT COUNTED HERE. `lib/auth/otp.ts` already counts one
   * against the global SMS budget when it asks Supabase to send, which is the
   * right place — the ceiling has to be checked *before* the money is spent,
   * and this hook runs after that decision is made. Counting again would
   * double every message and halve the ceiling.
   *
   * What is still owed is parts rather than sends: a Devanagari message is
   * UCS-2 and splits at 70 characters, so one sign-in can be two charges and
   * the budget currently calls it one. `messageParts` is the arithmetic; the
   * counter would need to take a weight to use it.
   */
  return NextResponse.json({}, { status: 200 });
}
