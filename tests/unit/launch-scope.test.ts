import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SCOPE_OFF,
  scopeAllows,
  scopeNarrows,
  scopeStanding,
  withKey,
  type LaunchScope,
} from "@/lib/config/launch-scope";

/**
 * The soft-launch scope: the rule, and where it is and is not applied.
 *
 * THE ONE INVARIANT WORTH PINNING is that `enabled` decides and the arrays
 * never do. An empty array readable as "everything is open" would make a
 * truncated write open the whole country; readable as "nothing is open" would
 * close the product on the same accident. Both directions are asserted, because
 * a single case would pass under either mistake.
 *
 * AND THE WIRING IS ASSERTED AS WELL AS THE FUNCTION, which is the lesson
 * `labelCategory` records: that rule was built whole, and the test that mattered
 * was the one checking the right reads consulted it. Here the asymmetry is the
 * whole design — a customer's choice is narrowed and a professional's is not —
 * so both directions are read out of the sources.
 */

const WARDS = ["kathmandu-4", "kathmandu-10", "lalitpur-3"];
const TRADES = ["plumbing", "electrical", "painting"];

function scope(over: Partial<LaunchScope> = {}): LaunchScope {
  return { enabled: true, areaKeys: [], categorySlugs: [], ...over };
}

describe("the scope rule", () => {
  it("opens everything when it is off, whatever the arrays say", () => {
    /* Both halves: an off scope with an empty list and an off scope with a
       narrow one. The second is the real state after somebody turns it off —
       the lists are kept so turning it back on restores the same plan — and a
       rule reading them anyway would quietly re-narrow the product. */
    expect(scopeAllows(SCOPE_OFF, "area", "kathmandu-4")).toBe(true);
    expect(scopeAllows(SCOPE_OFF, "category", "plumbing")).toBe(true);

    const parked = scope({ enabled: false, areaKeys: ["lalitpur-3"] });
    expect(scopeAllows(parked, "area", "kathmandu-4")).toBe(true);
    expect(scopeAllows(parked, "category", "plumbing")).toBe(true);
  });

  it("opens nothing when it is on and the list is empty", () => {
    /*
     * THE OTHER DIRECTION OF THE SAME INVARIANT. If an empty array were read as
     * "no scope", this would be `true` and the case above would still pass —
     * which is why both are here. Enabled-with-nothing-open is a real state
     * somebody may want on a bad morning, not an accident to be forgiven.
     */
    expect(scopeAllows(scope(), "area", "kathmandu-4")).toBe(false);
    expect(scopeAllows(scope(), "category", "plumbing")).toBe(false);
  });

  it("keeps the two lists apart", () => {
    /* One predicate over both kinds, so the case that matters is a key opened
       on one side not leaking to the other — a trade slug that happens to match
       a ward key would otherwise open both. */
    const narrow = scope({ areaKeys: ["plumbing"], categorySlugs: ["kathmandu-4"] });
    expect(scopeAllows(narrow, "area", "kathmandu-4")).toBe(false);
    expect(scopeAllows(narrow, "category", "plumbing")).toBe(false);
    expect(scopeAllows(narrow, "area", "plumbing")).toBe(true);
  });

  it("says a scope holding nothing back is not narrowing", () => {
    /* A scope that is ON and names everything live narrows nothing, and
       announcing "soft launch active" over it is the warning that teaches
       people to ignore warnings. */
    const everything = scope({ areaKeys: WARDS, categorySlugs: TRADES });
    expect(scopeNarrows(everything, WARDS, TRADES)).toBe(false);
    expect(scopeStanding(everything, WARDS, TRADES)).toBe("open");
  });

  it("notices a ward added after the scope was set", () => {
    /*
     * THE CASE A STORED FLAG WOULD GET WRONG. `scopeNarrows` is computed
     * against the live lists rather than stored, so opening a sixteenth ward on
     * `/admin/areas` makes an until-then-complete scope start holding something
     * back — without anybody touching this screen. A cached "narrows: false"
     * would have gone on saying the product was fully open.
     */
    const everything = scope({ areaKeys: WARDS, categorySlugs: TRADES });
    expect(scopeNarrows(everything, [...WARDS, "bhaktapur-1"], TRADES)).toBe(true);
  });

  it("ignores a retired ward still named in the scope", () => {
    /* A scope may name a retired key — the reads intersect it with what is
       live, so it narrows to nothing rather than resurrecting anything, and
       the admin screen deliberately keeps showing it. What must not happen is
       that key counting as coverage. */
    const stale = scope({ areaKeys: [...WARDS, "gone-9"], categorySlugs: TRADES });
    expect(scopeNarrows(stale, WARDS, TRADES)).toBe(false);
    expect(scopeStanding(stale, WARDS, TRADES)).toBe("open");
  });
});

describe("what the admin screen says before anybody saves", () => {
  it("tells `off` from `open`, because they are different facts", () => {
    /* The scope not being in force, and the scope being in force but letting
       everything through. Collapsing them would hide that somebody turned it
       on — which is the state where the next widening matters. */
    expect(scopeStanding(SCOPE_OFF, WARDS, TRADES)).toBe("off");
    expect(
      scopeStanding(scope({ areaKeys: WARDS, categorySlugs: TRADES }), WARDS, TRADES),
    ).toBe("open");
  });

  it("calls either list being empty `closed`, not `narrowed`", () => {
    /*
     * THE CASE THE SCREEN EXISTS FOR. A booking needs a ward AND a trade, so a
     * scope with three wards and no trades takes no bookings at all —
     * and reporting `narrowed` because the ward list is full would be the most
     * reassuring possible description of a shut shop. Both ways round, because
     * a rule that only looked at one list would pass one of them.
     */
    expect(
      scopeStanding(scope({ areaKeys: WARDS, categorySlugs: [] }), WARDS, TRADES),
    ).toBe("closed");
    expect(
      scopeStanding(scope({ areaKeys: [], categorySlugs: TRADES }), WARDS, TRADES),
    ).toBe("closed");
  });

  it("calls a scope whose only open ward is retired `closed`", () => {
    /*
     * The quiet way to shut the product: tick one ward, retire it on the other
     * screen, and the scope still names something. `scopeStanding` intersects
     * with the live list, so this reads `closed` rather than `narrowed` — and
     * `openAreas()` returns the same empty list the standing is describing.
     */
    const one = scope({ areaKeys: ["gone-9"], categorySlugs: TRADES });
    expect(scopeStanding(one, WARDS, TRADES)).toBe("closed");
  });

  it("adds and removes a key without reordering the rest", () => {
    /* Sorted, so two saves of the same set are the same row: otherwise the
       audit detail shows a reordering as a change and "what did we open on the
       14th" becomes a diff somebody has to do by eye. */
    const after = withKey(scope({ areaKeys: ["lalitpur-3", "kathmandu-4"] }), "area", "kathmandu-10", true);
    expect(after.areaKeys).toEqual(["kathmandu-10", "kathmandu-4", "lalitpur-3"]);

    const fewer = withKey(after, "area", "kathmandu-4", false);
    expect(fewer.areaKeys).toEqual(["kathmandu-10", "lalitpur-3"]);
    /* Removing a ward never touches the trades, and vice versa. */
    expect(fewer.categorySlugs).toEqual([]);
  });

  it("is a no-op when a key is added twice or removed twice", () => {
    const once = withKey(scope(), "category", "plumbing", true);
    expect(withKey(once, "category", "plumbing", true).categorySlugs).toEqual(["plumbing"]);
    expect(withKey(scope(), "category", "plumbing", false).categorySlugs).toEqual([]);
  });
});

/**
 * WHICH READS ARE NARROWED, read out of the sources.
 *
 * `openAreas` and `openCategories` are unreachable from a unit test — a
 * `cache()`d read behind a Supabase client with no seam, which is the same
 * limit `tests/unit/category-fallback.test.ts` records. So what is asserted is
 * the thing that actually regresses: somebody adding a customer-facing read and
 * reaching for the unscoped function because that is what the file next door
 * does.
 */
describe("the scope is applied where a customer chooses, and nowhere else", () => {
  /*
   * COMMENTS STRIPPED, which is `no-caller`'s and `provider-money-one-source`'s
   * distinction: naming `SERVICE_CATEGORIES` in order to explain why the grid
   * no longer uses it is documentation, not a read. Without this the case below
   * fails on its own explanation, and the obvious fix — deleting the comment —
   * would throw away the record of the bug.
   */
  const source = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("narrows the customer's own address and the booking write", () => {
    /* `lib/data/addresses.ts` is where a customer says where the job is, and
       `createBooking` is the public POST behind it. Both must consult the
       scoped read; the first has no other area read at all. */
    expect(source("lib/data/addresses.ts")).toContain("await openAreas()");
    expect(source("lib/data/addresses.ts")).not.toContain("await bookableAreas()");

    const bookings = source("lib/data/bookings.ts");
    expect(bookings).toContain("await openCategory(parsed.data.category)");
    expect(bookings).toContain("await openAreas()");
  });

  it("leaves a professional naming where they work unnarrowed", () => {
    /*
     * THE ASYMMETRY, AND IT IS THE POINT OF THE WHOLE FEATURE. You have to be
     * able to recruit in a ward before you can open it, so a soft launch that
     * narrowed `/providers/join` would prevent the thing that ends it. This is
     * the direction a later reader is most likely to "fix".
     */
    const leads = source("lib/data/provider-leads.ts");
    expect(leads).toContain("await bookableAreas()");
    expect(leads).not.toContain("openAreas");
  });

  it("leaves the nine admin screens reading the whole catalogue", () => {
    /*
     * `getCategories()` IS NOT NARROWED, which is why `openCategories` is a
     * separate function rather than a filter inside it. An admin getting a
     * trade ready has to see it, and narrowing the shared read would hide it
     * from exactly the people whose job is to open it.
     */
    expect(source("lib/data/categories.ts")).toContain(
      "export const getCategories = cache(",
    );
    for (const screen of ["duration", "signals", "lookup"]) {
      expect(
        source(`app/[locale]/(admin)/admin/${screen}/page.tsx`),
        `/admin/${screen} should read the unscoped catalogue`,
      ).toContain("getCategories");
    }
  });

  it("reads the table on the landing grid rather than the seed constant", () => {
    /*
     * THE BUG THIS FEATURE FOUND. The first screen anybody sees rendered
     * `SERVICE_CATEGORIES`, built from `CATEGORY_SEED` at module load, while
     * every other catalogue surface read the table — so a withdrawn trade
     * stayed advertised there and a band moved on `/admin/bands` never reached
     * it. Pinned as behaviour because the seed import is the easy thing to
     * reach for and the page looks perfect either way.
     */
    const landing = source("app/[locale]/page.tsx");
    expect(landing).toContain("openCategories()");
    expect(landing).not.toContain("SERVICE_CATEGORIES");
  });

  it("refuses the booking flow on an unreadable scope rather than opening it", () => {
    /* `/book` takes the booking, so it joins the existing refusal instead of
       falling back to the whole catalogue the way the landing grid does. */
    const book = source("app/[locale]/(app)/book/page.tsx");
    expect(book).toContain("scopeUnreadable");
    expect(book).toContain("|| scopeUnreadable");
  });
});
