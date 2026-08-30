/**
 * The contract every payment gateway satisfies.
 *
 * Adding or swapping a gateway is one file implementing this interface plus a
 * line in the registry — that is the adapter law, and payments are where it
 * pays for itself, because Nepal's gateway landscape changes and a hardcoded
 * eSewa would mean touching every route to add Fonepay.
 *
 * THE ONE RULE THAT MATTERS: `verify()` is the only thing that may conclude a
 * payment succeeded, and it must reach the gateway's own servers to do it. A
 * browser arriving back on our success URL is a claim made by whoever
 * controls the browser. Nothing in `initiate()`'s return, and nothing in the
 * callback query string, is evidence.
 */

import type { PaymentMethod } from "./status";

export type InitiateInput = {
  /** Our idempotency key. Becomes the gateway's order/purchase id. */
  reference: string;
  /** Integer NPR. Already validated against the quoted band server-side. */
  amount: number;
  /** Where the gateway sends the customer back to. Absolute URLs. */
  successUrl: string;
  failureUrl: string;
  /** Shown on the gateway's own page so the customer recognises the payment. */
  description: string;
  customer: { name: string | null; phone: string | null };
};

export type InitiateResult =
  | {
      ok: true;
      /**
       * How to hand the customer over.
       *
       * `redirect` — send the browser to `url`.
       * `form` — POST `fields` to `url`; eSewa signs a form rather than
       * accepting a query string, so a plain redirect cannot express it.
       */
      kind: "redirect" | "form";
      url: string;
      fields?: Record<string, string>;
      /** Their id for this attempt, when they give one at initiation. */
      providerTxnId?: string | null;
      raw: unknown;
    }
  | { ok: false; reason: string; raw?: unknown };

export type VerifyInput = {
  reference: string;
  /** What we recorded. The gateway's answer is reconciled against this. */
  expectedAmount: number;
  /**
   * Whatever came back on the callback — query params, POST body, both.
   * Treated as a hint about *which* transaction to ask about, never as
   * evidence of its outcome.
   */
  callback: Record<string, string>;
};

export type VerifyResult =
  | {
      ok: true;
      status: "paid";
      providerTxnId: string;
      /** What the gateway says was actually taken. Reconciled by the caller. */
      amount: number;
      raw: unknown;
    }
  | {
      ok: true;
      /** The gateway answered, and the answer is that it did not succeed. */
      status: "failed" | "pending";
      reason: string;
      raw: unknown;
    }
  | {
      /** We could not get an answer at all — network, outage, bad response. */
      ok: false;
      reason: string;
      raw?: unknown;
    };

export type RefundInput = {
  reference: string;
  providerTxnId: string;
  amount: number;
  reason: string;
};

export type RefundResult =
  | { ok: true; providerTxnId: string; raw: unknown }
  | { ok: false; reason: string; raw?: unknown };

export type PaymentGateway = {
  method: PaymentMethod;
  /** False when its credentials are absent, so the UI can hide it honestly. */
  isConfigured(): boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(input: VerifyInput): Promise<VerifyResult>;
  refund(input: RefundInput): Promise<RefundResult>;
};
