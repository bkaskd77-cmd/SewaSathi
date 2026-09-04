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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Two machines now, checked the same way. Bookings and payments are separate
 * state machines on purpose — a booking can be completed and unpaid — so each
 * gets its own pair and each pair must agree.
 */
const MACHINES = [
  {
    name: "Booking",
    ts: "lib/booking/status.ts",
    tsConst: "BOOKING_TRANSITIONS",
    sqlFn: "booking_transition_allowed",
  },
  {
    name: "Payment",
    ts: "lib/payments/status.ts",
    tsConst: "PAYMENT_TRANSITIONS",
    sqlFn: "payment_transition_allowed",
  },
];

/**
 * The LAST definition of a function across every migration, in filename order.
 *
 * Migrations are applied in order and `create or replace` means a later file
 * wins, exactly as it does in Postgres. Naming one file here instead was wrong
 * the moment a rule was amended in a second migration: the check compared the
 * interface against a superseded definition and reported a disagreement that
 * did not exist — and, worse, would have missed a real one.
 */
function latestSql(fnName) {
  const dir = path.join(process.cwd(), "supabase/migrations");
  let found = null;
  let foundIn = null;

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    const parsed = parseSql(sql, fnName);
    if (parsed && parsed.size > 0) {
      found = parsed;
      foundIn = file;
    }
  }
  return { map: found, file: foundIn };
}

function read(file) {
  try {
    return readFileSync(path.join(process.cwd(), file), "utf8");
  } catch {
    console.error(`\n${file} is missing — the transition rules live there.\n`);
    process.exit(1);
  }
}

/** <NAME>_TRANSITIONS = { pending: ["accepted", ...], ... } */
function parseTs(source, constName) {
  const block = source.match(
    new RegExp(`${constName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`),
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
function parseSql(source, fnName) {
  const block = source.match(
    new RegExp(`${fnName}[\\s\\S]*?select case from_status([\\s\\S]*?)end;`),
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

function checkMachine(machine) {
  const ts = parseTs(read(machine.ts), machine.tsConst);
  const { map: sql, file: sqlFile } = latestSql(machine.sqlFn);

  // Passing because the shape moved would read as green forever.
  if (!ts || ts.size === 0) {
    console.error(
      `\nCould not read ${machine.tsConst} from ${machine.ts}. Fix this script rather than deleting the check.\n`,
    );
    process.exit(1);
  }
  if (!sql || sql.size === 0) {
    console.error(
      `\nCould not find ${machine.sqlFn} in any migration. Fix this script rather than deleting the check.\n`,
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
      problems.push(`${from}: in ${machine.ts} but not in ${sqlFile}`);
      continue;
    }
    if (theirs.join(",") !== targets.join(",")) {
      problems.push(
        `${from}: TS allows [${targets.join(", ")}], SQL allows [${theirs.join(", ")}]`,
      );
    }
  }

  for (const from of sql.keys()) {
    if (!ts.has(from)) {
      problems.push(`${from}: in ${sqlFile} but not in ${machine.ts}`);
    }
    else if (ts.get(from).length === 0) {
      problems.push(`${from}: terminal in ${machine.ts} but the SQL lets it move`);
    }
  }

  console.log(`\n${machine.name} transitions  (${sqlFile})`);
  for (const [from, targets] of ts.entries()) {
    console.log(
      `  ${targets.length === 0 ? "end " : "ok  "}  ${from.padEnd(18)} ${targets.join(", ") || "(terminal)"}`,
    );
  }

  return problems.map((p) => `${machine.name}: ${p}`);
}

function main() {
  const problems = MACHINES.flatMap(checkMachine);

  if (problems.length > 0) {
    console.error(
      `\nThe interface and the database disagree about what may happen:`,
    );
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\nChange both, in the same commit. The database is the one that is\n` +
        `actually enforced, so if they differ it is the SQL that is true and the\n` +
        `interface that is lying.\n`,
    );
    process.exit(1);
  }

  console.log("\n  Interface and database agree on both machines.\n");
}

main();
