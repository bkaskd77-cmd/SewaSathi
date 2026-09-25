/**
 * Which doors the site header offers, decided in one place.
 *
 * THREE CALL SITES COMPUTED THIS INDEPENDENTLY AND ALL THREE DISAGREED.
 * `app/[locale]/(app)/layout.tsx` passed the name, `worksHere` and `isAdmin`;
 * `app/[locale]/page.tsx` and `app/[locale]/not-found.tsx` passed only the
 * name. The results were three separate bugs of the same shape:
 *
 *   * the Admin item appeared on `/account/security` and vanished on `/`;
 *   * "My work" never appeared on the landing page for a professional at all;
 *   * a signed-in person who never set a name got `accountName: null` on the
 *     landing page, which renders the SIGNED-OUT header — somebody holding a
 *     session was invited to sign in.
 *
 * `SiteHeader` is `"use client"` and cannot read the session itself, so the
 * props have to come from the server. What it can have is one function that
 * produces them, so a fourth door later is one edit rather than a hunt through
 * every page that renders a header.
 *
 * TAKES PRIMITIVES, NOT A `SessionProfile`. That type lives in
 * `lib/auth/session.ts`, which is `server-only`; depending on it would make
 * this rule untestable and drag a server module toward the isomorphic entry
 * for no gain. The caller unpacks what it already has.
 *
 * THE TWO DOORS OPEN ON DIFFERENT THINGS AND THAT IS THE POINT. `isAdmin` is a
 * ROLE. `worksHere` is OWNING A LISTING — an admin passes the provider route
 * guard so support can reach a professional's screen, but has no listing and
 * therefore no work, and putting "My work" in their menu would point at an
 * empty shell. Permission to reach a screen and a reason to go there are
 * different questions.
 */

export type HeaderIdentity = {
  /** Null renders the signed-out header, so it is null only when signed out. */
  accountName: string | null;
  worksHere: boolean;
  isAdmin: boolean;
};

export function headerIdentity(input: {
  signedIn: boolean;
  fullName: string | null;
  role: string | null;
  providerId: string | null;
  /** Shown when somebody is signed in but never finished onboarding. */
  fallbackName: string;
}): HeaderIdentity {
  if (!input.signedIn) {
    return { accountName: null, worksHere: false, isAdmin: false };
  }

  return {
    accountName: input.fullName ?? input.fallbackName,
    worksHere: input.providerId != null,
    isAdmin: input.role === "admin",
  };
}
