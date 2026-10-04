import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A content table nobody can reach must not blank the product.
 *
 * WHY THIS IS THE MOST IMPORTANT TEST IN THE PHASE. `i18n/request.ts` is the single
 * path every rendered string in this product passes through — every page, both
 * languages, server and client. If an unreachable `content_strings` could produce
 * empty strings, a database hiccup would not degrade one screen: it would empty all of
 * them, including the ones that would normally explain what went wrong.
 *
 * It is rule 6 in the shape it takes for copy, and it is sharper than the `/services`
 * case that rule came from. There, a failed read renders "we can't load professionals
 * right now — this is us, not you". Here there would be no sentence left to render it
 * with, because the sentence is in the catalogue the read just failed to augment.
 *
 * THREE FAILURE SHAPES, because they reach different branches: a query that returns an
 * error, a client that throws when constructed, and no Supabase configuration at all —
 * which is what a fresh clone has and what every contributor runs.
 *
 * THE TWO GUARDS OVERLAP ON PURPOSE, which a break-test showed rather than a reading:
 * making the error branch throw instead of returning `{}` changed nothing, because the
 * surrounding `catch` caught it and returned `{}` anyway. Neither is dead code — that is
 * defence in depth on the one path that could empty every screen at once — and the
 * cases below assert the BEHAVIOUR rather than either branch, so they stay true however
 * the inside is arranged. They do bite: replacing the catch's `{}` with a blanked string
 * turns the third case red.
 */

const select = vi.fn();
const createAdminClient = vi.fn();
const hasSupabaseConfig = vi.fn(() => true);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));
vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => hasSupabaseConfig() }));

/* `unstable_cache` is a pass-through here: caching is not what these cases are about,
   and wrapping would make each one read whatever the previous one cached. */
vi.mock("next/cache", () => ({
  unstable_cache: <T,>(fn: T) => fn,
}));

beforeEach(() => {
  vi.resetModules();
  select.mockReset();
  createAdminClient.mockReset();
  hasSupabaseConfig.mockReturnValue(true);
  createAdminClient.mockReturnValue({
    from: () => ({ select: () => ({ eq: () => select() }) }),
  });
});

describe("the catalogue survives a content table that does not answer", () => {
  it("renders the catalogue when the query errors", async () => {
    select.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const { contentOverrides } = await import("@/lib/data/content");
    expect(await contentOverrides("en")).toEqual({});
  });

  it("renders the catalogue when the client throws", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("no service role key");
    });
    const { contentOverrides } = await import("@/lib/data/content");
    expect(await contentOverrides("en")).toEqual({});
  });

  /*
   * A FRESH CLONE WITH NO KEYS, which is what every new contributor runs and what the
   * booking-flow check runs against. It must render the whole product in both
   * languages, so this path must not even try to read.
   */
  it("does not reach for a database that is not configured", async () => {
    hasSupabaseConfig.mockReturnValue(false);
    const { contentOverrides } = await import("@/lib/data/content");
    expect(await contentOverrides("ne")).toEqual({});
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  /* And the happy path, so the three above are proving a fallback rather than a stub. */
  it("returns the overrides when the read works", async () => {
    select.mockResolvedValue({
      data: [{ message_key: "home.lead", value: "Find a tradesperson" }],
      error: null,
    });
    const { contentOverrides } = await import("@/lib/data/content");
    expect(await contentOverrides("en")).toEqual({
      "home.lead": "Find a tradesperson",
    });
  });
});
