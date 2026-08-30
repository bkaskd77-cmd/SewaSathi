/**
 * The payments module's public surface.
 *
 * Everything outside `lib/payments/` imports from here — enforced by
 * `no-restricted-imports`. The individual adapters are deliberately not
 * exported: a caller that could reach `esewa.ts` directly would be a second
 * place that knows which gateway is in play, and the whole point of the
 * registry is that there is exactly one.
 */

import { cash } from "./cash";
import { esewa } from "./esewa";
import { khalti } from "./khalti";
import type { PaymentGateway } from "./gateway";
import type { PaymentMethod } from "./status";

/** Every gateway, by the method it settles. */
const REGISTRY: Record<PaymentMethod, PaymentGateway> = {
  cash,
  esewa,
  khalti,
};

export function gatewayFor(method: PaymentMethod): PaymentGateway {
  return REGISTRY[method];
}

/**
 * The methods that can actually be offered right now.
 *
 * A gateway with no credentials is hidden rather than shown and then failing
 * at the worst moment — after the customer has committed. Cash is always
 * present, which is why there is never an empty list.
 */
export function availableMethods(): PaymentMethod[] {
  return (Object.keys(REGISTRY) as PaymentMethod[]).filter((method) =>
    REGISTRY[method].isConfigured(),
  );
}

export type {
  InitiateInput,
  InitiateResult,
  PaymentGateway,
  RefundInput,
  RefundResult,
  VerifyInput,
  VerifyResult,
} from "./gateway";

export {
  canRetry,
  canTransitionPayment,
  isInFlight,
  isPaymentMethod,
  isPaymentStatus,
  isSettled,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  type PaymentMethod,
  type PaymentStatus,
} from "./status";

export {
  canSettle,
  judgeFinalAmount,
  PRICE_RULES,
  type PriceVerdict,
} from "./pricing";

export { COMMISSION_BPS, splitAmount, type Split } from "./commission";
