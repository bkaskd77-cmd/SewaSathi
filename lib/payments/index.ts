/**
 * The payments module's public surface.
 *
 * Everything outside `lib/payments/` imports from here — enforced by
 * `no-restricted-imports`. The individual adapters are deliberately not
 * exported: a caller that could reach `esewa.ts` directly would be a second
 * place that knows which gateway is in play, and the whole point of the
 * registry is that there is exactly one.
 *
 * SERVER ONLY, and marked so rather than left to discipline. The registry
 * reaches every adapter, and eSewa's signs its form with `node:crypto`; a
 * Client Component that imports this fails the build with an unhandled `node:`
 * scheme, which is exactly what happened. The pure half — method names, the
 * price rules, the error allow-list — is re-exported from `./client`, which is
 * the path a Client Component uses.
 */

import "server-only";

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

export { readCallback, type CallbackRead } from "./callback";

/*
 * Everything a Client Component may also have. Re-exported rather than moved,
 * so server code has one import for the whole module and nobody has to
 * remember which half a symbol lives in.
 */
export * from "./client";
