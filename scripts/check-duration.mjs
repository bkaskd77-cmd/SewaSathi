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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const TS = "lib/booking/duration.ts";
const SQL = "supabase/migrations/20260920000002_duration_capacity.sql";
/*
 * THE SPAN GATE LIVES IN A SECOND PAIR OF FILES, and it is the drift that
 * actually happened rather than one this script was imagining.
 *
 * `spansDays()` and `sync_booking_days()` both decide whether a job may hold
 * more than one day, and both read a sub-band's provenance to do it. For a
 * phase they read `duration_source` — the MINUTES' provenance — while the
 * comment above each of them argued, correctly and at length, that the two must
 * be gated separately because their wrong answers cost wildly different amounts.
 * One promotion of a researched minutes figure would have handed painting a
 * four-day hold on a painter's week and a customer's home with nothing observed
 * about spans at all. `span_source` is the second gate; this is what keeps both
 * halves pointed at it.
 */
const MIGRATIONS = "supabase/migrations";

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


/**
 * A body with its comments taken out.
 *
 * NAMING A COLUMN IN ORDER TO WARN ABOUT IT IS DOCUMENTATION, NOT A READ — the
 * rule `check:secrets` already follows for a key named in a comment, and the
 * first version of the span check tripped on its own explanation of the bug it
 * was looking for. A checker that cries wolf gets skimmed, and the one real
 * entry goes with the noise.
 */
function uncommented(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * The LAST migration to define a function, never the one that created it.
 *
 * `drop ... if exists` + `create` is the idiom here and several functions are
 * redefined twice as the product grew, so reading the file that first created
 * one answers a question about history rather than about what the database
 * holds. Checking the wrong copy is how a guard gets reported working when it
 * is not — this repository has done it once already, with `rls-matrix`.
 */
function lastDefinition(name) {
  const marker = `create or replace function public.${name}(`;
  let found = null;
  for (const file of readdirSync(path.join(process.cwd(), MIGRATIONS)).sort()) {
    if (!file.endsWith(".sql")) continue;
    const src = read(path.join(MIGRATIONS, file));
    const at = src.lastIndexOf(marker);
    if (at === -1) continue;
    const rest = src.slice(at);
    found = { file, body: rest.slice(0, rest.indexOf("$$;") + 3) };
  }
  return found;
}

/**
 * Both halves of the span gate read `span_source`, and neither reads
 * `duration_source`.
 *
 * THE NEGATIVE HALF IS THE POINT. A function that read both and took whichever
 * was the more generous would pass a test that only asked whether the right
 * column appears — and "whichever is more generous" is precisely the shape the
 * bug had, since one column was answering for two numbers.
 *
 * Returns its problems rather than exiting, so the rule can be self-tested
 * below against known-bad text. A rule that has quietly stopped biting reads
 * exactly like a tree with nothing wrong in it.
 */
function spanGateProblems(ts, sqlBodyOverride, tsBodyOverride) {
  const problems = [];

  const days = lastDefinition("sync_booking_days");
  if (!days && sqlBodyOverride === undefined) {
    return ["no migration defines sync_booking_days — the span gate has no SQL half"];
  }
  const sqlBody = uncommented(sqlBodyOverride ?? days.body);
  const where = days ? path.join(MIGRATIONS, days.file) : "(given text)";

  const spansFn = ts.slice(ts.indexOf("export function spansDays"));
  const tsBody = uncommented(
    tsBodyOverride ?? spansFn.slice(0, spansFn.indexOf("\n}") + 2),
  );

  if (!/\bspan_source\b/.test(sqlBody)) {
    problems.push(
      `sync_booking_days in ${where} does not read span_source — the span gate is reading something else`,
    );
  }
  if (/\bduration_source\b/.test(sqlBody)) {
    problems.push(
      `sync_booking_days in ${where} reads duration_source, which governs the minutes and not the span`,
    );
  }
  if (!/hasPublishableSpan|spanSource/.test(tsBody)) {
    problems.push(
      `spansDays() in ${TS} does not consult the span's own provenance`,
    );
  }
  if (/provenance\.source\b/.test(tsBody)) {
    problems.push(
      `spansDays() in ${TS} reads provenance.source, which governs the minutes and not the span`,
    );
  }
  return problems;
}

/** The rule, proven to still bite, on every run. */
function selfTest(ts) {
  const bad = spanGateProblems(
    ts,
    "begin select b.duration_source <> 'invented' into spans; end; $$;",
  );
  if (bad.length === 0) {
    fail([
      "the span-gate rule passed a sync_booking_days that reads duration_source — it has stopped biting",
    ]);
  }

  const commented = spanGateProblems(
    ts,
    "-- no longer duration_source\n  select b.span_source <> 'invented' into spans; $$;",
  );
  if (commented.length > 0) {
    fail([
      "the span-gate rule flagged a correct function for naming duration_source in a comment",
      ...commented,
    ]);
  }
}

function main() {
  const ts = read(TS);
  const sql = read(SQL);
  const problems = [];

  selfTest(ts);

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

  problems.push(...spanGateProblems(ts));

  if (problems.length > 0) fail(problems);

  console.log("\nDuration rules");
  console.log(`  unestimated hold agrees at ${tsHold} minutes`);
  console.log("  precedence agrees: the professional's figure, then ours, then the hold");
  console.log("  the span gate reads span_source on both sides, and duration_source on neither");
  console.log("  both span-gate rules self-tested: one known-bad flagged, one comment ignored");
}

main();
