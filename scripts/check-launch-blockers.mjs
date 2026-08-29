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
