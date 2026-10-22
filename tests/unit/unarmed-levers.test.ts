import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PAYOUT_RUN } from "@/lib/config/payout-policy";
import { UNARMED_LEVERS } from "@/lib/config/unarmed-levers";
import { maxFailedChecksPerPeriod } from "@/lib/photos/evidence";
import { TRIP_COMPENSATION } from "@/lib/abuse/trip";

/**
 * The levers that are null because nobody has chosen a number.
 *
 * WHAT THIS IS PROVING, AND IT IS NOT "A CONSTANT EQUALS ITSELF". Three
 * constants claim, in prose, that they are unarmed and that nothing reads them.
 * That claim was already false once in the expensive way: `dispatchPauseFor`
 * sat beside `arrearsPauseRupees` with no caller and a comment asserting a test
 * that did not exist, so the safety it described was never exercised. A claim
 * nothing checks is a claim that drifts, and this one is on levers that decide
 * whether somebody gets work or gets paid.
 *
 * FOUR CASES, AND THE COVERAGE ONE IS THE POINT. A list of three is a list that
 * goes stale on the fourth constant, so the sources are scanned and an unarmed
 * lever nobody has declared fails here — `money-assertions`' arrangement, for
 * the same reason: the question "and what would arm this?" has to be asked when
 * the constant is invented rather than five phases later.
 */

const LIB = path.join(process.cwd(), "lib");

function tsFiles(dir: string): string[] {
  /* `fs.globSync` exists at runtime and not in this Node's TS types — green
     under vitest and red under tsc, which is a trap this repo has already
     stepped in. A plain walk is portable. */
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

const SOURCES = tsFiles(LIB).map((file) => ({
  file: path.relative(process.cwd(), file),
  text: readFileSync(file, "utf8"),
}));

/**
 * A module-level binding typed `number | null` and initialised to null.
 *
 * TWO SPELLINGS, BECAUSE THE REPO USES BOTH: a standalone `export const x:
 * number | null = null` and a property inside an `as const` object written
 * `x: null as number | null`. A pattern that caught one would print a clean
 * tick over the other, which is how `MAINTAIN` nearly got away in the grants
 * audit.
 */
const DECLARATIONS = [
  /(?:export\s+const\s+)([A-Za-z_$][\w$]*)\s*:\s*number\s*\|\s*null\s*=\s*null/g,
  /^\s{2}([A-Za-z_$][\w$]*)\s*:\s*null\s+as\s+number\s*\|\s*null\s*,/gm,
];

function unarmedInSources(): Array<{ name: string; file: string }> {
  const found: Array<{ name: string; file: string }> = [];
  for (const { file, text } of SOURCES) {
    for (const pattern of DECLARATIONS) {
      for (const match of text.matchAll(pattern)) {
        found.push({ name: match[1], file });
      }
    }
  }
  return found;
}

describe("every unarmed lever is declared", () => {
  it("finds the ones that exist, so a pattern that stopped matching fails", () => {
    /*
     * THE COUNT FIRST. A regex that quietly stopped matching would make every
     * other case in this file pass over an empty list, which is the shape that
     * made `drift-token`'s first draft worthless.
     */
    const found = unarmedInSources();
    expect(found.length, `found: ${JSON.stringify(found)}`).toBe(
      UNARMED_LEVERS.length,
    );
  });

  it("has an entry for each, in the module it is declared in", () => {
    for (const { name, file } of unarmedInSources()) {
      const entry = UNARMED_LEVERS.find((lever) => lever.name === name);
      expect(
        entry,
        `\`${name}\` in ${file} is an unarmed lever nobody declared in ` +
          `lib/config/unarmed-levers.ts. Say where a number would act and ` +
          `what has to be true before it can — "pick a number" has never ` +
          `been the whole blocker for any of the others.`,
      ).toBeDefined();
      /* The declared module has to be the file it is actually in, or the
         inventory points a future reader at the wrong place. */
      const declared = entry!.module.replace("@/", "") + ".ts";
      expect(file, `${name}'s declared module`).toBe(declared);
    }
  });

  it("declares nothing that has since been armed or deleted", () => {
    const names = new Set(unarmedInSources().map((one) => one.name));
    for (const lever of UNARMED_LEVERS) {
      expect(
        names.has(lever.name),
        `\`${lever.name}\` is declared unarmed but no longer reads as a null ` +
          `number | null in ${lever.module}. If it was armed, this entry is ` +
          `stale and its blocker needs re-reading; if it was deleted, remove ` +
          `the entry.`,
      ).toBe(true);
    }
  });
});

describe("the live values really are null", () => {
  it("is what the declaration claims, read through the import", () => {
    /*
     * THE SOURCE SCAN ABOVE READS TEXT; THIS READS THE VALUE. They can disagree
     * — a later line could reassign, or an object could be spread over — and
     * the whole inventory is worthless if the text says null and the product
     * holds a number.
     */
    expect(PAYOUT_RUN.arrearsPauseRupees).toBeNull();
    expect(TRIP_COMPENSATION.maxPaidClaimsPerPeriod).toBeNull();
    expect(maxFailedChecksPerPeriod).toBeNull();
  });
});

describe("nothing reads an unarmed lever", () => {
  it("is named only by its own module, the inventory and this test", () => {
    /*
     * THE `dispatchPauseFor` CASE, CAUGHT BEFORE IT SHIPS RATHER THAN AFTER.
     * A reader appearing while the value is null is either dead code (the
     * function that was deleted) or a rule that silently does nothing — and
     * both read exactly like a working safety. A caller is not forbidden for
     * ever: arming a lever means a caller, a published rule and a test in one
     * commit, and this case is what makes that commit deliberate.
     */
    for (const lever of UNARMED_LEVERS) {
      const own = lever.module.replace("@/", "") + ".ts";
      const readers = SOURCES.filter(
        ({ file, text }) => file !== own && text.includes(lever.name),
      )
        /* The inventory names all three on purpose. */
        .filter(({ file }) => file !== "lib/config/unarmed-levers.ts")
        /* A comment citing another lever as "the shape an unarmed one takes"
           is documentation, not a read — the three cross-reference each other
           deliberately, and stripping comments is what tells them apart.
           `provider-money-one-source` strips them for the same reason. */
        .filter(({ text }) => withoutComments(text).includes(lever.name))
        .map(({ file }) => file);

      expect(
        readers,
        `\`${lever.name}\` is read in ${readers.join(", ")} while it is null. ` +
          `Either that reader does nothing — which is the \`dispatchPauseFor\` ` +
          `shape, a safety nobody exercises — or the lever is being armed, in ` +
          `which case: ${lever.blockedBy}.`,
      ).toEqual([]);
    }
  });
});

describe("the stated blocker is still true", () => {
  it("has a case for every blocker kind, so a new kind is not silently skipped", () => {
    /*
     * The two cases below cover `published-copy-contradicts` and
     * `nothing-to-count`. `no-published-rule` is covered by the reader case
     * above and has nothing else to assert — but a FOURTH kind added to
     * `ArmingBlocker` must not slip through on that reasoning, so the set is
     * pinned here.
     */
    expect([...new Set(UNARMED_LEVERS.map((l) => l.blockedBy))].sort()).toEqual([
      "no-published-rule",
      "nothing-to-count",
      "published-copy-contradicts",
    ]);
  });

  it("still publishes the sentence that contradicts the lever", () => {
    /*
     * THE TIE THAT MAKES THIS WORTH WRITING. `arrearsPauseRupees` would stop
     * sending somebody work; `/providers/standards` publishes that carrying a
     * balance does not. Arming the constant while that sentence is still on the
     * page is a promise broken in the product and kept on the page, which is
     * the one failure a professional would find out about by not being offered
     * work. Both halves are asserted together, so the pair cannot drift in
     * either direction.
     */
    const contradicted = UNARMED_LEVERS.filter(
      (lever) => lever.blockedBy === "published-copy-contradicts",
    );
    expect(contradicted.length).toBeGreaterThan(0);

    for (const lever of contradicted) {
      expect(lever.contradicts, `${lever.name}.contradicts`).toBeDefined();
      const text = readFileSync(lever.contradicts!.path, "utf8");
      expect(
        text.includes(lever.contradicts!.phrase),
        `${lever.contradicts!.path} no longer publishes "` +
          `${lever.contradicts!.phrase}". If the promise was deliberately ` +
          `changed, \`${lever.name}\`'s blocker is gone and the entry needs ` +
          `re-reading; if it was reworded, update the phrase.`,
      ).toBe(true);
    }
  });

  it("still has nothing to count, where that is the blocker", () => {
    /*
     * `maxFailedChecksPerPeriod` would be read against refused photographs, and
     * `guarantee_claim_photos` cannot store one — the three answers meaning
     * "this is not evidence" are unstorable there by design. If a migration
     * ever starts recording them, the number becomes arguable and this entry
     * has to be re-read; until then the lever cannot be armed by picking a
     * figure, whatever its own comment used to say.
     */
    const uncounted = UNARMED_LEVERS.filter(
      (lever) => lever.blockedBy === "nothing-to-count",
    );
    expect(uncounted.length).toBeGreaterThan(0);

    for (const lever of uncounted) {
      expect(lever.absentRecord, `${lever.name}.absentRecord`).toBeDefined();
      const text = readFileSync(lever.absentRecord!.path, "utf8");
      expect(
        text.includes(lever.absentRecord!.phrase),
        `${lever.absentRecord!.path} no longer says "` +
          `${lever.absentRecord!.phrase}" — so the record \`${lever.name}\` ` +
          `would be read against may now exist. Re-read the blocker.`,
      ).toBe(true);
    }
  });
});

/**
 * Line and block comments removed.
 *
 * Naming a constant in order to explain why it is unarmed is documentation and
 * not a read — `provider-money-one-source.test.ts` strips comments for exactly
 * this reason, where naming `provider_earning` to warn about it would otherwise
 * count as using it.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
