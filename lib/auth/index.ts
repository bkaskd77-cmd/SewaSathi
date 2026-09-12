/**
 * The auth module's isomorphic public surface.
 *
 * Three entries, not one, and the split is forced rather than stylistic:
 *
 *   @/lib/auth          this file — route rules and phone formatting, safe
 *                       on both sides of the boundary
 *   @/lib/auth/session  server only (`getSessionProfile` imports `server-only`)
 *   @/lib/auth/otp      SERVER only — the SMS adapter. It moved to the server
 *                       in Phase 9: the browser used to call Supabase
 *                       directly, so our own rate limits never ran. The
 *                       outcome types and `strandsCustomer` live in
 *                       `otp-contract.ts` and are re-exported here, because a
 *                       login form still has to render what came back.
 *
 * Merging them would pull `server-only` into the client bundle the moment a
 * form imported a phone formatter. Everything else under `lib/auth/` is
 * internal and the linter says so.
 */
export {
  isProtectedRoute,
  isProviderRoute,
  isPublicRoute,
  roleOpensProviderRoutes,
  safeRedirect,
  PROTECTED_ROUTES,
  PROVIDER_ROUTES,
  PUBLIC_ROUTES,
} from "./routes";

export {
  checkNepaliMobile,
  formatE164ForDisplay,
  formatNepaliMobile,
  NEPAL_DIAL_CODE,
  toNationalDigits,
  type PhoneCheck,
  type PhoneError,
} from "./phone";

export {
  strandsCustomer,
  type OtpError,
  type OtpOutcome,
  type VerifyOutcome,
} from "./otp-contract";
