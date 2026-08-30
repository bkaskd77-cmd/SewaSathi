import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  InitiateInput,
  InitiateResult,
  PaymentGateway,
  RefundInput,
  RefundResult,
  VerifyInput,
  VerifyResult,
} from "./gateway";

/**
 * eSewa ePay v2.
 *
 * The only file that knows anything about eSewa. Swapping it out means
 * reimplementing `PaymentGateway` here and changing nothing else.
 *
 * ePay v2 is a signed form POST rather than a redirect: we build a form whose
 * fields include an HMAC-SHA256 signature over a fixed, ordered subset of
 * them, the browser posts it to eSewa, and the customer comes back to our
 * success or failure URL.
 *
 * The signature is over `total_amount,transaction_uuid,product_code` in that
 * exact order — the order is part of the contract, not a detail — and the
 * result is base64. Getting the order wrong produces a signature eSewa
 * rejects with a message that does not say why.
 *
 * WHAT THE RETURN URL IS WORTH: nothing. eSewa appends a base64 payload to it,
 * and that payload is signed, but it arrives through a browser we do not
 * control. `verify()` therefore ignores the outcome in it and asks eSewa's
 * status endpoint directly. The callback is only used to learn *which*
 * transaction to ask about — and we already know that from our own reference.
 */

const SANDBOX = {
  form: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
  status: "https://rc.esewa.com.np/api/epay/transaction/status/",
} as const;

const LIVE = {
  form: "https://epay.esewa.com.np/api/epay/main/v2/form",
  status: "https://epay.esewa.com.np/api/epay/transaction/status/",
} as const;

/** The fields the signature covers, in the order eSewa hashes them. */
const SIGNED_FIELDS = [
  "total_amount",
  "transaction_uuid",
  "product_code",
] as const;

function config() {
  return {
    productCode: process.env.ESEWA_PRODUCT_CODE ?? "",
    secret: process.env.ESEWA_SECRET_KEY ?? "",
    live: process.env.ESEWA_ENV === "live",
  };
}

function endpoints() {
  return config().live ? LIVE : SANDBOX;
}

/**
 * `total_amount=100,transaction_uuid=abc,product_code=EPAYTEST` -> base64 HMAC.
 *
 * Exported because the contract test signs a payload and the verifier checks
 * it; keeping one implementation means the test cannot pass against a second,
 * subtly different one.
 */
export function esewaSignature(
  values: Record<string, string>,
  secret: string,
): string {
  const message = SIGNED_FIELDS.map((field) => `${field}=${values[field]}`).join(
    ",",
  );
  return createHmac("sha256", secret).update(message).digest("base64");
}

/** Constant-time compare, so a signature check cannot be timed character by character. */
export function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a ?? "", "utf8");
  const right = Buffer.from(b ?? "", "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const esewa: PaymentGateway = {
  method: "esewa",

  isConfigured() {
    const { productCode, secret } = config();
    return Boolean(productCode && secret);
  },

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const { productCode, secret } = config();
    if (!productCode || !secret) {
      return { ok: false, reason: "notConfigured" };
    }

    // eSewa wants the amount as a plain string and insists the components sum
    // to total_amount. We charge no separate tax or delivery, so the whole
    // figure is the amount and the rest are zeroes — but they must be present.
    const amount = String(input.amount);
    const fields: Record<string, string> = {
      amount,
      tax_amount: "0",
      total_amount: amount,
      transaction_uuid: input.reference,
      product_code: productCode,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      signed_field_names: SIGNED_FIELDS.join(","),
    };
    fields.signature = esewaSignature(fields, secret);

    return {
      ok: true,
      kind: "form",
      url: endpoints().form,
      fields,
      providerTxnId: null,
      raw: { fields: { ...fields, signature: "[redacted]" } },
    };
  },

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const { productCode } = config();
    if (!productCode) return { ok: false, reason: "notConfigured" };

    const url = new URL(endpoints().status);
    url.searchParams.set("product_code", productCode);
    url.searchParams.set("total_amount", String(input.expectedAmount));
    url.searchParams.set("transaction_uuid", input.reference);

    let raw: unknown;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        // Nepali mobile data is slow; a hung verify must still return an
        // answer the reconciliation sweep can act on rather than hanging a
        // request thread.
        signal: AbortSignal.timeout(15_000),
      });
      raw = await response.json().catch(() => null);
      if (!response.ok) {
        return { ok: false, reason: `status ${response.status}`, raw };
      }
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }

    const body = raw as {
      status?: string;
      ref_id?: string;
      total_amount?: number | string;
    } | null;

    if (!body?.status) return { ok: false, reason: "unreadableResponse", raw };

    if (body.status === "COMPLETE") {
      return {
        ok: true,
        status: "paid",
        providerTxnId: String(body.ref_id ?? input.reference),
        // Reconciled by the caller against our own record. eSewa returns this
        // as a number or a string depending on the endpoint.
        amount: Math.round(Number(body.total_amount ?? 0)),
        raw,
      };
    }

    if (body.status === "PENDING" || body.status === "AMBIGUOUS") {
      return { ok: true, status: "pending", reason: body.status, raw };
    }

    // CANCELED, NOT_FOUND, FULL_REFUND, PARTIAL_REFUND — none of which is a
    // payment we may settle.
    return { ok: true, status: "failed", reason: body.status, raw };
  },

  async refund(_input: RefundInput): Promise<RefundResult> {
    /*
     * eSewa has no merchant-initiated refund API on ePay v2 — refunds are
     * raised through their merchant dashboard.
     *
     * Returning a clear "not supported" rather than throwing is deliberate:
     * the refund record is still created and sits in `requested`, so the
     * customer sees that we have their request and support has a queue to
     * work. Pretending the call succeeded would be worse than admitting it
     * needs a human.
     */
    return { ok: false, reason: "manualRefundRequired" };
  },
};
