#!/usr/bin/env node
/**
 * Did a secret get into something a browser downloads?
 *
 * WHY THIS IS A BUILD STEP AND NOT A RULE PEOPLE FOLLOW. Next decides what is
 * client code by tracing imports, and that trace changes when somebody adds an
 * import three files away. A server-only module can become client code without
 * anybody editing it — a Client Component imports a helper, the helper imports
 * a constant, the constant's file reads `process.env.SUPABASE_SERVICE_ROLE_KEY`
 * — and the failure is silent: the build succeeds and the key ships to every
 * visitor. `server-only` catches the common case at build time; this catches
 * the rest, by looking at what was actually produced rather than at what the
 * imports imply.
 *
 * The service role key bypasses every RLS policy in this database. It is the
 * single worst thing this repository could leak, and it would leak quietly.
 *
 * TWO PASSES:
 *   1. Literal values, for every secret present in the environment at build
 *      time. This is the one that matters and the only one that can prove a
 *      leak rather than suggest one.
 *   2. Variable NAMES, which in client code means somebody wrote
 *      `process.env.X` in a file that ended up in a bundle. Next inlines env
 *      references there, so the name surviving is itself the signal.
 *
 * NEXT_PUBLIC_* is exempt by definition — it is the prefix that means "this is
 * meant to be public", and the anon key is supposed to be in the bundle.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Everything a browser downloads. Server chunks are not scanned: they are the server. */
const CLIENT_DIRS = [".next/static"];

/**
 * Secrets by name. Anything here that is also set in the environment gets its
 * value searched for as well.
 */
const SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "CRON_SECRET",
  "ESEWA_SECRET_KEY",
  "KHALTI_SECRET_KEY",
  "SMS_HEALTH_NUMBER",
  "SUPABASE_DB_PASSWORD",
];

/** Values too short or too common to search for without crying wolf. */
const MIN_SEARCHABLE = 12;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|cjs|json|txt|map|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = CLIENT_DIRS.flatMap(walk);

if (files.length === 0) {
  console.error(
    "\nSecret check found no client bundle to look at. Run it after `next build`.\n",
  );
  process.exit(2);
}

const findings = [];
const searchable = SECRET_NAMES.filter((name) => {
  const value = process.env[name];
  return typeof value === "string" && value.length >= MIN_SEARCHABLE;
});

for (const file of files) {
  const contents = readFileSync(file, "utf8");

  for (const name of searchable) {
    if (contents.includes(process.env[name])) {
      findings.push(`${name} — its VALUE appears in ${file}`);
    }
  }
  for (const name of SECRET_NAMES) {
    if (contents.includes(name)) {
      findings.push(`${name} — the name appears in ${file}`);
    }
  }
}

console.log("\nSecret check");
console.log(`  ${files.length} client files scanned`);
console.log(
  `  ${searchable.length} of ${SECRET_NAMES.length} secrets had a value to search for`,
);

if (findings.length > 0) {
  console.error("\nA secret reached the browser:");
  for (const finding of new Set(findings)) console.error(`  - ${finding}`);
  console.error(
    "\nFind what pulled it in: a Client Component importing a module that\n" +
      "reads it, usually two or three imports away. Mark that module\n" +
      "`server-only` and the build will name the file for you.\n",
  );
  process.exit(1);
}

if (searchable.length === 0) {
  // Honest about what was not checked: locally there are no secrets to find,
  // so this pass proved only that no NAME leaked.
  console.log("  No secret values in this environment — names checked only.\n");
} else {
  console.log("  No secret reached the browser.\n");
}
