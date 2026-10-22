import { describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_TONES,
  announcementBody,
  announcementStanding,
  bannerFor,
  isoToNepalStamp,
  nepalStampToIso,
  showingNow,
  type Announcement,
} from "@/lib/config/announcements";

/**
 * The rule that decides whether a sentence goes above every page.
 *
 * WHAT IS WORTH ASSERTING HERE. Three things, and none of them is "the function
 * returns a boolean". The window is half-open, so two banners handed over at the
 * same instant do not both show. The switch is independent of the window, which
 * is the pair `categories` had to tie by constraint and this one must not. And
 * `bannerFor` picks exactly one, in a stated order, because two banners stacked
 * above a page is two things nobody reads.
 */

function make(over: Partial<Announcement> = {}): Announcement {
  return {
    id: "a",
    bodyEn: "We are closed for Dashain.",
    bodyNe: "दसैंमा बन्द छ।",
    audience: "everyone",
    tone: "notice",
    startsAt: "2026-10-20T00:00:00.000Z",
    endsAt: null,
    enabled: true,
    ...over,
  };
}

const NOW = new Date("2026-10-22T06:00:00.000Z");
const CUSTOMER = { now: NOW, viewer: "customer" } as const;
const PROVIDER = { now: NOW, viewer: "provider" } as const;

describe("showingNow", () => {
  it("shows a live banner to the audience it names", () => {
    expect(showingNow(make(), CUSTOMER)).toBe(true);
    expect(showingNow(make({ audience: "customer" }), CUSTOMER)).toBe(true);
    expect(showingNow(make({ audience: "provider" }), PROVIDER)).toBe(true);
  });

  it("never shows a banner to the half it is not for", () => {
    /*
     * THE DISCLOSURE CASE. "Payouts are a day late this week" is a provider
     * banner, and a customer reading that we are behind on paying people is not
     * a notice — it is a disclosure. This is the whole reason the audience is a
     * stored column rather than a guess at each mount.
     */
    expect(showingNow(make({ audience: "provider" }), CUSTOMER)).toBe(false);
    expect(showingNow(make({ audience: "customer" }), PROVIDER)).toBe(false);
  });

  it("is off when the switch is off, inside its own window", () => {
    /*
     * THE PAIR THAT MUST STAY INDEPENDENT. The window still says this banner
     * was meant to be showing; `enabled` says somebody took it down. Reading
     * the take-down as a shortened window would lose which of the two
     * happened — the reason `categories` needed its pair tied and this one
     * needs it loose.
     */
    expect(showingNow(make({ enabled: false }), CUSTOMER)).toBe(false);
  });

  it("is half-open: live at the start instant, finished at the end instant", () => {
    const at = { now: new Date("2026-10-22T06:00:00.000Z"), viewer: "customer" } as const;

    expect(
      showingNow(make({ startsAt: "2026-10-22T06:00:00.000Z" }), at),
    ).toBe(true);
    expect(
      showingNow(make({ startsAt: "2026-10-22T06:00:00.001Z" }), at),
    ).toBe(false);
    expect(
      showingNow(
        make({ startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-22T06:00:00.000Z" }),
        at,
      ),
    ).toBe(false);
    expect(
      showingNow(
        make({ startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-22T06:00:00.001Z" }),
        at,
      ),
    ).toBe(true);
  });

  it("shows nothing for a stamp it cannot read", () => {
    /*
     * THE `ACKNOWLEDGED_FAILURES` LESSON POINTED THE OTHER WAY. Every
     * comparison with NaN is false, so an unreadable date there read as "well
     * inside the window" and forgave every acknowledgement at once. A banner is
     * something we chose to say, so a row nobody can place in time is a row
     * nobody should be shown.
     */
    expect(showingNow(make({ startsAt: "soon" }), CUSTOMER)).toBe(false);
    expect(showingNow(make({ endsAt: "whenever" }), CUSTOMER)).toBe(false);
  });
});

describe("bannerFor", () => {
  it("is null when there is nothing to say, which is most days", () => {
    expect(bannerFor([], CUSTOMER)).toBeNull();
    expect(bannerFor([make({ enabled: false })], CUSTOMER)).toBeNull();
    expect(bannerFor([make({ audience: "provider" })], CUSTOMER)).toBeNull();
  });

  it("picks urgent over ordinary even when the ordinary one is newer", () => {
    /*
     * THE CASE THAT WOULD PASS UNDER ANY ORDER IF IT WERE WRITTEN LAZILY. Both
     * are showing; the notice started later. Tone has to win, or "do not use
     * the gas line in Baneshwor until Friday" sits underneath "we have added
     * two new wards" — and only one of those is a thing somebody must read
     * today.
     */
    const picked = bannerFor(
      [
        make({ id: "notice", tone: "notice", startsAt: "2026-10-21T00:00:00.000Z" }),
        make({ id: "urgent", tone: "urgent", startsAt: "2026-10-20T00:00:00.000Z" }),
      ],
      CUSTOMER,
    );
    expect(picked?.id).toBe("urgent");
  });

  it("picks the newest among equals, and settles a dead tie by id", () => {
    const newer = bannerFor(
      [
        make({ id: "old", startsAt: "2026-10-20T00:00:00.000Z" }),
        make({ id: "new", startsAt: "2026-10-21T00:00:00.000Z" }),
      ],
      CUSTOMER,
    );
    expect(newer?.id).toBe("new");

    /*
     * A DEAD TIE IS SETTLED HERE AND NOT BY THE DATABASE'S ROW ORDER. Two
     * banners published in the same second would otherwise render differently
     * on two instances, which is the kind of difference nobody can reproduce.
     * Asserted in both input orders, since a reduce that simply kept the first
     * would pass one of them.
     */
    const a = [make({ id: "aaa" }), make({ id: "bbb" })];
    expect(bannerFor(a, CUSTOMER)?.id).toBe("bbb");
    expect(bannerFor([...a].reverse(), CUSTOMER)?.id).toBe("bbb");
  });

  it("answers each half of the product separately from one list", () => {
    const rows = [
      make({ id: "cust", audience: "customer" }),
      make({ id: "prov", audience: "provider", tone: "urgent" }),
    ];
    expect(bannerFor(rows, CUSTOMER)?.id).toBe("cust");
    expect(bannerFor(rows, PROVIDER)?.id).toBe("prov");
  });
});

describe("announcementBody", () => {
  it("gives a Nepali reader the Nepali sentence", () => {
    const one = make();
    expect(announcementBody(one, "ne")).toBe(one.bodyNe);
    expect(announcementBody(one, "en")).toBe(one.bodyEn);
  });
});

describe("announcementStanding", () => {
  it("calls a provider banner showing, although no admin sees one", () => {
    /*
     * IT ASKS BOTH VIEWERS. The admin list is answering "is this live at all",
     * not "is this live for me" — a screen that reported a provider banner as
     * finished because the reader is not a professional would be the one place
     * somebody goes to check whether a banner is up.
     */
    expect(announcementStanding(make({ audience: "provider" }), NOW)).toBe(
      "showing",
    );
  });

  it("tells a banner that has not started from one that is over", () => {
    expect(
      announcementStanding(make({ startsAt: "2026-11-01T00:00:00.000Z" }), NOW),
    ).toBe("scheduled");
    expect(
      announcementStanding(make({ endsAt: "2026-10-21T00:00:00.000Z" }), NOW),
    ).toBe("over");
  });

  it("calls a withdrawn future banner over rather than scheduled", () => {
    /*
     * A BANNER SOMEBODY TOOK DOWN BEFORE IT STARTED IS NOT WAITING TO HAPPEN.
     * `scheduled` is a promise that it will appear, and printing it over a row
     * whose switch is off would be the screen telling somebody a banner is
     * coming that never will.
     */
    expect(
      announcementStanding(
        make({ startsAt: "2026-11-01T00:00:00.000Z", enabled: false }),
        NOW,
      ),
    ).toBe("over");
  });
});

describe("the Nepal-time boxes", () => {
  it("reads a datetime-local box as Nepal time and not as UTC", () => {
    /*
     * THE WHOLE POINT, AND THE FIGURE IS WRITTEN OUT RATHER THAN DERIVED.
     * `<input type="datetime-local">` submits a zone-less string and Vercel runs
     * with `TZ` unset, so `Date.parse` would have read 09:00 as 09:00 UTC —
     * 14:45 in Kathmandu, which is late by exactly the amount nobody checks.
     * Computing the expectation from `NEPAL_UTC_OFFSET_MINUTES` would make this
     * a test that the constant equals itself.
     */
    expect(nepalStampToIso("2026-10-25T09:00")).toBe("2026-10-25T03:15:00.000Z");
    expect(nepalStampToIso("2026-01-01T00:00")).toBe("2025-12-31T18:15:00.000Z");
  });

  it("round-trips an instant back into the box it came from", () => {
    for (const typed of [
      "2026-10-25T09:00",
      "2026-01-01T00:00",
      "2027-02-28T23:59",
    ]) {
      const iso = nepalStampToIso(typed);
      expect(typeof iso).toBe("string");
      expect(isoToNepalStamp(iso as string)).toBe(typed);
    }
  });

  it("empties to null and refuses anything that is not a time", () => {
    expect(nepalStampToIso("")).toBeNull();
    expect(nepalStampToIso("   ")).toBeNull();
    expect(nepalStampToIso("tomorrow")).toBe(false);
    expect(nepalStampToIso("2026-10-25")).toBe(false);
  });

  it("refuses a date that would silently roll over into another month", () => {
    /*
     * `Date.UTC` ACCEPTS MONTH 13 AND DAY 40 AND ROLLS THEM. Without the
     * round-trip check, "2026-13-40T00:00" would become a real instant in 2027
     * — a date somebody did not type, on a banner nobody could explain. Same
     * shape as `addAreaAction` parsing a ward number rather than rounding it.
     */
    expect(nepalStampToIso("2026-13-40T00:00")).toBe(false);
    expect(nepalStampToIso("2026-02-30T12:00")).toBe(false);
    expect(nepalStampToIso("2026-10-25T25:00")).toBe(false);
  });

  it("gives an empty box for a stored value it cannot read", () => {
    expect(isoToNepalStamp("not a date")).toBe("");
  });
});

describe("the two closed sets", () => {
  it("offers exactly the values the column admits", () => {
    /*
     * ONE LIST WRITTEN TWICE, and the SQL half is compared in
     * `tests/db/announcements.test.ts` against `pg_constraint` rather than
     * against a migration file. This half pins the contents, so widening the
     * TypeScript list without the SQL fails there in the same run — the shape
     * `REFUSAL_REASON_CODES` already uses, because a value the form offers and
     * the column refuses loses the banner in the statement that wrote it.
     */
    expect([...ANNOUNCEMENT_AUDIENCES]).toEqual([
      "customer",
      "provider",
      "everyone",
    ]);
    expect([...ANNOUNCEMENT_TONES]).toEqual(["notice", "urgent"]);
  });
});
