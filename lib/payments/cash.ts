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
 * Cash on completion — the primary path, not the fallback.
 *
 * Most bookings in Nepal will be settled in notes at the door. Modelling that
 * as "the case where the real payment failed" would make the common journey
 * the ugly one, so cash implements the same interface as the gateways and gets
 * the same record, the same reference and the same receipt.
 *
 * The difference is who verifies. There is no server to ask, so the customer
 * is the oracle: the professional marks the work complete with a final amount,
 * the customer confirms they handed the money over, and that confirmation
 * settles the payment. Until they confirm, it stays unpaid — a booking that is
 * completed and unpaid is the normal state here, not a fault.
 *
 * `verify()` therefore reports `pending` rather than reaching anywhere. The
 * settle-on-confirmation step lives in the server action, where the caller's
 * identity is known; a gateway adapter has no business deciding that the
 * person asking is the customer.
 */
export const cash: PaymentGateway = {
  method: "cash",

  // Always available. It needs no credentials and must never be hidden by a
  // missing key — it is how most people will pay.
  isConfigured() {
    return true;
  },

  async initiate(_input: InitiateInput): Promise<InitiateResult> {
    /*
     * Nothing to hand over to. The payment row is created `pending` by the
     * caller and waits for the customer's confirmation, so there is no
     * redirect and no form.
     */
    return { ok: false, reason: "cashNeedsNoGateway" };
  },

  async verify(_input: VerifyInput): Promise<VerifyResult> {
    return {
      ok: true,
      status: "pending",
      reason: "awaitingCustomerConfirmation",
      raw: null,
    };
  },

  async refund(_input: RefundInput): Promise<RefundResult> {
    // Money that moved hand to hand comes back the same way. The refund record
    // still exists so support has a queue and the customer sees it was raised.
    return { ok: false, reason: "manualRefundRequired" };
  },
};
