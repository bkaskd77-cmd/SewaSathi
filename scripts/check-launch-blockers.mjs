#!/usr/bin/env node
/**
 * Refuse to build a launch when LAUNCH-BLOCKERS.md still has unresolved
 * entries.
 *
 * The register exists because a `MOCK DATA` comment protects the next
 * developer and not the person reading the page. The landing page currently
 * claims 1,200 verified professionals and a 4.8 rating from 10,000 households,
 * on a public URL, with 28 invented providers in the database. That is the
 * kind of thing that is obvious in review and invisible on a Tuesday six weeks
 * later.
 *
 * So the check is structural rather than advisory. It is deliberately narrow:
 * it only bites on a build that is actually going live.
 *
 *   LAUNCH=true + NODE_ENV=production + any unresolved entry  ->  fail
 *   anything else                                             ->  report only
 *
 * Development, CI and preview deploys are unaffected. `npm run build` runs it
 * first, so it fails in a second rather than after a full compile.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const FILE = "LAUNCH-BLOCKERS.md";
const VALID_STATUS = new Set(["unresolved", "resolved"]);

/**
 * One entry is checked against the data rather than taken at its word.
 *
 * Every other entry here is resolved by a human judgement this script cannot
 * make — is the legal text reviewed, is the SMS gateway real. The price bands
 * are different: whether they are still invented is a fact recorded in the
 * seed, so a `resolved` status that disagrees with it is a lie inside the
 * register that exists to prevent lies. That check runs always, not only at
 * launch, because a false `resolved` is worse than an honest `unresolved`.
 */
const BANDS_ENTRY = "category-price-bands";
const CATEGORY_SEED = "lib/data/seed/categories.json";

function inventedCategories() {
  try {
    const raw = readFileSync(path.join(process.cwd(), CATEGORY_SEED), "utf8");
    return (
      JSON.parse(raw)
        /*
         * A SURVEY CATEGORY IS NOT AN UNPUBLISHED BAND, it is a trade that has
         * no band and says so. `pricingSource` stays `invented` there on
         * purpose — the research found no price, and stamping `researched`
         * would be exactly the dishonesty this column exists to prevent — but
         * counting it here would go on demanding a number that does not exist.
         * What has to be true instead is that nothing renders a range for it,
         * and `tests/unit/quote-floor.test.ts` is what holds that.
         */
        .filter((c) => c.pricingModel !== "survey")
        .filter((c) => (c.pricingSource ?? "invented") === "invented")
        .map((c) => c.slug)
    );
  } catch {
    // A seed that cannot be read is not evidence that the bands are researched.
    return ["<could not read the category seed>"];
  }
}

/** Fenced code blocks hold the format example, which is not an entry. */
function stripFences(markdown) {
  return markdown.replace(/^```[\s\S]*?^```/gm, "");
}

function parseEntries(markdown) {
  const body = stripFences(markdown);
  const blocks = body.split(/^### BLOCKER: /gm).slice(1);

  return blocks.map((block) => {
    const id = block.split("\n", 1)[0].trim();
    const field = (name) =>
      block.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
    return {
      id,
      status: field("Status")?.toLowerCase() ?? null,
      claims: field("Claims"),
      livesIn: field("Lives in"),
      replacedBy: field("Replaced by"),
    };
  });
}

function main() {
  const file = path.join(process.cwd(), FILE);

  let markdown;
  try {
    markdown = readFileSync(file, "utf8");
  } catch {
    console.error(
      `\n${FILE} is missing. It is the register of everything on the live site that is invented or unproven — deleting it does not resolve the entries.\n`,
    );
    process.exit(1);
  }

  const entries = parseEntries(markdown);
  const malformed = entries.filter(
    (e) =>
      !VALID_STATUS.has(e.status) || !e.claims || !e.livesIn || !e.replacedBy,
  );
  const unresolved = entries.filter((e) => e.status === "unresolved");

  const invented = inventedCategories();
  const bands = entries.find((e) => e.id === BANDS_ENTRY);

  /*
   * ONE BLOCKER CANNOT RESOLVE WHILE THE ONE IT RESTS ON IS OPEN.
   *
   * `trust-strip-counts` is only honest because the counts filter out seeded
   * fixtures — 26 of the 28 "verified" providers in the database are invented.
   * Marking it done while `seed-providers-and-reviews` is open would mean a
   * green check on the strip hiding the reason the strip has to stay empty, and
   * whoever later deleted the filter would find both checks already passing.
   */
  const DEPENDS_ON = { "trust-strip-counts": "seed-providers-and-reviews" };
  const brokenDeps = Object.entries(DEPENDS_ON).filter(([id, needs]) => {
    const entry = entries.find((e) => e.id === id);
    const dependency = entries.find((e) => e.id === needs);
    return entry?.status === "resolved" && dependency?.status !== "resolved";
  });

  const launching =
    process.env.LAUNCH === "true" && process.env.NODE_ENV === "production";

  console.log("\nLaunch blockers");
  if (entries.length === 0) {
    console.log(`  ${FILE} lists none.`);
  }
  for (const entry of entries) {
    const mark = entry.status === "resolved" ? "done" : "OPEN";
    console.log(`  ${mark}  ${entry.id}`);
  }

  for (const [id, needs] of brokenDeps) {
    console.log(
      `\n  ${id} is marked resolved, but it rests on ${needs}, which is not.` +
        `\n  The counts on that strip are only honest because they exclude the` +
        `\n  seeded providers. Resolve ${needs} first.`,
    );
  }

  if (invented.length > 0) {
    console.log(
      `  ${invented.length} of the service price bands are still unpublishable: ${invented.join(", ")}`,
    );
  }

  if (bands?.status === "resolved" && invented.length > 0) {
    console.error(
      `\n${FILE} marks ${BANDS_ENTRY} resolved, but ${CATEGORY_SEED} still carries invented bands:\n`,
    );
    for (const slug of invented) console.error(`  - ${slug}`);
    console.error(
      `\nResolving that entry means researching the numbers and recording it —\n` +
        `pricingSource "researched" or "observed", with pricingCheckedAt and a\n` +
        `pricingNote naming what was checked — not changing the status line.\n`,
    );
    process.exit(1);
  }

  if (malformed.length > 0) {
    console.error(
      `\n${FILE} has entries the guard cannot read, which means it cannot guard them:`,
    );
    for (const entry of malformed) {
      const missing = [
        VALID_STATUS.has(entry.status) ? null : "Status (unresolved|resolved)",
        entry.claims ? null : "Claims",
        entry.livesIn ? null : "Lives in",
        entry.replacedBy ? null : "Replaced by",
      ].filter(Boolean);
      console.error(`  - ${entry.id}: missing ${missing.join(", ")}`);
    }
    console.error("");
    process.exit(1);
  }

  /*
   * A BROKEN DEPENDENCY FAILS ALWAYS, not only at launch. The other checks
   * here are about whether we are ready to ship; this one is about the file
   * describing itself incorrectly, and a wrong map is wrong today.
   */
  if (brokenDeps.length > 0) {
    console.error(
      "\nA resolved blocker rests on an unresolved one, so the file cannot be trusted.\n",
    );
    process.exit(1);
  }

  if (!launching) {
    console.log(
      unresolved.length === 0
        ? "  All resolved.\n"
        : `  ${unresolved.length} unresolved — not a build failure until LAUNCH=true and NODE_ENV=production.\n`,
    );
    return;
  }

  if (unresolved.length === 0) {
    console.log("  All resolved. Clear to launch.\n");
    return;
  }

  console.error(
    `\nLAUNCH=true, but ${unresolved.length} launch blocker${
      unresolved.length === 1 ? " is" : "s are"
    } unresolved:\n`,
  );
  for (const entry of unresolved) {
    console.error(`  ${entry.id}`);
    console.error(`    claims:      ${entry.claims}`);
    console.error(`    replaced by: ${entry.replacedBy}\n`);
  }
  console.error(
    `Each of these is something a visitor would believe and that is not true.\n` +
      `Fix the claim, then set Status: resolved in ${FILE} in the same commit.\n`,
  );
  process.exit(1);
}

main();
