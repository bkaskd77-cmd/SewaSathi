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
  /*
   * BOTH SIDES ARE TRIMMED, and that is about where these values come from
   * rather than about tidiness. A secret is typed once and pasted twice — into
   * a provider's dashboard and into a CI secret — and a trailing space or
   * newline survives both fields invisibly. The comparison then fails with no
   * signal at all: the token looks right on both screens and the door stays
   * shut, which is a morning spent suspecting the code.
   *
   * It costs nothing: a bearer token with meaningful leading or trailing
   * whitespace does not exist, and HTTP already strips it from the header on
   * the way in.
   */
  const expected = secret?.trim();
  if (!expected) return false;

  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();

  return timingSafeEqual(digest(bearerToken(header).trim()), digest(expected));
}

/**
 * Which secret a job is guarded by, and what that leaves shared.
 *
 * ONE TOKEN OPENED FOUR DOORS. `CRON_SECRET` was the bearer on the dispatch
 * sweep, the payment reconciliation, the retention sweep and `/api/health`'s
 * expensive half — so rotating it rotates all four, and a leak from any one
 * context opens the money sweeps. Audited as a low finding; this is the half of
 * the fix that was achievable.
 *
 * TWO OF THE FOUR CANNOT BE SEPARATED AND THE REASON IS NOT OURS. Vercel sends
 * `CRON_SECRET` — exactly that variable, exactly that header — on the paths in
 * `vercel.json`, and there is no per-path mechanism. Requiring a different
 * secret on `/api/bookings/dispatch` would mean Vercel's own invocation being
 * refused every night, with the only evidence a `cron_runs` row nobody wrote.
 * So those two stay on the shared token, deliberately, and this comment is the
 * record of why rather than an omission somebody finds later.
 *
 * THE TWO THAT CAN ARE THE TWO THAT LEAVE THE BUILDING. `/api/retention/sweep`
 * is invoked by a person, and `/api/health`'s detail is now read by CI on every
 * deploy — which means a GitHub Actions secret holds it. Before this, that
 * secret would have been `CRON_SECRET`, so a repository secret for a read-only
 * health payload also opened the sweep that moves a professional's money. That
 * is the concrete gain, and it is worth more than the tidiness.
 *
 * A JOB WITH ITS OWN TOKEN SET STOPS ACCEPTING THE SHARED ONE, which is what
 * makes this a separation rather than an addition. Until it is set the shared
 * token still works, so nothing breaks on the deploy that ships this and the
 * owner can set the variables in their own time — and `/api/health` reports
 * which jobs are still sharing, because a migration nobody can see the state of
 * is one nobody finishes.
 */
export type JobSecrets = {
  /** The job's own secret, when the owner has set one. */
  own: string | undefined;
  /** `CRON_SECRET`, which Vercel sends and which everything still falls back to. */
  shared: string | undefined;
};

export type TokenSeparation = "own" | "shared" | "unset";

export function tokenSeparation(secrets: JobSecrets): TokenSeparation {
  if (secrets.own) return "own";
  if (secrets.shared) return "shared";
  return "unset";
}

export function jobTokenAccepted(
  secrets: JobSecrets,
  header: string | null,
): boolean {
  /* The own token REPLACES the shared one rather than joining it. Accepting
     either would be two keys to one door, which is the arrangement this is
     meant to end. */
  const expected = secrets.own ?? secrets.shared;
  return cronTokenAccepted(expected, header);
}
