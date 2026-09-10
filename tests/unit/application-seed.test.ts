import { describe, expect, it } from "vitest";

import { NEPAL_DIAL_CODE, toNationalDigits } from "@/lib/auth";
import { seedFromLead, type ProviderLead } from "@/lib/verification";

/**
 * The handover from `/providers/join` to `/providers/apply`.
 *
 * The whole point of the two-door design is that nobody types their name,
 * trade, ward or years twice. If this mapping is wrong the person sees an
 * empty eight-step form after having just filled a five-field one, which is
 * worse than never having offered the head start at all.
 */

const lead: ProviderLead = {
  id: "lead-1",
  fullName: "Krishna Bahadur Tamang",
  categorySlug: "plumbing",
  areaKey: "ktm-ward-16",
  yearsExperience: 9,
};

describe("seedFromLead", () => {
  it("carries the name, ward and years across unchanged", () => {
    const patch = seedFromLead(lead);

    expect(patch.fullName).toBe("Krishna Bahadur Tamang");
    expect(patch.serviceAreas).toEqual(["ktm-ward-16"]);
    expect(patch.yearsExperience).toBe(9);
  });

  it("turns the lead's one trade into the application's trade list", () => {
    // The lead form asks for a single category; the application allows
    // several. One becomes a list of one, never a bare string.
    expect(seedFromLead(lead).trades).toEqual(["plumbing"]);
  });

  it("drops a trade the product no longer sells rather than seeding a dead slug", () => {
    // A lead written before a rename would otherwise fill the application
    // with a category that renders as nothing, and the applicant would see an
    // empty trade list with no idea why.
    const stale = seedFromLead({ ...lead, categorySlug: "chimney-sweeping" });

    expect(stale.trades).toEqual([]);
    // Everything else still comes through — one dead field must not throw the
    // rest of the head start away.
    expect(stale.fullName).toBe("Krishna Bahadur Tamang");
    expect(stale.serviceAreas).toEqual(["ktm-ward-16"]);
  });

  it("produces an empty patch when there is no lead", () => {
    // The ordinary case for anybody who came straight to /apply. Not an error,
    // and the insert must not write nulls over its own defaults.
    expect(seedFromLead(null)).toEqual({});
  });

  it("keeps zero years rather than treating it as missing", () => {
    // Somebody starting out answers 0, and `|| null` would have lost it.
    expect(seedFromLead({ ...lead, yearsExperience: 0 }).yearsExperience).toBe(0);
  });
});

describe("the lead lookup's two phone formats", () => {
  /*
   * `provider_leads.phone` is E.164 with the plus, straight from
   * `checkNepaliMobile`. `profiles.phone` is whatever Supabase Auth normalised
   * it to, which has no plus. `leadForProfile` reduces the profile's number to
   * national digits and rebuilds the E.164 form, so both spellings of one
   * number reach the same indexed equality. If that ever stops holding, every
   * professional who used the join form silently loses their head start.
   */
  const rebuild = (stored: string) =>
    `${NEPAL_DIAL_CODE}${toNationalDigits(stored)}`;

  it("resolves the profile spelling and the lead spelling to one key", () => {
    expect(rebuild("9779841234567")).toBe("+9779841234567");
    expect(rebuild("+9779841234567")).toBe("+9779841234567");
  });

  it("resolves the way somebody types it into the same key", () => {
    for (const typed of ["9841234567", "098-4123-4567", "+977 9841234567"]) {
      expect(rebuild(typed)).toBe("+9779841234567");
    }
  });

  it("refuses to look up a number that is not ten digits", () => {
    // The guard in `leadForProfile`: a short or absent number must not fall
    // through to a query matching "+977" and returning somebody else's lead.
    expect(toNationalDigits("").length).not.toBe(10);
    expect(toNationalDigits("977").length).not.toBe(10);
    expect(toNationalDigits("9841234567").length).toBe(10);
  });
});
