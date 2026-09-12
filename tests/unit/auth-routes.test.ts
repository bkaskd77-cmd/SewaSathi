import { describe, expect, it } from "vitest";

import {
  landingFor,
  isProtectedRoute,
  isProviderRoute,
  isPublicRoute,
  safeRedirect,
  roleOpensProviderRoutes,
} from "@/lib/auth";

/**
 * Route guarding and redirect intent.
 *
 * `safeRedirect` is the security-relevant half: `?next=` comes straight off
 * the query string, and an unchecked value is a textbook open redirect —
 * somebody is sent to a convincing fake login on another domain, from a link
 * that genuinely started on our site.
 *
 * The guards are locale-blind by design. `/ne/account` is the same protected
 * route as `/account`, and missing that would leave the Nepali half of the
 * product unguarded — which is not something anyone would notice by clicking.
 */

describe("safeRedirect refuses to leave the site", () => {
  it("rejects an absolute URL on another origin", () => {
    expect(safeRedirect("https://evil.example/login")).not.toContain("evil");
  });

  it("rejects protocol-relative URLs", () => {
    // "//evil.example" is a same-protocol jump to another host and is the
    // form people forget.
    expect(safeRedirect("//evil.example/login")).not.toContain("evil");
  });

  it("rejects a javascript: payload", () => {
    expect(safeRedirect("javascript:alert(1)")).not.toContain("javascript");
  });

  it("rejects backslash-smuggled hosts", () => {
    // A browser reads "\" as "/" inside a URL, so "/\evil.example" is a
    // protocol-relative jump wearing a disguise.
    expect(safeRedirect("/\\evil.example")).not.toContain("evil");
    expect(safeRedirect("\\\\evil.example")).not.toContain("evil");
  });

  it("rejects whitespace-smuggled hosts", () => {
    // Browsers strip tab, newline and carriage return before parsing.
    expect(safeRedirect("/\t/evil.example")).not.toContain("evil");
    expect(safeRedirect("/\n\\evil.example")).not.toContain("evil");
  });

  it("falls back to something safe rather than throwing", () => {
    for (const value of [null, undefined, "", "   "]) {
      const out = safeRedirect(value);
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
    }
  });

  it("keeps an ordinary in-app path", () => {
    expect(safeRedirect("/bookings")).toBe("/bookings");
  });

  it("keeps a booking path with its query intact", () => {
    // This is the whole point of the parameter: come back to *this* booking.
    const next = "/book?category=plumbing&urgency=emergency";
    expect(safeRedirect(next)).toBe(next);
  });

  it("returns an unprefixed path for the caller to localise", () => {
    // The caller adds /ne back on. Returning a prefixed path here would
    // double it.
    expect(safeRedirect("/ne/bookings")).not.toMatch(/^\/ne\/ne/);
  });
});

describe("guards are locale-blind", () => {
  it("protects a route in both languages", () => {
    for (const path of ["/bookings", "/ne/bookings", "/account", "/ne/account"]) {
      expect(isProtectedRoute(path)).toBe(true);
    }
  });

  it("protects nested paths under a protected route", () => {
    expect(isProtectedRoute("/bookings/abc-123")).toBe(true);
    expect(isProtectedRoute("/ne/bookings/abc-123")).toBe(true);
  });

  it("leaves /book open in both languages", () => {
    // Changed in Phase 6 on purpose: a stranger completes three steps before
    // being asked to sign in. Gating step one is where funnels die.
    expect(isProtectedRoute("/book")).toBe(false);
    expect(isProtectedRoute("/ne/book")).toBe(false);
  });

  it("does not protect the public pages", () => {
    for (const path of ["/", "/ne", "/services", "/ne/services", "/legal/terms"]) {
      expect(isProtectedRoute(path)).toBe(false);
    }
  });

  it("keeps the provider dashboard separate from customer routes", () => {
    expect(isProviderRoute("/providers/dashboard")).toBe(true);
    expect(isProviderRoute("/ne/providers/dashboard")).toBe(true);
    // The lead-capture page is public — it is the supply-side call to action.
    expect(isProviderRoute("/providers/join")).toBe(false);
  });
});

/**
 * The provider job screen, and the guard that hid it.
 *
 * `/provider/jobs` shipped inside PROVIDER_ROUTES, whose middleware check
 * reads `user_metadata.role` — a claim nothing in this product ever writes. So
 * the page redirected every visitor home, including the professional it exists
 * to help, and the redirect looked like the site simply ignoring the URL.
 *
 * The pairing matters as much as the rule: `/providers` is the public
 * directory and must stay public, while `/provider` is somebody's own work.
 * One character apart, and a bare prefix match confuses them.
 */
describe("the provider's own work is signed-in, the directory is not", () => {
  it("guards /provider/jobs behind sign-in", () => {
    expect(isProtectedRoute("/provider/jobs")).toBe(true);
  });

  it("guards it in Nepali too", () => {
    expect(isProtectedRoute("/ne/provider/jobs")).toBe(true);
  });

  it("does not send it through the provider-role guard, which nothing satisfies", () => {
    // That guard reads a claim no code path writes. Until Phase 10 sets one,
    // routing this page through it is a redirect home for everybody.
    expect(isProviderRoute("/provider/jobs")).toBe(false);
  });

  it("leaves the public directory public", () => {
    expect(isProtectedRoute("/providers/join")).toBe(false);
    expect(isProtectedRoute("/services")).toBe(false);
  });
});

/**
 * Phase 10's two new surfaces, and the one-character trap they sit next to.
 *
 * `/providers/apply` is signed-in and `/providers/join` is not, and they share
 * a prefix. `isPublicRoute` lists the public one exactly rather than
 * `/providers`, so a bare prefix match cannot let the shorter public entry
 * swallow the guarded one — the same mistake that made `/provider` and
 * `/providers` confusable, one character apart.
 */
describe("the application is signed-in, the join form is not", () => {
  it("guards /providers/apply behind sign-in", () => {
    // The phone step IS the OTP that got them here. Asking a tradesperson to
    // prove the same thing twice on a form this long loses supply.
    expect(isProtectedRoute("/providers/apply")).toBe(true);
  });

  it("guards it in Nepali too", () => {
    expect(isProtectedRoute("/ne/providers/apply")).toBe(true);
  });

  it("leaves the join form open to a stranger", () => {
    // Somebody who has not signed up yet has to be able to reach it at all.
    expect(isProtectedRoute("/providers/join")).toBe(false);
    expect(isPublicRoute("/providers/join")).toBe(true);
  });

  it("does not make the application public by sharing a prefix with it", () => {
    expect(isPublicRoute("/providers/apply")).toBe(false);
    expect(isPublicRoute("/ne/providers/apply")).toBe(false);
  });
});

describe("the reviewer's queue is not reachable signed out", () => {
  it("guards every admin path", () => {
    expect(isProtectedRoute("/admin")).toBe(true);
    expect(isProtectedRoute("/admin/applications")).toBe(true);
    expect(isProtectedRoute("/admin/applications/abc-123")).toBe(true);
  });

  it("guards it in Nepali too", () => {
    expect(isProtectedRoute("/ne/admin/applications")).toBe(true);
  });

  it("is never public", () => {
    expect(isPublicRoute("/admin/applications")).toBe(false);
  });

  /*
   * Route-level gating is NOT the boundary and this test says so out loud:
   * the page re-reads `profiles.role`, the server action re-reads it again,
   * and every table under it is admin-only in RLS. This rule only stops a
   * signed-out visitor reaching a shell.
   */
  it("does not pretend to be the authorization boundary", () => {
    expect(isProviderRoute("/admin/applications")).toBe(false);
  });
});

describe("roleOpensProviderRoutes", () => {
  /**
   * The middleware used to read `user.user_metadata.role`, which its own owner
   * can write from any signed-in browser with
   * `supabase.auth.updateUser({ data: { role: "admin" } })`. The guard was
   * asking the person being guarded what they were allowed to do. The role now
   * comes from `profiles`, and this is the decision it feeds.
   */
  it("opens for a provider and for an admin", () => {
    // An admin who cannot open a provider screen cannot support a professional
    // standing in somebody's kitchen.
    expect(roleOpensProviderRoutes("provider")).toBe(true);
    expect(roleOpensProviderRoutes("admin")).toBe(true);
  });

  it("stays shut for a customer", () => {
    expect(roleOpensProviderRoutes("customer")).toBe(false);
  });

  it("treats an unanswerable question as no", () => {
    // No profile, no session, or a read that failed all mean the same thing to
    // a guard, and the safe answer is no.
    expect(roleOpensProviderRoutes(null)).toBe(false);
  });

  it("is not satisfied by anything a user could invent", () => {
    // The old failure in one line: a role the product never issues must not
    // open a door, whatever it is spelled like.
    for (const invented of ["Admin", "ADMIN", "superuser", "provider ", "", "true"]) {
      expect(roleOpensProviderRoutes(invented)).toBe(false);
    }
  });
});

describe("where somebody lands after signing in", () => {
  /**
   * The rule that must not invert: an explicit destination always wins.
   * A professional's own burst pipe is still a booking, and sending them to
   * their jobs instead would drop the draft they were part-way through.
   */
  it("honours an explicit destination for a professional", () => {
    expect(landingFor({ next: "/book", worksHere: true })).toBe("/book");
    expect(landingFor({ next: "/bookings/abc", worksHere: true })).toBe(
      "/bookings/abc",
    );
  });

  it("sends a professional who asked for nothing to their work", () => {
    expect(landingFor({ next: "/", worksHere: true })).toBe("/provider/jobs");
  });

  it("leaves a customer on the homepage", () => {
    expect(landingFor({ next: "/", worksHere: false })).toBe("/");
  });
});
