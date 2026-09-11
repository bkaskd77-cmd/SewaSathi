/**
 * One SMS gateway, behind one typed interface.
 *
 * SHAPED FOR NEPAL, NOT FOR TWILIO. Every detail below is a Nepali gateway's
 * convention, and each one is a place a Twilio-shaped adapter would have been
 * quietly wrong:
 *
 *   * THE RECIPIENT IS TEN NATIONAL DIGITS, never E.164. Sparrow's `to` and
 *     Aakash's `to` both want `9843119897`. Supabase hands us
 *     `+9779843119897`. A `+977` that survives into the request is a message
 *     that is accepted and never arrives, which is the single worst failure
 *     this file can have: the gateway says 200 and the customer waits.
 *   * THE BODY IS FORM-ENCODED, not JSON. Both gateways read POST fields.
 *   * AUTH IS A BARE TOKEN IN THE BODY, not a header and not basic auth.
 *   * THE SENDER IS AN ACCOUNT PROPERTY. Sparrow calls it `from` (an
 *     "identity" they issue); Aakash binds it to the token and takes no `from`
 *     at all. It is never a phone number we own, because in Nepal it is a
 *     registered alphanumeric sender ID.
 *   * "ACCEPTED" IS NOT "DELIVERED". A 200 with `response_code: 200` means
 *     queued. Neither gateway tells us in that response whether a handset ever
 *     saw it, so nothing in this product may report delivery from a send.
 *
 * THE TRADE THAT MADE THIS A MODULE. Supabase Auth still generates, stores and
 * verifies the code — we are replacing delivery only, through Supabase's Send
 * SMS Hook. Hand-rolling OTP issuance would mean re-implementing expiry,
 * single-use, attempt-counting and session minting, all of which Supabase
 * already does correctly, to gain nothing. So the hook is the seam: Supabase
 * calls us with a phone and a code, and this decides which gateway carries it.
 *
 * WHICH MEANS THE CODE PASSES THROUGH OUR SERVER, and that is the one new
 * risk. It is never logged, never put in an error, and never returned — see
 * `SmsResult`, which carries a provider reference and nothing else.
 */

/** Ten national digits. The only shape a Nepali gateway accepts. */
export type NationalNumber = string;

export type SmsSend = {
  /** E.164 as Supabase stores it. Reduced to national digits by the adapter. */
  to: string;
  text: string;
};

export type SmsFailure =
  /** The token is wrong, absent, or the account is out of credit. */
  | "auth"
  /** The gateway will not accept this number — bad shape, or barred. */
  | "recipient"
  /** We are being throttled, or the account's ceiling is reached. */
  | "throttled"
  /** Reached the gateway and it refused for a reason we do not model. */
  | "refused"
  /** Never reached the gateway: DNS, TLS, timeout, or an IP block. */
  | "unreachable";

export type SmsResult =
  | {
      ok: true;
      /** The gateway's own id for this send, for a support conversation. */
      reference: string | null;
      /** How many messages it charged us for. A long text is several. */
      parts: number;
    }
  | {
      ok: false;
      failure: SmsFailure;
      /**
       * The gateway's own wording, for the health endpoint and the dev badge.
       *
       * NEVER THE MESSAGE BODY AND NEVER THE CODE. Some gateways echo the text
       * back in an error, so adapters must extract the reason and discard the
       * rest rather than passing a response through.
       */
      detail: string;
    };

export type SmsGateway = {
  /** Stable id: "sparrow", "aakash", "log". Written to the health endpoint. */
  readonly id: string;
  /** False when credentials are missing, so nothing pretends to be armed. */
  isConfigured(): boolean;
  send(message: SmsSend): Promise<SmsResult>;
};

/**
 * E.164, or anything a human typed, reduced to the ten digits a gateway wants.
 *
 * Deliberately its own exported function with its own tests. It is two lines
 * and it is the single highest-consequence transformation in the module: get
 * it wrong and every message is accepted and none is delivered, with no error
 * anywhere to find. Returns null rather than a best guess, because sending to
 * a number we could not parse is worse than not sending.
 */
export function toGatewayNumber(e164: string): NationalNumber | null {
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith("977") ? digits.slice(3) : digits;
  // NTC and Ncell mobiles are ten digits beginning 97 or 98. A landline
  // cannot receive SMS, so refusing here saves a message we would be charged
  // for and an error nobody would understand.
  return /^9[78]\d{8}$/.test(national) ? national : null;
}

/**
 * Concatenation arithmetic, so a cost estimate is not a guess.
 *
 * GSM-7 fits 160 characters in one message and 153 per part once a message is
 * split. Any character outside the GSM alphabet — every Devanagari letter —
 * forces UCS-2, which is 70 and 67. That is not a rounding difference: the
 * same sentence costs twice as much in Nepali, and `SMS_BUDGET.rupeesPerMessage`
 * counts messages rather than sends because of it.
 */
export function messageParts(text: string): number {
  // Any character outside 7-bit ASCII is treated as forcing UCS-2. A handful
  // of accented Latin letters are technically reachable through GSM-7's escape
  // table, but assuming they are not errs towards over-estimating the bill,
  // which is the only direction a cost estimate is allowed to be wrong in.
  let unicode = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 127) {
      unicode = true;
      break;
    }
  }

  const single = unicode ? 70 : 160;
  const perPart = unicode ? 67 : 153;
  // UTF-16 code units, which is what a UCS-2 message is counted in — and the
  // same number as characters for both ASCII and Devanagari, which sit in the
  // basic plane. An emoji would count as two, and correctly so.
  const length = text.length;

  if (length <= single) return 1;
  return Math.ceil(length / perPart);
}
