import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Every audit row carries what the gate saw, not only what the actor did.
 *
 * THE GAP, NAMED IN THE AUDIT AS THE FIRST THING IT DID NOT FIX.
 * `freshAdminActor()` refuses a money action without an `amr` proof inside
 * `REAUTH_WINDOW_MINUTES`; the row written afterwards said who decided, when,
 * and on what — and nothing about whether they had been challenged. A reviewer
 * reconstructing a disputed refund could see the decision and had to take the
 * gate on trust, which is the one thing a log exists to remove.
 *
 * READ IN `lib/audit` RATHER THAN PASSED IN, because the row is written inside
 * the data layer — `issueRefund` logs, not the action that called it — so a
 * parameter would mean threading a proof through eleven writers in four
 * modules, which is eleven places to pass null and one of them will.
 *
 * ASSERTED ON THE SOURCE, which is the honest limit: this says the proof is
 * read and written, not that a given row carries a given timestamp. That needs
 * a session, and there is no session in a unit test — `tests/db/audit-proof`
 * covers the column and the append-only trigger instead.
 */

describe("the step-up proof reaches the audit row", () => {
  const audit = readFileSync("lib/audit/index.ts", "utf8");

  it("writes proved_at from the session's own amr claim", () => {
    expect(audit).toContain("return sessionAuthenticatedAt();");
    expect(audit).toContain("const provedAt = await proofForThisSession()");
    expect(audit).toContain(
      "proved_at: provedAt ? provedAt.toISOString() : null",
    );
  });

  it("asks for the cookie store before it asks for a session", () => {
    /*
     * THE UNHANDLED REJECTION THIS EXISTS FOR, and it turned the suite red on
     * the commit that added the column. `recordSecurityEvent` is reachable with
     * no request scope — a sweep, a test — and constructing the auth client
     * there does not fail where it is awaited: GoTrue loads its initial session
     * in the background, that load calls `cookies()`, and the throw arrives as
     * an unhandled rejection no `try` around the call can catch. A log that can
     * break the thing it is logging is the one failure this module is built to
     * be incapable of.
     */
    const helper = audit.slice(
      audit.indexOf("async function proofForThisSession"),
    );
    expect(helper.indexOf("await cookies()")).toBeLessThan(
      helper.indexOf("sessionAuthenticatedAt()"),
    );
    expect(helper).toContain("return null;");
  });

  it("reads it through the front door", () => {
    /* `lib/auth/mfa` is the adapter and stays private; `lib/auth/session`
       re-exports this for exactly the reason the provider action was corrected
       for — a dynamic import is a boundary evaded rather than respected. */
    expect(audit).toContain('from "@/lib/auth/session"');
    expect(audit).not.toContain('from "@/lib/auth/mfa"');
  });

  it("takes the same reading the gate judged, not a second one", () => {
    /*
     * MEMOISED PER REQUEST. One admin action asks twice — the gate, then the
     * log — and two reads could disagree across a token refresh, which would
     * put a proof on the row that the gate never saw. `cache()` makes them one
     * reading and costs one round trip instead of two.
     */
    const mfa = readFileSync("lib/auth/mfa.ts", "utf8");
    expect(mfa).toContain("export const sessionAuthenticatedAt = cache(");
    expect(mfa).toContain('import { cache } from "react"');
  });

  it("still never throws, because the event already happened", () => {
    /*
     * The column must not become a reason for a booking to roll back. The read
     * is inside the same try, and `sessionAuthenticatedAt` swallows its own
     * failures and answers null — which is "not recorded", the honest value for
     * a cron or a gateway callback that has no session at all.
     */
    expect(audit).toContain(
      "// Never rethrown. The thing being logged already happened.",
    );
    const guarded = audit.slice(
      audit.indexOf("export async function recordSecurityEvent"),
    );
    expect(guarded.indexOf("try {")).toBeLessThan(
      guarded.indexOf("const provedAt"),
    );
  });

  it("is declared on the row type as nullable", () => {
    const types = readFileSync("types/supabase.ts", "utf8");
    expect(types).toContain("proved_at: string | null;");
  });
});
