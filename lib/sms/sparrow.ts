import {
  messageParts,
  toGatewayNumber,
  type SmsFailure,
  type SmsGateway,
  type SmsResult,
  type SmsSend,
} from "./gateway";

/**
 * Sparrow SMS.
 *
 * POST https://api.sparrowsms.com/v2/sms/ — form-encoded, with `token`,
 * `from` (the identity they issue), `to` (comma-separated national numbers)
 * and `text`. The reply is JSON: `{ count, response_code, response }`, where
 * `response_code` 200 means queued.
 *
 * HTTPS, not the HTTP the documentation still shows in places. A one-time
 * code in a query string over plain HTTP is a code anybody on the path can
 * read, and there is no version of that which is acceptable for the only way
 * into this product.
 *
 * THE IP ALLOWLIST IS THE DEPLOYMENT RISK, not the code. `response_code` 1001
 * is "invalid IP": Sparrow pins an account to addresses you register, and
 * Vercel's serverless egress addresses are not fixed and not published as a
 * stable list. So this adapter can be perfectly correct and still fail in
 * production for a reason nothing here can see. It is called out in
 * ARCHITECTURE.md, and `unreachable` is reported distinctly from `refused` so
 * the health endpoint can say which happened.
 */

const ENDPOINT = "https://api.sparrowsms.com/v2/sms/";
const TIMEOUT_MS = 10_000;

/**
 * Their numeric codes, mapped to our five.
 *
 * Anything unlisted becomes `refused` rather than being guessed at: a wrong
 * guess here shows a customer the wrong sentence, and `refused` is the one
 * that says "we do not know" without claiming the fault is theirs.
 */
function classify(code: number): SmsFailure {
  switch (code) {
    case 1002: // invalid token
    case 1007: // no credit
      return "auth";
    case 1001: // the source IP is not on their allowlist
      return "unreachable";
    case 1000: // a required field is missing
    case 1005: // invalid receiver
    case 1010: // invalid receiver format
      return "recipient";
    case 1011: // too many requests
      return "throttled";
    default:
      return "refused";
  }
}

export function sparrowGateway(): SmsGateway {
  return {
    id: "sparrow",

    isConfigured() {
      return Boolean(process.env.SPARROW_SMS_TOKEN && process.env.SPARROW_SMS_FROM);
    },

    async send(message: SmsSend): Promise<SmsResult> {
      const token = process.env.SPARROW_SMS_TOKEN;
      const from = process.env.SPARROW_SMS_FROM;
      if (!token || !from) {
        return { ok: false, failure: "auth", detail: "no Sparrow credentials" };
      }

      const to = toGatewayNumber(message.to);
      if (!to) {
        // Refused before it costs anything. A landline or a mistyped number
        // would be accepted and billed by some gateways.
        return { ok: false, failure: "recipient", detail: "not a Nepali mobile" };
      }

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, from, to, text: message.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });

        const body = (await response.json().catch(() => null)) as {
          count?: number;
          response_code?: number;
          response?: string;
        } | null;

        if (response.ok && body?.response_code === 200) {
          return {
            ok: true,
            // Sparrow's send reply carries a count, not a message id. Claiming
            // a reference we do not have would make a support conversation
            // worse, not better.
            reference: null,
            parts: body.count ?? messageParts(message.text),
          };
        }

        const code = body?.response_code ?? response.status;
        return {
          ok: false,
          failure: classify(code),
          // Their `response` field, never the request. Some gateways echo the
          // text back on an error and the text contains the code.
          detail: `sparrow ${code}: ${body?.response ?? "no message"}`,
        };
      } catch (thrown) {
        // A timeout is genuinely unknown: the message may well have been sent.
        // Never retried automatically for that reason — a retry on a timeout
        // is how somebody gets two codes and neither works.
        return {
          ok: false,
          failure: "unreachable",
          detail: `sparrow unreachable: ${(thrown as Error).message}`,
        };
      }
    },
  };
}
