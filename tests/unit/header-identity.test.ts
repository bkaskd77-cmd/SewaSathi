import { describe, expect, it } from "vitest";

import { headerIdentity } from "@/lib/auth";

/**
 * Which doors the site header offers, decided once.
 *
 * THREE CALL SITES COMPUTED THIS INDEPENDENTLY AND ALL THREE DISAGREED.
 * `(app)/layout.tsx` passed all three props; `page.tsx` and `not-found.tsx`
 * passed only the name. So the Admin item appeared on /account/security and
 * vanished on the homepage, "My work" never appeared on the homepage for a
 * professional at all, and a signed-in person with no name set was rendered as
 * SIGNED OUT on the landing page — offered "Sign in" while holding a session.
 *
 * One function, three callers, and adding a fourth door later is one edit
 * rather than a hunt.
 */

const base = {
  signedIn: true,
  fullName: "Bikas Khadka",
  role: "customer" as string | null,
  providerId: null as string | null,
  fallbackName: "Account",
};

describe("what the header offers a signed-in person", () => {
  it("gives a customer their name and neither working door", () => {
    expect(headerIdentity(base)).toEqual({
      accountName: "Bikas Khadka",
      worksHere: false,
      isAdmin: false,
    });
  });

  it("opens the admin door on the ROLE", () => {
    expect(headerIdentity({ ...base, role: "admin" }).isAdmin).toBe(true);
  });

  it("opens the work door on OWNING A LISTING, never on the role", () => {
    // An admin passes the provider route guard so support can reach a
    // professional's screen. That is permission, not a reason to go there —
    // and an admin owns no listing, so "My work" would be an empty shell.
    expect(headerIdentity({ ...base, role: "admin" }).worksHere).toBe(false);
    expect(
      headerIdentity({ ...base, role: "provider", providerId: "p1" }).worksHere,
    ).toBe(true);
  });

  it("still names a signed-in person who never set a name", () => {
    // The landing page passed null here, which renders the SIGNED-OUT header:
    // somebody holding a session was invited to sign in.
    expect(headerIdentity({ ...base, fullName: null }).accountName).toBe(
      "Account",
    );
  });

  it("gives a signed-out visitor no name and no doors", () => {
    expect(
      headerIdentity({ ...base, signedIn: false, fullName: null }),
    ).toEqual({ accountName: null, worksHere: false, isAdmin: false });
  });

  it("never opens a door for somebody who is not signed in", () => {
    // Defensive: a stale profile with no session must not light the menu up.
    expect(
      headerIdentity({
        ...base,
        signedIn: false,
        role: "admin",
        providerId: "p1",
      }),
    ).toEqual({ accountName: null, worksHere: false, isAdmin: false });
  });
});
