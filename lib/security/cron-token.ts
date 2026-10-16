import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The bearer token on a scheduled job's request, judged once.
 *
 * FOUR COPIES OF FIVE LINES, AND ALL FOUR USED `!==`. `/api/health?deep=1`,
 * `/api/bookings/dispatch`, `/api/payments/reconcile` and
 * `/api/retention/sweep` each read `CRON_SECRET`, stripped the `Bearer `
 * prefix and compared with a string operator, which returns as soon as two
 * bytes differ. `/api/sms/send` next door had already been written the careful
 * way — `timingSafeEqual` against an HMAC — so the product held both answers to
 * one question and the stricter one was on the endpoint with the smaller
 * consequence.
 *
 * HOW REAL IS THE ATTACK: not very, which is why this is a low finding and not
 * a high one. Measuring a few nanoseconds of early return across the public
 * internet, through Vercel's edge and a cold function, needs an enormous number
 * of samples against a target that is rate-limited by being a cron endpoint
 * nobody advertises. What makes it worth fixing anyway is that the fix is four
 * lines and the alternative is a product that answers the same question two
 * ways, which is how the weaker answer ends up on the path that matters.
 *
 * IT HASHES BEFORE IT COMPARES, rather than checking the length first. The
 * obvious shape — `offered.length === expected.length && timingSafeEqual(…)` —
 * is what `/api/sms/send` does and is correct there, where the compared value
 * is a fixed-width HMAC and the length tells an attacker nothing. Here the
 * compared value IS the secret, so an early length check hands back its length
 * for free. Two SHA-256 digests are always 32 bytes, so the comparison is
 * constant time over inputs of any size.
 *
 * AN UNSET SECRET ACCEPTS NOBODY, which is the same direction `isFresh` takes
 * for a missing timestamp: a deployment that forgot the variable must not
 * become one where every token works. `/api/health` is the only caller that
 * then says so out loud, because "no token will ever work here" and "your token
 * is wrong" are different facts and only one of them is worth re-checking a
 * token over.
 *
 * PURE, AND THE SECRET ARRIVES AS AN ARGUMENT rather than being read here. A
 * module that reads a secret out of the environment must declare `server-only`
 * (`check:secrets`' third pass), and a `server-only` module is one a test
 * cannot reach — which is how the judgements this repository has had to move
 * out of the data layer four times ended up in there in the first place.
 *
 * The scanner draws that line at the literal expression rather than at the
 * bare name, because this codebase documents its own rules in prose and a
 * check that could not tell a sentence from a read would teach people to stop
 * writing the sentences. So this one is written the long way round on purpose;
 * spelling it the short way here would have been a false positive, loudly, on
 * the first build.
 */
export function bearerToken(header: string | null): string {
  return header?.replace(/^Bearer\s+/i, "") ?? "";
}

export function cronTokenAccepted(
  secret: string | undefined,
  header: string | null,
): boolean {
  if (!secret) return false;

  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();

  return timingSafeEqual(digest(bearerToken(header)), digest(secret));
}
