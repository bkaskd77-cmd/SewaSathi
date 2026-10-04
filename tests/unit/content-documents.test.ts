import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A legal page must render even when everything about versioning has gone wrong.
 *
 * WHY THIS IS THE CASE THAT MATTERS. The terms, the privacy page, the refund policy and
 * the enforcement ladder are linked from the sign-up flow and agreed to before anybody
 * books. A blank one is not a degraded screen — it is a document somebody agreed to that
 * nobody can read, on the product's most consequential page.
 *
 * So `liveDocument` falls back to the file in `lib/content/` on everything: nothing
 * published, an unreachable table, a pointer at a version that is not there, and a
 * stored body that will not parse. The last is the one worth having explicitly, because
 * it is the only failure a publish can introduce and it would otherwise be discovered
 * by a customer.
 *
 * THE INNER AND OUTER CATCHES OVERLAP, which a break-test showed rather than a reading:
 * making the parse branch rethrow changed nothing, because the surrounding catch returns
 * the file anyway. Neither is dead code — this is the page where a blank render is least
 * acceptable — and these cases assert the BEHAVIOUR rather than either branch. They do
 * bite: making the outer catch return a document with an empty title turns one red.
 */

const maybeSingle = vi.fn();
const createAdminClient = vi.fn();
const hasSupabaseConfig = vi.fn(() => true);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));
vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => hasSupabaseConfig() }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));

/** Answers the two reads `readLive` makes, in order. */
function supabaseReturning(pointer: unknown, version: unknown) {
  const calls: unknown[] = [pointer, version];
  let i = 0;
  maybeSingle.mockImplementation(() => Promise.resolve(calls[i++]));
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle }),
          maybeSingle,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  maybeSingle.mockReset();
  createAdminClient.mockReset();
  hasSupabaseConfig.mockReturnValue(true);
});

describe("a legal document always renders something", () => {
  it("serves the file when nothing is published", async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: { live_version: null }, error: null }, null),
    );
    const { liveDocument } = await import("@/lib/content/documents");
    const live = await liveDocument("terms", "en");

    expect(live.version).toBeNull();
    expect(live.document.title.length).toBeGreaterThan(0);
  });

  it("serves the file when the database is unreachable", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("no connection");
    });
    const { liveDocument } = await import("@/lib/content/documents");
    const live = await liveDocument("privacy", "ne");

    expect(live.version).toBeNull();
    expect(live.document.title.length).toBeGreaterThan(0);
  });

  /*
   * THE ONE FAILURE A PUBLISH CAN INTRODUCE. The body is the structured document as
   * JSON; a malformed one would otherwise throw inside a Server Component and render
   * the error page for a document somebody has agreed to.
   */
  it("serves the file when a published version will not parse", async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning(
        { data: { live_version: 3 }, error: null },
        {
          data: {
            version: 3,
            body_en: "{ not json at all",
            body_ne: "{ nor this",
            effective_from: "2026-10-01T00:00:00.000Z",
          },
        },
      ),
    );
    const { liveDocument } = await import("@/lib/content/documents");
    const live = await liveDocument("terms", "en");

    expect(live.version).toBeNull();
    expect(live.document.title.length).toBeGreaterThan(0);
  });

  it("serves the published version when there is a good one", async () => {
    const published = {
      title: "Terms, version three",
      lead: "What you agree to.",
      updated: "2026-10-01",
      sections: [],
    };
    createAdminClient.mockReturnValue(
      supabaseReturning(
        { data: { live_version: 3 }, error: null },
        {
          data: {
            version: 3,
            body_en: JSON.stringify(published),
            body_ne: JSON.stringify(published),
            effective_from: "2026-10-01T00:00:00.000Z",
          },
        },
      ),
    );
    const { liveDocument } = await import("@/lib/content/documents");
    const live = await liveDocument("terms", "en");

    expect(live.version).toBe(3);
    expect(live.document.title).toBe("Terms, version three");
  });
});

describe("which terms a booking agrees to", () => {
  /*
   * NULL IS "BEFORE VERSIONING EXISTED", never version 1. Every booking taken so far
   * was made against text nobody versioned, and `createBooking` writes whatever this
   * returns — so the column stays null until somebody publishes, and the bookings
   * before that are left alone rather than backfilled.
   */
  it("is null while nothing is published", async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: { live_version: null } }, null),
    );
    const { liveTermsVersion } = await import("@/lib/content/documents");
    expect(await liveTermsVersion()).toBeNull();
  });

  /* And it never throws: a booking must not fail because a version lookup did. */
  it("is null rather than an error when the read falls over", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("gone");
    });
    const { liveTermsVersion } = await import("@/lib/content/documents");
    expect(await liveTermsVersion()).toBeNull();
  });
});
