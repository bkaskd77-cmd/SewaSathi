import { aakashGateway } from "./aakash";
import { sparrowGateway } from "./sparrow";
import {
  messageParts,
  toGatewayNumber,
  type SmsGateway,
  type SmsResult,
  type SmsSend,
} from "./gateway";

/**
 * The SMS module's public surface. One adapter per gateway, chosen once.
 *
 * WHY A REGISTRY RATHER THAN A CONSTANT. Switching provider in Nepal is not
 * hypothetical — it is the expected path. Neither Sparrow nor Aakash is
 * contracted yet, deliverability to NTC and Ncell differs between them, and
 * the decision will be made on a delivery rate measured in production rather
 * than on a brochure. So the product has to be able to change gateway with an
 * environment variable and a redeploy, and prove the new one works before the
 * old one is dropped.
 */

export {
  messageParts,
  toGatewayNumber,
  type NationalNumber,
  type SmsFailure,
  type SmsGateway,
  type SmsResult,
  type SmsSend,
} from "./gateway";

/**
 * Sends nothing and says so loudly.
 *
 * The default, and the reason a fresh clone can walk the login flow without
 * any credentials. It reports success, because the alternative — failing when
 * unconfigured — would make every local sign-in look like a gateway outage and
 * teach everybody to ignore that error.
 *
 * IT NEVER PRINTS THE MESSAGE. It is tempting, and it would put one-time codes
 * into Vercel's log for every developer and integration with log access to
 * read. The code is recoverable in development from Supabase's own auth log,
 * which is behind a login, so there is nothing to gain and a standing leak to
 * lose.
 */
function logGateway(): SmsGateway {
  return {
    id: "log",
    isConfigured: () => true,
    async send(message: SmsSend): Promise<SmsResult> {
      const to = toGatewayNumber(message.to);
      console.warn(
        `[sms] no gateway configured — ${
          to ? `${to.slice(0, 4)}…${to.slice(-2)}` : "unparseable number"
        }, ${messageParts(message.text)} part(s), not sent`,
      );
      return { ok: true, reference: null, parts: messageParts(message.text) };
    },
  };
}

const GATEWAYS: Record<string, () => SmsGateway> = {
  sparrow: sparrowGateway,
  aakash: aakashGateway,
  log: logGateway,
};

/**
 * Which gateway carries our messages.
 *
 * `SMS_GATEWAY` names it. An unknown name falls back to `log` with a warning
 * rather than throwing: a typo in a dashboard must not take sign-in down, and
 * `/api/health` reports the active gateway id so the typo is visible on a URL
 * rather than in a stack trace nobody is watching.
 *
 * A NAMED GATEWAY WITH NO CREDENTIALS IS NOT SILENTLY DOWNGRADED. That would
 * be the August failure again in a new costume: the dashboard looks configured
 * and every message quietly goes nowhere. It is returned as it is, so its own
 * `auth` failure surfaces.
 */
export function smsGateway(): SmsGateway {
  const name = process.env.SMS_GATEWAY?.trim().toLowerCase();
  if (!name) return logGateway();

  const make = GATEWAYS[name];
  if (!make) {
    console.warn(`[sms] unknown SMS_GATEWAY "${name}" — nothing will be sent`);
    return logGateway();
  }
  return make();
}

/** Is a real gateway armed? `/api/health` asks; `unknown` is never `ok`. */
export function smsIsLive(): boolean {
  const gateway = smsGateway();
  return gateway.id !== "log" && gateway.isConfigured();
}
