#!/usr/bin/env node
/**
 * The booking transition rules exist twice. This proves they agree.
 *
 * lib/booking/status.ts is what the interface reads — whether to offer a
 * cancel button, which step of the progress bar is lit. The SQL function
 * `booking_transition_allowed` is what actually cannot be bypassed. Neither
 * can be deleted in favour of the other, so the duplication is checked on
 * every build instead of being trusted to a comment.
 *
 * It parses rather than executes: running the SQL would need a database, and
 * this has to fail on a laptop with no network in under a second.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const TS_FILE = "lib/booking/status.ts";
const SQL_FILE = "supabase/migrations/20260901000001_bookings.sql";

function read(file) {
  try {
    return readFileSync(path.join(process.cwd(), file), "utf8");
  } catch {
    console.error(`\n${file} is missing — the transition rules live there.\n`);
    process.exit(1);
  }
}

/** BOOKING_TRANSITIONS = { pending: ["accepted", ...], ... } */
function parseTs(source) {
  const block = source.match(
    /BOOKING_TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\};/,
  )?.[1];
  if (!block) return null;

  const map = new Map();
  const entry = /(\w+):\s*\[([^\]]*)\]/g;
  let match;
  while ((match = entry.exec(block)) !== null) {
    const targets = match[2]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    map.set(match[1], targets.sort());
  }
  return map;
}

/** when 'pending' then to_status in ('accepted', ...) */
function parseSql(source) {
  const block = source.match(
    /booking_transition_allowed[\s\S]*?select case from_status([\s\S]*?)end;/,
  )?.[1];
  if (!block) return null;

  const map = new Map();
  const entry = /when\s+'(\w+)'\s+then\s+to_status\s+in\s*\(([^)]*)\)/g;
  let match;
  while ((match = entry.exec(block)) !== null) {
    const targets = match[2]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    map.set(match[1], targets.sort());
  }
  return map;
}

function main() {
  const ts = parseTs(read(TS_FILE));
  const sql = parseSql(read(SQL_FILE));

  // Passing because the shape moved would read as green forever.
  if (!ts || ts.size === 0) {
    console.error(
      `\nCould not read BOOKING_TRANSITIONS from ${TS_FILE}. Fix this script rather than deleting the check.\n`,
    );
    process.exit(1);
  }
  if (!sql || sql.size === 0) {
    console.error(
      `\nCould not read booking_transition_allowed from ${SQL_FILE}. Fix this script rather than deleting the check.\n`,
    );
    process.exit(1);
  }

  const problems = [];
  // The SQL `else false` covers terminal states, so it only lists the ones
  // that go somewhere. Compare on that set.
  const moving = [...ts.entries()].filter(([, to]) => to.length > 0);

  for (const [from, targets] of moving) {
    const theirs = sql.get(from);
    if (!theirs) {
      problems.push(`${from}: in ${TS_FILE} but not in the SQL`);
      continue;
    }
    if (theirs.join(",") !== targets.join(",")) {
      problems.push(
        `${from}: TS allows [${targets.join(", ")}], SQL allows [${theirs.join(", ")}]`,
      );
    }
  }

  for (const from of sql.keys()) {
    if (!ts.has(from)) problems.push(`${from}: in the SQL but not in ${TS_FILE}`);
    else if (ts.get(from).length === 0) {
      problems.push(`${from}: terminal in ${TS_FILE} but the SQL lets it move`);
    }
  }

  console.log("\nBooking transitions");
  for (const [from, targets] of ts.entries()) {
    console.log(
      `  ${targets.length === 0 ? "end " : "ok  "}  ${from.padEnd(18)} ${targets.join(", ") || "(terminal)"}`,
    );
  }

  if (problems.length > 0) {
    console.error(
      `\nThe interface and the database disagree about what a booking may do:`,
    );
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\nChange both, in the same commit. The database is the one that is\n` +
        `actually enforced, so if they differ it is the SQL that is true and the\n` +
        `interface that is lying.\n`,
    );
    process.exit(1);
  }

  console.log("  Interface and database agree.\n");
}

main();
