import type { PaymentMethod } from "./status";

/**
 * Reading a gateway's return URL.
 *
 * Deliberately pure and deliberately dumb: it extracts an *identifier* and
 * flattens whatever else arrived into a plain record. It decides nothing about
 * whether a payment succeeded, because nothing arriving here is evidence of
 * that — see the note at the top of `gateway.ts`. `verifyAndSettle` asks the
 * gateway.
 *
 * The reference matters because it is the only thing that ties a returning
 * browser back to a row we wrote before the customer left. We put it on the
 * return URL ourselves as `ref`, and each gateway also echoes it under its own
 * name, so a stripped query string still resolves:
 *
 *   eSewa   — a base64 JSON blob in `data`, carrying `transaction_uuid`.
 *   Khalti  — `purchase_order_id`, alongside the `pidx` the lookup needs.
 *
 * A reference we do not recognise is rejected upstream by `verifyAndSettle`
 * ("unknownReference"), so an attacker naming somebody else's payment achieves
 * a verification against the gateway and nothing more.
 */

export type CallbackRead = {
  /** Our own reference, or null if nothing in the URL carried one. */
  reference: string | null;
  /** Everything the gateway sent, flattened, for the adapter to look up with. */
  params: Record<string, string>;
};

/** eSewa's `data` is base64 JSON. A malformed one is not worth an exception. */
function decodeEsewaData(encoded: string): Record<string, string> {
  try {
    const json = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(json)) {
      if (value !== null && typeof value !== "object") out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function readCallback(
  method: PaymentMethod,
  search: URLSearchParams,
): CallbackRead {
  const params: Record<string, string> = {};
  // forEach rather than for..of — see the note in the return route.
  search.forEach((value, key) => {
    params[key] = value;
  });

  if (method === "esewa" && params.data) {
    // The decoded fields are merged under the raw ones so that our own `ref`
    // stays visible alongside eSewa's own naming.
    Object.assign(params, decodeEsewaData(params.data));
  }

  const reference =
    params.ref ||
    params.transaction_uuid ||
    params.purchase_order_id ||
    null;

  return { reference, params };
}
