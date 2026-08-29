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
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      commit: BUILD_COMMIT,
      short: BUILD_COMMIT_SHORT,
      builtAt: BUILD_TIME,
    },
    { headers: { "cache-control": "public, max-age=0, must-revalidate" } },
  );
}
