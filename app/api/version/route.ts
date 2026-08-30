import { NextResponse } from "next/server";

import { BUILD_COMMIT, BUILD_COMMIT_SHORT, BUILD_TIME } from "@/lib/build-info";

/**
 * Which build is serving, as a URL anybody can open.
 *
 * The `x-build-commit` meta tag answers the same question, but reading it
 * means viewing source — which is not something you do on a phone, and the
 * person who most needs the answer is usually the one holding one. So the
 * answer is also a page you can just open.
 *
 * Outside `app/[locale]/` on purpose, for the same reason as the triage route:
 * it is not a page and must never be rewritten to `/ne/api/version`.
 *
 * Nothing here is a secret. It is the commit SHA of a public repository and
 * the time it was compiled.
 */
/*
 * Never cached, anywhere.
 *
 * This was `force-static`, which is exactly wrong for the one endpoint whose
 * entire job is to tell you what is live right now: Vercel served it from the
 * CDN and a reader got the previous deploy's commit back. A stale answer here
 * is worse than no answer, because it looks authoritative.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    {
      commit: BUILD_COMMIT,
      short: BUILD_COMMIT_SHORT,
      builtAt: BUILD_TIME,
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        // Vercel's edge honours this one specifically.
        "cdn-cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}
