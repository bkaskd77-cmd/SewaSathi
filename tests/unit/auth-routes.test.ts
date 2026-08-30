import { describe, expect, it } from "vitest";

import {
  isProtectedRoute,
  isProviderRoute,
  safeRedirect,
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
