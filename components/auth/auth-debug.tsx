"use client";

/**
 * The provider's own error, for us.
 *
 * A silent failure on the login screen is the worst kind this product has:
 * nobody can get in, and the only honest sentence we can show a customer —
 * "we couldn't send the code just now" — says nothing about why. Reading the
 * real reason meant opening DevTools and finding a network response, which is
 * not something anyone does on a phone and took several rounds to get to even
 * on a desktop. The app had the message the whole time.
 *
 * Same rule as the triage badge and the data badge: shown in development, and
 * anywhere with `?debug=auth` on the URL, because this branch deploys straight
 * to production and a strict production check would hide it exactly where it
 * is needed. Ordinary visitors never see it.
 *
 * It prints only the provider's own status and wording. No phone number, no
 * code, no token — nothing that would matter if it appeared in a screenshot.
 *
 * The query string is read from `window` rather than `useSearchParams`: this
 * page is statically rendered, and that hook would demand a Suspense boundary
 * around the whole form for a badge nobody normally sees. Safe here because
 * this only ever renders after a failed submit, which is necessarily on the
 * client.
 */
export function AuthDebug({ detail }: { detail: string | null }) {
  if (!detail) return null;

  const asked =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "auth";
  if (process.env.NODE_ENV !== "development" && !asked) return null;

  return (
    <p className="animate-pop-in mt-2 break-words rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-caption text-muted-foreground">
      {detail}
    </p>
  );
}
