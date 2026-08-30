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
 * Khalti KPG-2.
 *
 * The only file that knows anything about Khalti.
 *
 * Unlike eSewa, initiation is a server-to-server call: we POST the order and
 * Khalti returns a `payment_url` to send the browser to, plus a `pidx` that
 * identifies the attempt. That is a better shape — the secret never goes near
 * the browser, and we have their id before the customer leaves.
 *
 * AMOUNTS ARE IN PAISA. Khalti's API is denominated in paisa, not rupees, so
 * every amount crossing this boundary is multiplied or divided by 100 here and
 * nowhere else. Getting this wrong charges someone a hundred times too much or
 * too little, and it is exactly the sort of unit mismatch that survives review
 * because both numbers look plausible.
 *
 * The return URL carries `pidx`, `status` and `transaction_id`. The status in
 * it is a claim from a browser we do not control, so `verify()` ignores it and
 * calls Khalti's lookup endpoint with the pidx instead.
 */

const SANDBOX = "https://dev.khalti.com/api/v2";
const LIVE = "https://khalti.com/api/v2";

/** Rupees to paisa, at the single point where the unit changes. */
function toPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Paisa back to rupees. */
function toRupees(paisa: number): number {
  return Math.round(paisa / 100);
}

function config() {
  return {
    secret: process.env.KHALTI_SECRET_KEY ?? "",
    base: process.env.KHALTI_ENV === "live" ? LIVE : SANDBOX,
  };
}

async function khaltiPost(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const { secret, base } = config();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      authorization: `Key ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, json };
}

export const khalti: PaymentGateway = {
  method: "khalti",

  isConfigured() {
    return Boolean(config().secret);
  },

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (!config().secret) return { ok: false, reason: "notConfigured" };

    try {
      const { ok, status, json } = await khaltiPost("/epayment/initiate/", {
        return_url: input.successUrl,
        website_url: new URL(input.successUrl).origin,
        amount: toPaisa(input.amount),
        purchase_order_id: input.reference,
        purchase_order_name: input.description,
        customer_info: {
          name: input.customer.name ?? undefined,
          phone: input.customer.phone ?? undefined,
        },
      });

      const body = json as { pidx?: string; payment_url?: string } | null;
      if (!ok || !body?.payment_url || !body?.pidx) {
        return { ok: false, reason: `initiate failed (${status})`, raw: json };
      }

      return {
        ok: true,
        kind: "redirect",
        url: body.payment_url,
        providerTxnId: body.pidx,
        raw: json,
      };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  },

  async verify(input: VerifyInput): Promise<VerifyResult> {
    if (!config().secret) return { ok: false, reason: "notConfigured" };

    // The pidx is the only thing we take from the callback, and only as a
    // lookup key — never as evidence of the outcome. We fall back to the pidx
    // we stored at initiation, so a callback with no pidx at all still
    // verifies.
    const pidx = input.callback.pidx ?? input.callback.providerTxnId;
    if (!pidx) return { ok: false, reason: "missingPidx" };

    try {
      const { ok, status, json } = await khaltiPost("/epayment/lookup/", {
        pidx,
      });
      if (!ok) return { ok: false, reason: `lookup failed (${status})`, raw: json };

      const body = json as {
        status?: string;
        transaction_id?: string;
        total_amount?: number;
      } | null;

      if (!body?.status) return { ok: false, reason: "unreadableResponse", raw: json };

      if (body.status === "Completed") {
        return {
          ok: true,
          status: "paid",
          providerTxnId: String(body.transaction_id ?? pidx),
          amount: toRupees(Number(body.total_amount ?? 0)),
          raw: json,
        };
      }

      if (body.status === "Pending" || body.status === "Initiated") {
        return { ok: true, status: "pending", reason: body.status, raw: json };
      }

      // User canceled, Expired, Refunded.
      return { ok: true, status: "failed", reason: body.status, raw: json };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!config().secret) return { ok: false, reason: "notConfigured" };

    try {
      const { ok, status, json } = await khaltiPost(
        `/merchant-transaction/${input.providerTxnId}/refund/`,
        { amount: toPaisa(input.amount), reason: input.reason },
      );
      if (!ok) return { ok: false, reason: `refund failed (${status})`, raw: json };
      return { ok: true, providerTxnId: input.providerTxnId, raw: json };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  },
};
