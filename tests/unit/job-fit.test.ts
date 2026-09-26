import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import {
  NEWCOMER_SLOT_INDEX,
  rankProviders,
  sortProviders,
} from "@/lib/data/ranking";
import {
  REFUSAL_REASON_CODES,
  isRefusalReasonCode,
  fitRank,
  isBookable,
  jobFit,
  showsInList,
  type Fit,
  type FitReason,
} from "@/lib/provider";

/**
 * Can this professional do THIS job.
 *
 * WHAT THIS GUARDS. `canServeAt`, `hasRoom` and `providerCapacity` all existed
 * and all ran at claim time — and the catalogue called none of them. So
 * `/services/plumbing` could rank first somebody whose window was already
 * promised to another customer; the customer taps, and the database refuses the
 * insert. The list and the database disagreed about who was bookable and the
 * customer found out at the confirm button.
 *
 * THE MIDDLE ANSWER IS THE POINT. A binary gate would either hide people who
 * are perfectly bookable on Thursday because they are on a job now, or show
 * people whose slot is already sold. `caution` is what lets the row stay,
 * carrying its reason.
 */

const AT = new Date("2026-04-01T10:00:00.000Z");
const LATER_TODAY = new Date("2026-04-01T16:00:00.000Z");
const THURSDAY = new Date("2026-04-03T10:00:00.000Z");

const fit = (over: {
  categories?: string[];
  availability?: "now" | "today" | "on_job" | "busy" | "scheduled";
  busyUntil?: Date | null;
  categorySlug?: string;
  urgency?: string | null;
  when?: Date | null;
  windowFull?: boolean;
  refusedBy?: string[];
  providerId?: string;
}): Fit =>
  jobFit({
    provider: {
      categories: over.categories ?? ["plumbing"],
      availability: over.availability ?? "now",
      busyUntil: over.busyUntil ?? null,
    },
    job: {
      categorySlug: over.categorySlug ?? "plumbing",
      urgency: over.urgency ?? "soon",
      when: over.when ?? null,
      windowFull: over.windowFull,
      refusedBy: over.refusedBy,
    },
    providerId: over.providerId,
    at: AT,
  });

describe("the plain yes", () => {
  it("is ok when they do the trade and can come", () => {
    expect(fit({})).toEqual({ fit: "ok" });
  });

  /*
   * A NEW PROFESSIONAL IS QUALIFIED. Nothing in this gate reads a rating, a
   * completion rate or a job count — those are judgements on small samples and
   * they order the list, they never decide who is on it. A cold-start filter
   * would make the loop that `withNewcomerSlot` exists to break unbreakable.
   */
  it("never excludes somebody for having no history", () => {
    // There is no history input to pass. That is the assertion: the type has
    // no room for one, so no later edit can quietly add a competence gate.
    expect(fit({ availability: "scheduled" })).toEqual({ fit: "ok" });
  });
});

describe("the trade", () => {
  it("blocks somebody who does not do this work", () => {
    const result = fit({ categories: ["electrical"], categorySlug: "plumbing" });
    expect(result).toEqual({
      fit: "blocked",
      why: "notThisTrade",
      freeFrom: null,
    });
  });
});

describe("a refusal is blocking and silent", () => {
  const REFUSER = "prov-1";

  it("blocks somebody who already turned this job down", () => {
    const result = fit({ providerId: REFUSER, refusedBy: [REFUSER] });
    expect(result.fit).toBe("blocked");
    expect(result.fit !== "ok" && result.why).toBe("alreadyRefused");
  });

  /*
   * THE ONE EXCLUSION THAT IS NOT SHOWN, and the only one. Telling a customer
   * "this professional turned your job down" is bruising to no purpose on a
   * screen they are already unhappy to be reading, and the database would
   * refuse the reassignment anyway.
   */
  it("is the only reason hidden from the list", () => {
    expect(showsInList(fit({ providerId: REFUSER, refusedBy: [REFUSER] }))).toBe(
      false,
    );
    expect(showsInList(fit({ availability: "on_job", when: null }))).toBe(true);
    expect(showsInList(fit({ windowFull: true }))).toBe(true);
    expect(showsInList(fit({ categories: ["electrical"] }))).toBe(true);
  });

  it("does not block somebody else's refusal", () => {
    expect(fit({ providerId: "prov-2", refusedBy: [REFUSER] })).toEqual({
      fit: "ok",
    });
  });
});

describe("a full window blocks at every urgency", () => {
  /*
   * THE REASON THIS GATE EXISTS AT ALL. `enforce_slot_capacity` refuses the
   * insert whatever the screen says, so carrying on past it means walking
   * somebody through a confirm button that cannot succeed.
   */
  it("blocks a routine booking, not only an emergency", () => {
    for (const urgency of ["routine", "soon", "emergency"]) {
      const result = fit({ windowFull: true, urgency });
      expect(result.fit).toBe("blocked");
      expect(result.fit !== "ok" && result.why).toBe("full");
    }
  });

  /*
   * UNDEFINED IS "NOBODY ASKED", NOT "THERE IS ROOM" — the distinction
   * `ServingInput.windowFull` already draws. The catalogue does not read held
   * windows, so it must not get an answer that pretends it checked.
   */
  it("says nothing about capacity when nobody asked", () => {
    expect(fit({ windowFull: undefined })).toEqual({ fit: "ok" });
  });
});

describe("being busy now says nothing about Thursday", () => {
  it("cautions rather than blocks an on-job professional on a routine job", () => {
    const result = fit({ availability: "on_job", urgency: "soon", when: null });
    expect(result.fit).toBe("caution");
    expect(result.fit !== "ok" && result.why).toBe("onJobNow");
    expect(isBookable(result)).toBe(true);
  });

  it("blocks the same professional on an emergency", () => {
    // The customer has already told us the answer by choosing emergency, and
    // that is the permission to be decisive.
    const result = fit({ availability: "on_job", urgency: "emergency" });
    expect(result.fit).toBe("blocked");
  });

  /*
   * THE BRANCH MOST EASILY BROKEN BY A CARELESS EDIT. Somebody on a job at 11am
   * can do a job on Thursday, and refusing to let the busiest people be booked
   * would take work from exactly the professionals the platform runs on.
   */
  it("is a plain yes for a future slot", () => {
    expect(fit({ availability: "on_job", when: THURSDAY })).toEqual({
      fit: "ok",
    });
  });

  it("cautions when the chosen slot falls inside a declared busy window", () => {
    const result = fit({
      availability: "busy",
      busyUntil: new Date("2026-04-01T18:00:00.000Z"),
      when: LATER_TODAY,
    });
    expect(result.fit).toBe("caution");
    expect(result.fit !== "ok" && result.why).toBe("busyThen");
    // The screen can say when they are free again.
    expect(result.fit !== "ok" && result.freeFrom).toBeInstanceOf(Date);
  });
});

/**
 * The catalogue and the booking flow know different things, and the coarse
 * answer must not pretend otherwise.
 */
describe("two moments, two amounts of knowledge", () => {
  it("answers the coarse question with no slot and no capacity", () => {
    // `/services/[slug]` before a slot is picked: can they come at all.
    const coarse = fit({ availability: "on_job", when: null, urgency: "soon" });
    expect(coarse.fit).toBe("caution");
  });

  it("gives a different and better answer once the slot is known", () => {
    // The same professional, the same state, a Thursday slot: a plain yes that
    // the catalogue could not have known to give.
    const exact = fit({ availability: "on_job", when: THURSDAY });
    expect(exact).toEqual({ fit: "ok" });
  });
});

describe("ordering, not filtering", () => {
  it("puts plain yeses above cautions above blocked", () => {
    const ok = fit({});
    const caution = fit({ availability: "on_job", when: null });
    const blocked = fit({ windowFull: true });

    expect(fitRank(ok)).toBeLessThan(fitRank(caution));
    expect(fitRank(caution)).toBeLessThan(fitRank(blocked));
  });

  it("gives every bookable row the same rank regardless of reason", () => {
    // Within a band the ordinary relevance score decides. This must never
    // reorder two professionals who are equally bookable.
    expect(fitRank(fit({ availability: "on_job", when: null }))).toBe(
      fitRank(
        fit({
          availability: "busy",
          busyUntil: new Date("2026-04-01T18:00:00.000Z"),
          when: LATER_TODAY,
        }),
      ),
    );
  });
});

/**
 * Every reason is reachable, so none is dead code and none is unhandled copy.
 *
 * A `FitReason` with no way to produce it is a string in a message catalogue
 * nobody will ever see; one that cannot be rendered is a blank line on a card.
 */
describe("every reason the type allows can actually happen", () => {
  it("produces all five", () => {
    const produced = new Set<FitReason>();
    for (const result of [
      fit({ categories: ["electrical"] }),
      fit({ providerId: "p", refusedBy: ["p"] }),
      fit({ windowFull: true }),
      fit({ availability: "on_job", when: null }),
      fit({ availability: "busy", when: null }),
      fit({
        availability: "busy",
        busyUntil: new Date("2026-04-01T18:00:00.000Z"),
        when: LATER_TODAY,
      }),
    ]) {
      if (result.fit !== "ok") produced.add(result.why);
    }

    expect(Array.from(produced).sort()).toEqual([
      "alreadyRefused",
      "busyNow",
      "busyThen",
      "full",
      "notThisTrade",
      "onJobNow",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * The gate reaching the list
 * ------------------------------------------------------------------ */

describe("fit orders the list without filtering it", () => {
  const listed = (over: {
    id: string;
    baseRate?: number;
    jobsCompleted?: number;
    ratingAvg?: number;
    ratingCount?: number;
  }) =>
    ({
      id: over.id,
      serviceAreas: ["lalitpur-4"],
      availability: "now",
      isVerified: false,
      baseRate: over.baseRate ?? 1000,
      stats: {
        ratingAvg: over.ratingAvg ?? 0,
        ratingCount: over.ratingCount ?? 0,
        jobsCompleted: over.jobsCompleted ?? 20,
        completionRate: 0,
        avgResponseMinutes: 120,
        responseSamples: 0,
        lastActiveMinutesAgo: 5,
        jobsAccepted: 20,
        withdrawals: 0,
        overbookOffers: 0,
        overbookMisses: 0,
        offersMade: 0,
        offersAnswered: 0,
      },
    }) as unknown as Provider;

  const STRONG = listed({ id: "strong", ratingAvg: 4.9, ratingCount: 200 });
  const WEAK = listed({ id: "weak", ratingAvg: 4.0, ratingCount: 200 });

  it("puts a blocked professional below a weaker bookable one", () => {
    // The whole point: the best-scoring person whose window is already sold
    // cannot be the top result, because the database refuses the insert.
    const ranked = rankProviders([STRONG, WEAK], {
      fit: (p) =>
        p.id === "strong"
          ? { fit: "blocked", why: "full", freeFrom: null }
          : { fit: "ok" },
    });
    expect(ranked.map((p) => p.id)).toEqual(["weak", "strong"]);
  });

  it("keeps them in the list, carrying the reason", () => {
    const ranked = rankProviders([STRONG, WEAK], {
      fit: (p) =>
        p.id === "strong"
          ? { fit: "blocked", why: "full", freeFrom: null }
          : { fit: "ok" },
    });
    expect(ranked).toHaveLength(2);
    const strong = ranked.find((p) => p.id === "strong")!;
    expect(strong.fit.fit !== "ok" && strong.fit.why).toBe("full");
  });

  it("does not reorder two equally bookable professionals", () => {
    // Within a band the ordinary score still decides.
    const ranked = rankProviders([WEAK, STRONG], {
      fit: () => ({ fit: "caution", why: "onJobNow", freeFrom: null }),
    });
    expect(ranked.map((p) => p.id)).toEqual(["strong", "weak"]);
  });

  it("treats every row as a plain yes when nobody asked", () => {
    const ranked = rankProviders([STRONG, WEAK]);
    expect(ranked.every((p) => p.fit.fit === "ok")).toBe(true);
  });

  /*
   * THE SLOT MUST NOT BECOME WHERE THE UNBOOKABLE PEOPLE ARE. It exists so
   * somebody untested is seen; promoting one who cannot take the job spends the
   * reserved position on a row the customer cannot act on.
   */
  it("does not promote a blocked newcomer into the reserved slot", () => {
    const newcomer = listed({ id: "newcomer", jobsCompleted: 0 });
    const others = ["a", "b", "c", "d"].map((id) =>
      listed({ id, ratingAvg: 4.8, ratingCount: 100 }),
    );

    const ranked = rankProviders([...others, newcomer], {
      fit: (p) =>
        p.id === "newcomer"
          ? { fit: "blocked", why: "full", freeFrom: null }
          : { fit: "ok" },
    });
    expect(ranked[NEWCOMER_SLOT_INDEX].id).not.toBe("newcomer");
    expect(ranked[ranked.length - 1].id).toBe("newcomer");
  });

  it("still promotes a bookable newcomer", () => {
    const newcomer = listed({ id: "newcomer", jobsCompleted: 0 });
    const others = ["a", "b", "c", "d"].map((id) =>
      listed({ id, ratingAvg: 4.8, ratingCount: 100 }),
    );
    const ranked = rankProviders([...others, newcomer], { fit: () => ({ fit: "ok" }) });
    expect(ranked[NEWCOMER_SLOT_INDEX].id).toBe("newcomer");
  });

  /*
   * AN EXPLICIT SORT IS A REQUEST ABOUT ORDERING, NOT A REQUEST TO BE SHOWN
   * OPTIONS THAT DO NOT EXIST. "Cheapest first" must not put somebody whose
   * window is sold into the position the customer just said they trust most.
   */
  it("keeps blocked rows last even when the customer sorts by price", () => {
    const cheap = listed({ id: "cheap", baseRate: 200 });
    const dear = listed({ id: "dear", baseRate: 5000 });
    const sorted = sortProviders([cheap, dear], "price", {
      fit: (p) =>
        p.id === "cheap"
          ? { fit: "blocked", why: "full", freeFrom: null }
          : { fit: "ok" },
    });
    expect(sorted.map((p) => p.id)).toEqual(["dear", "cheap"]);
  });
});

/* ------------------------------------------------------------------ *
 * The refusal reasons
 * ------------------------------------------------------------------ */

describe("a refusal reason that can be counted", () => {
  it("accepts every code the database allows", () => {
    for (const code of REFUSAL_REASON_CODES) {
      expect(isRefusalReasonCode(code)).toBe(true);
    }
  });

  /*
   * THE GUARD MATTERS BECAUSE THE WRITE IS SHARED WITH THE PROSE. A value
   * outside the set is refused by `booking_refusals_reason_code_known` and takes
   * the whole update with it — losing the free text the professional actually
   * typed, to record a diagnostic. Null is already "not recorded", so falling
   * back to it costs a count and nothing else.
   */
  it("refuses anything else, so a bad value cannot lose the prose", () => {
    for (const bad of ["", "TOO_FAR", "too far", "unknown", null, undefined, 3]) {
      expect(isRefusalReasonCode(bad)).toBe(false);
    }
  });

  /*
   * THE CHIPS AND THE COLUMN CANNOT DRIFT. The decline panel renders one chip
   * per `REFUSAL_REASON_CODES` entry and looks its label up by the code, so a
   * label added to the catalogue without the SQL would render a chip the check
   * constraint refuses — and because the code shares a statement with the free
   * text, that write loses the prose the professional actually typed. This
   * asserts the offered set IS the loggable set rather than a subset of it.
   */
  it("offers exactly the codes the database accepts", async () => {
    const en = (await import("@/messages/en.json")).default;
    const labels: Record<string, string> = en.provider.jobs.decline.why;

    expect(Object.keys(labels).sort()).toEqual([...REFUSAL_REASON_CODES].sort());
    for (const code of REFUSAL_REASON_CODES) {
      expect(labels[code]).toBeTruthy();
    }
  });

  it("is the same list the migration carries", async () => {
    // Two lists written twice drift silently and fail on the first production
    // write that produces the new value. This reads the SQL.
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20260927000001_refusal_reason_code.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const list = sql.match(/reason_code in \(([\s\S]*?)\)/)?.[1] ?? "";
    const inSql = (list.match(/'[a-z_]+'/g) ?? [])
      .map((quoted) => quoted.slice(1, -1))
      .sort();
    expect(inSql).toEqual([...REFUSAL_REASON_CODES].sort());
  });
});
