import {
  messageParts,
  toGatewayNumber,
  type SmsFailure,
  type SmsGateway,
  type SmsResult,
  type SmsSend,
} from "./gateway";

/**
 * Aakash SMS.
 *
 * POST https://sms.aakashsms.com/sms/v3/send — form-encoded, with
 * `auth_token`, `to` (comma-separated national numbers) and `text`.
 *
 * NO `from`. The sender ID is bound to the token on their side, which is the
 * one structural difference from Sparrow and the reason `SmsGateway` has no
 * sender in its interface: a field only one implementation uses does not
 * belong in the contract, it belongs in that implementation's environment.
 *
 * The reply is JSON with an `error` boolean and a `message`. It is read
 * defensively rather than trusted: a gateway that answers 200 with an error
 * body is common enough in this market that treating the HTTP status as the
 * answer would report failures as successes.
 */

const ENDPOINT = "https://sms.aakashsms.com/sms/v3/send";
const TIMEOUT_MS = 10_000;

/**
 * Aakash reports faults as a message rather than a stable numeric code, so
 * this matches on wording — which is fragile, and is why anything unmatched
 * becomes `refused` rather than a guess. If they publish codes, this becomes a
 * switch like Sparrow's and gets better; until then a wrong guess would show a
 * customer the wrong sentence, and `refused` is the honest "we do not know".
 */
function classify(status: number, message: string): SmsFailure {
  const text = message.toLowerCase();
  if (status === 401 || status === 403) return "auth";
  if (text.includes("token") || text.includes("credit") || text.includes("balance")) {
    return "auth";
  }
  if (text.includes("number") || text.includes("mobile") || text.includes("recipient")) {
    return "recipient";
  }
  if (status === 429 || text.includes("limit") || text.includes("too many")) {
    return "throttled";
  }
  return "refused";
}

export function aakashGateway(): SmsGateway {
  return {
    id: "aakash",

    isConfigured() {
      return Boolean(process.env.AAKASH_SMS_TOKEN);
    },

    async send(message: SmsSend): Promise<SmsResult> {
      const token = process.env.AAKASH_SMS_TOKEN;
      if (!token) {
        return { ok: false, failure: "auth", detail: "no Aakash credentials" };
      }

      const to = toGatewayNumber(message.to);
      if (!to) {
        return { ok: false, failure: "recipient", detail: "not a Nepali mobile" };
      }

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            auth_token: token,
            to,
            text: message.text,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });

        const body = (await response.json().catch(() => null)) as {
          error?: boolean;
          message?: string;
          data?: { id?: string | number } | null;
        } | null;

        // Both halves, deliberately. A 200 carrying `error: true` is a failure
        // however encouraging the status line is.
        if (response.ok && body && body.error !== true) {
          const id = body.data?.id;
          return {
            ok: true,
            reference: id === undefined || id === null ? null : String(id),
            parts: messageParts(message.text),
          };
        }

        const detail = body?.message ?? `http ${response.status}`;
        return {
          ok: false,
          failure: classify(response.status, detail),
          detail: `aakash: ${detail}`,
        };
      } catch (thrown) {
        return {
          ok: false,
          failure: "unreachable",
          detail: `aakash unreachable: ${(thrown as Error).message}`,
        };
      }
    },
  };
}
