#!/usr/bin/env node
/**
 * The TypeScript rule and the SQL rule must hold the same numbers.
 *
 * WHAT THIS REPLACES. `enforce_slot_capacity` carried
 * `slot interval := interval '120 minutes'` under a comment reading "Must
 * match WORKING_HOURS.slotHours in lib/booking/schedule.ts". A comment asking
 * the next reader to keep two numbers in step by hand is not a guard, it is a
 * note — and this project has already lost a whole set of settlement checks to
 * exactly that kind of trust.
 *
 * Two constants have to agree. `UNESTIMATED_HOLD_MINUTES` in
 * lib/booking/duration.ts is what a booking holds when nobody named its
 * product; the same figure is the final `coalesce` argument in
 * `booking_working_minutes`. If they drift, the screen greys out a different
 * set of slots from the ones the database refuses — and the customer meets a
 * raised exception at the end of five screens rather than a greyed row at the
 * start.
 *
 * The precedence has to agree too: the professional's figure, then ours, then
 * the hold. A SQL coalesce in the wrong order would schedule off our estimate
 * while the screen scheduled off theirs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const TS = "lib/booking/duration.ts";
const SQL = "supabase/migrations/20260920000002_duration_capacity.sql";

function read(file) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function fail(lines) {
  console.error(`\nDuration rules disagree\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(
    `\nThe screen greys out slots using ${TS}; the database refuses them using\n` +
      `${SQL}. When those two disagree a customer fills in five screens and\n` +
      `meets a raised exception instead of a greyed row.\n`,
  );
  process.exit(1);
}

function main() {
  const ts = read(TS);
  const sql = read(SQL);
  const problems = [];

  // The hold, on both sides.
  const tsHold = ts.match(/UNESTIMATED_HOLD_MINUTES\s*=\s*(\d+)/)?.[1];
  const sqlHold = sql.match(
    /coalesce\(\s*p_provider_estimated\s*,\s*p_estimated\s*,\s*(\d+)\s*\)/,
  )?.[1];

  if (!tsHold) problems.push(`${TS} does not define UNESTIMATED_HOLD_MINUTES`);
  if (!sqlHold) {
    problems.push(
      `${SQL} has no booking_working_minutes coalesce in the expected shape`,
    );
  }
  if (tsHold && sqlHold && tsHold !== sqlHold) {
    problems.push(
      `the unestimated hold is ${tsHold} minutes in TypeScript and ${sqlHold} in SQL`,
    );
  }

  /*
   * The precedence, as an ordered list on each side. Comparing the ORDER
   * rather than just the presence of each term is the point: a coalesce with
   * the two estimates swapped would pass a membership check and schedule every
   * job off our guess instead of the professional's measurement.
   */
  const tsOrder = [
    /providerEstimatedWorkingMinutes\s*\?\?/,
    /estimatedWorkingMinutes\s*\?\?/,
    /UNESTIMATED_HOLD_MINUTES/,
  ];
  const tsBody = ts.slice(ts.indexOf("export function workingMinutes"));
  let cursor = 0;
  for (const [i, pattern] of tsOrder.entries()) {
    const found = tsBody.slice(cursor).search(pattern);
    if (found === -1) {
      problems.push(
        `workingMinutes() in ${TS} does not fall back in the expected order at step ${i + 1}`,
      );
      break;
    }
    cursor += found + 1;
  }

  const sqlOrder = /coalesce\(\s*p_provider_estimated\s*,\s*p_estimated\s*,/;
  if (!sqlOrder.test(sql)) {
    problems.push(
      `booking_working_minutes in ${SQL} does not prefer the provider's figure first`,
    );
  }

  if (problems.length > 0) fail(problems);

  console.log("\nDuration rules");
  console.log(`  unestimated hold agrees at ${tsHold} minutes`);
  console.log("  precedence agrees: the professional's figure, then ours, then the hold");
}

main();
