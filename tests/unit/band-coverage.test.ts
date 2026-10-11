import { describe, expect, it } from "vitest";

import { BAND_SOURCES } from "@/lib/booking";

/**
 * Every new booking gets asked which product it is.
 *
 * THE GAP, MEASURED BEFORE IT WAS CLOSED. 2 of 14 bookings carried a
 * `band_slug`. Not because customers would not say — because **nothing asked
 * them**: the "which of these is it?" question lived only on the triage card,
 * so anybody who tapped a category on `/services` reached a booking with no
 * product and no prompt. The AI ceilings then made that the common path, by
 * suppressing or refusing the card for anybody out of free questions.
 *
 * Everything measured per sub-band reads that column — observed durations,
 * per-product bands, the multi-day span — so a seventh of the work was feeding
 * all of them.
 */

async function read(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("the flow asks which product", () => {
  it("puts the question in the step, not only on the triage card", async () => {
    const step = await read("components/booking/step-problem.tsx");
    expect(step).toContain("bandQuestion");
    expect(step, "the answer has to record who gave it").toContain(
      'bandSource: "customer"',
    );
  });

  /**
   * SKIPPABLE, AND THE SKIP WRITES NULL. `booking_refusals.reason_code` settled
   * this already: forcing a choice pushes everybody onto whichever option is
   * least wrong and makes the column meaningless. A product nobody could name
   * is an ordinary answer, not a gap to be filled with a guess.
   */
  it("offers a way out that records nothing", async () => {
    const step = await read("components/booking/step-problem.tsx");
    expect(step).toContain("bandUnsure");
    expect(step).toMatch(/band: null,\s*bandSource: null,\s*asked: true/);
  });

  /** Asked once. `asked` is what stops it reappearing after an answer. */
  it("does not ask again once it has been answered or declined", async () => {
    const step = await read("components/booking/step-problem.tsx");
    expect(step).toMatch(/!asked && !band/);
  });

  /** A survey trade sells no products, so it is never asked. */
  it("sends no products for a survey trade", async () => {
    const page = await read("app/[locale]/(app)/book/page.tsx");
    expect(page).toMatch(/subBands: survey\s*\?\s*\[\]/);
  });
});

describe("a product always records who named it", () => {
  /**
   * THE LIVE BUG THIS CAME FROM. `SK-RDKW7` carries `band_slug = burst` and a
   * null source, written two days AFTER the column existed — so not the usual
   * "the column shipped later" silence. A guarantee visit copied the parent's
   * band and not its provenance.
   */
  it("gives a guarantee visit its own source rather than the parent's", async () => {
    const claims = await read("lib/data/claims.ts");
    expect(claims).toContain('band_source: parent.band_slug ? "inherited" : null');
    /* Not the parent's own source: the model, matcher or customer who named the
       original said nothing about the callback. */
    expect(claims).not.toContain("band_source: parent.band_source");
  });

  it("knows inherited as a source", () => {
    expect(BAND_SOURCES).toContain("inherited");
  });

  /**
   * ONE LIST WRITTEN TWICE — `BAND_SOURCES` and `bookings_band_source_check`.
   * The migration is read rather than trusted, and the LAST definition wins,
   * because this constraint has been redefined three times and editing an
   * earlier one changes nothing.
   */
  it("matches the check constraint's last definition", async () => {
    const { readdir } = await import("node:fs/promises");
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    let found: string[] | null = null;
    for (const file of files) {
      const sql = await read(`supabase/migrations/${file}`);
      for (const match of sql.matchAll(
        /band_source\s+in\s*\(([^)]*)\)/g,
      )) {
        found = [...match[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
      }
    }

    expect(found, "no band_source check constraint found").not.toBeNull();
    expect([...(found ?? [])].sort()).toEqual([...BAND_SOURCES].sort());
  });
});
