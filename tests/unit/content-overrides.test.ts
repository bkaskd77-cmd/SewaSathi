import { describe, expect, it } from "vitest";

import { mergeOverrides } from "@/lib/data/content";

/**
 * Laying an admin's edits over the catalogue.
 *
 * THE CATALOGUE DECIDES WHAT KEYS EXIST; THE OVERRIDE DECIDES WHAT THEY SAY. That split
 * is the whole design, and it is what keeps `check:messages` and `check:keys` guarding
 * the same thing they guarded before this feature existed — both read the JSON, and the
 * JSON is still the source of truth.
 *
 * The read itself is covered where it matters most in `content-fallback.test.ts`: a
 * table nobody can reach must render the catalogue rather than blanking the page.
 */
const CATALOGUE = {
  home: { lead: "Find a plumber", faqTitle: "Questions" },
  booking: { payment: { title: "How will you pay?" } },
  common: { from: "from" },
};

describe("merging an override over the catalogue", () => {
  it("replaces a string at a nested key", () => {
    const merged = mergeOverrides(CATALOGUE, {
      "booking.payment.title": "How would you like to pay?",
    });
    expect(merged.booking.payment.title).toBe("How would you like to pay?");
  });

  it("leaves everything it was not asked about alone", () => {
    const merged = mergeOverrides(CATALOGUE, { "home.lead": "Find a tradesperson" });
    expect(merged.home.faqTitle).toBe("Questions");
    expect(merged.common.from).toBe("from");
    expect(merged.booking.payment.title).toBe("How will you pay?");
  });

  /*
   * NO OVERRIDES IS THE COMMON CASE AND COSTS NOTHING. The table is empty until somebody
   * edits something, which on most deployments is for ever, so the merge returns the
   * catalogue itself rather than a rebuilt copy of it.
   */
  it("returns the catalogue untouched when there is nothing to apply", () => {
    expect(mergeOverrides(CATALOGUE, {})).toBe(CATALOGUE);
  });

  /*
   * THE CASE THAT KEEPS THE GUARDS HONEST. An override for a key the catalogue does not
   * have is ignored rather than added: `check:keys` resolves every `t("…")` against the
   * JSON, so a key only in the database is one no code asks for. Adding it would mean a
   * typo'd edit silently becoming a message nobody renders, leaving somebody sure they
   * fixed a line that still reads the old way.
   */
  it("ignores a key the catalogue does not have", () => {
    const merged = mergeOverrides(CATALOGUE, {
      "home.invented": "nobody renders this",
      "entirely.new.namespace": "nor this",
    });
    expect("invented" in merged.home).toBe(false);
    expect("entirely" in merged).toBe(false);
  });

  /*
   * And it never replaces a branch with a string. An override addressed at `home` rather
   * than `home.lead` would otherwise flatten a whole namespace into one line, taking
   * every key under it down with it.
   */
  it("refuses to overwrite a namespace with a string", () => {
    const merged = mergeOverrides(CATALOGUE, { home: "oops" } as Record<string, string>);
    expect(typeof merged.home).toBe("object");
    expect(merged.home.lead).toBe("Find a plumber");
  });

  it("does not mutate the catalogue it was given", () => {
    const before = JSON.stringify(CATALOGUE);
    mergeOverrides(CATALOGUE, { "home.lead": "changed" });
    expect(JSON.stringify(CATALOGUE)).toBe(before);
  });
});
