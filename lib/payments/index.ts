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
 * The refund rule's shapes, on the public entry where callers may reach them.
 *
 * TYPES ONLY, DELIBERATELY. The functions stay behind the dynamic
 * `await import("@/lib/payments/refund")` that `lib/data/claims.ts` already
 * uses — this module's registry reaches `node:crypto` through eSewa, and
 * pulling it into a static import chain is what the module boundary exists to
 * stop. A type erases at compile time and costs the bundle nothing, but it
 * still has to come through the front door: the linter caught the first
 * attempt reaching into `./refund` directly, which is the rule working.
 */
export type {
  MaterialsRead,
  RefundCeiling,
  RefundSubject,
  RefundVerdict,
} from "./refund";

/*
 * Everything a Client Component may also have. Re-exported rather than moved,
 * so server code has one import for the whole module and nobody has to
 * remember which half a symbol lives in.
 */
export * from "./client";
