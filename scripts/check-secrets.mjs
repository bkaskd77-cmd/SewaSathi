#!/usr/bin/env node
/**
 * Did a secret get into something a browser downloads — or into a module that
 * could put it there?
 *
 * WHY THIS IS A BUILD STEP AND NOT A RULE PEOPLE FOLLOW. Next decides what is
 * client code by tracing imports, and that trace changes when somebody adds an
 * import three files away. A server-only module can become client code without
 * anybody editing it — a Client Component imports a helper, the helper imports
 * a constant, the constant's file reads `process.env.SUPABASE_SERVICE_ROLE_KEY`
 * — and the failure is silent: the build succeeds and the key ships to every
 * visitor.
 *
 * The service role key bypasses every RLS policy in this database. It is the
 * single worst thing this repository could leak, and it would leak quietly.
 *
 * THREE PASSES, AND THE THIRD IS NEW BECAUSE THE FIRST TWO WERE NOT ENOUGH.
 *
 *   1. Literal VALUES in the client bundle, for every secret present in the
 *      environment at build time. The only pass that can prove a leak rather
 *      than suggest one. It runs on Vercel, where the values exist; in CI
 *      there are none, and this says so rather than printing a green tick.
 *   2. Variable NAMES in the client bundle, which there means somebody wrote
 *      `process.env.X` in a file that ended up in a chunk. Next inlines env
 *      references in client code, so the name surviving is itself the signal.
 *   3. SOURCE: any module that reads a secret must declare `server-only`.
 *      This is the one that catches the CLASS rather than the instance, and it
 *      exists because `lib/env.ts` sat for months exporting the service role
 *      key from the same module `lib/supabase/client.ts` — the BROWSER client —
 *      imported. It never leaked, purely because the key was read inside a
 *      getter body and Next tree-shook the unused export. Passes 1 and 2 were
 *      green throughout, correctly: nothing was in the bundle. They can only
 *      see a leak that already happened. This one sees the arrangement that
 *      makes one possible, before a build exists.
 *
 * PROVED BY BREAKING IT, not by passing once. The rules are pure functions and
 * `npm run check:secrets -- --self-test` feeds them the exact shapes that
 * matter — a literal value, a bare name, a secret read without `server-only` —
 * and fails if any verdict is wrong. It runs on every invocation, so a scanner
 * that has quietly stopped scanning says so.
 *
 * NEXT_PUBLIC_* is exempt by definition — it is the prefix that means "this is
 * meant to be public", and the anon key is supposed to be in the bundle.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Everything a browser downloads. Server chunks are not scanned: they are the server. */
const CLIENT_DIRS = [".next/static"];

/** Where application modules live. Scripts run on a laptop and are exempt. */
const SOURCE_DIRS = ["lib", "app", "components"];

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
  // The SMS gateway credentials. A token in the client bundle is somebody
  // else's bulk campaign under our registered sender ID, which is worse than
  // the bill: a sender ID is an identity, and in Nepal it is one the operator
  // approved on the strength of our company registration.
  "SPARROW_SMS_TOKEN",
  "AAKASH_SMS_TOKEN",
  "SEND_SMS_HOOK_SECRET",
];

/** Values too short or too common to search for without crying wolf. */
const MIN_SEARCHABLE = 12;

/* ------------------------------------------------------------------ *
 * The rules, as pure functions, so the self-test exercises what ships
 * ------------------------------------------------------------------ */

/**
 * Does this piece of the client bundle carry a secret?
 *
 * `values` is a map of name → literal, holding only the secrets that were
 * actually present in the environment.
 */
export function judgeBundle(contents, values = {}) {
  const findings = [];
  for (const [name, value] of Object.entries(values)) {
    if (value && contents.includes(value)) {
      findings.push({ name, kind: "value" });
    }
  }
  for (const name of SECRET_NAMES) {
    if (contents.includes(name)) findings.push({ name, kind: "name" });
  }
  return findings;
}

/**
 * Does this source module read a secret without declaring `server-only`?
 *
 * THE READ IS `process.env.<NAME>`, NOT THE BARE NAME, and that distinction is
 * deliberate. This codebase documents its own rules in prose, and
 * `lib/env/index.ts` now explains at length which key used to live there and
 * why it moved. Naming a secret in a comment is documentation; reading one is
 * the thing that can ship it. A rule that could not tell them apart would push
 * people to stop writing the comments.
 *
 * `server-only` has to appear in the first few lines, where an import belongs
 * — not in a string halfway down a file.
 */
export function judgeSource(contents) {
  const head = contents.split("\n").slice(0, 15).join("\n");
  const declared = /["']server-only["']/.test(head);

  const reads = SECRET_NAMES.filter((name) =>
    contents.includes(`process.env.${name}`),
  );

  if (reads.length === 0 || declared) return [];
  return reads.map((name) => ({ name }));
}

/* ------------------------------------------------------------------ *
 * Proving the rules bite
 * ------------------------------------------------------------------ */

const FAKE_VALUE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKE.not-a-real-key";

function selfTest() {
  const bad = [];

  // 1. A literal value in a chunk is the leak this exists for.
  if (
    judgeBundle(`const k="${FAKE_VALUE}";`, {
      SUPABASE_SERVICE_ROLE_KEY: FAKE_VALUE,
    }).length === 0
  ) {
    bad.push("a literal secret value in a bundle was judged clean");
  }

  // 2. A bare name in a chunk means somebody wrote process.env.X in client code.
  if (judgeBundle("process.env.CRON_SECRET").length === 0) {
    bad.push("a secret name in a bundle was judged clean");
  }

  // 3. The anon key belongs there. Flagging it would make the check useless.
  if (judgeBundle('const u=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;').length > 0) {
    bad.push("NEXT_PUBLIC_* was flagged, which is the prefix meaning public");
  }

  // 4. The arrangement lib/env.ts was in: a secret read, no server-only.
  if (
    judgeSource('export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;')
      .length === 0
  ) {
    bad.push("a secret read without server-only was judged clean");
  }

  // 5. The same read, declared. This is what the fix looks like.
  if (
    judgeSource('import "server-only";\nexport const k = process.env.ANTHROPIC_API_KEY;')
      .length > 0
  ) {
    bad.push("a secret read WITH server-only was flagged");
  }

  // 6. Prose naming a key is documentation, not a read. lib/env/index.ts
  //    explains which key used to live there; that must stay possible.
  if (judgeSource(" * It used to hold SUPABASE_SERVICE_ROLE_KEY.\n").length > 0) {
    bad.push("a secret named in a comment was treated as a read");
  }

  if (bad.length > 0) {
    for (const line of bad) console.error(`  self-test FAILED — ${line}`);
    console.error(`\nSecret check: ${bad.length} self-test failures.\n`);
    process.exit(1);
  }

  console.log("  self-test passed — 3 bundle shapes and 3 source shapes judged correctly.");
}

/* ------------------------------------------------------------------ *
 * Walking what actually exists
 * ------------------------------------------------------------------ */

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.test(entry)) out.push(full);
  }
  return out;
}

function main() {
  console.log("\nSecret check");

  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  selfTest();

  /* ---------------------------------------------------------------- *
   * Pass 3 first, because it needs no build and catches the class
   * ---------------------------------------------------------------- */

  const unreadable = [];
  const sourceFiles = SOURCE_DIRS.flatMap((dir) => {
    try {
      return walk(path.join(ROOT, dir), /\.(ts|tsx|mjs|js)$/);
    } catch (error) {
      unreadable.push(`${dir} — ${error.message}`);
      return [];
    }
  });

  /*
   * A DIRECTORY WE CANNOT READ IS NOT A DIRECTORY WITH NOTHING IN IT — the
   * same false green as the npm-audit envelope, and `check-contacts.mjs` is
   * the model. Three fixed paths in this repository, not a glob that might
   * legitimately match nothing.
   */
  if (unreadable.length > 0 || sourceFiles.length === 0) {
    console.error("");
    for (const entry of unreadable) console.error(`  UNREADABLE  ${entry}`);
    if (sourceFiles.length === 0) {
      console.error("  EMPTY       no source files found to scan");
    }
    console.error(
      "\n  This is NOT a pass. The check looked at less of the product than it\n" +
        "  is supposed to, which is indistinguishable from finding nothing.\n",
    );
    process.exit(2);
  }

  const undeclared = [];
  for (const file of sourceFiles) {
    for (const { name } of judgeSource(readFileSync(file, "utf8"))) {
      undeclared.push(`${name} — read in ${path.relative(ROOT, file)}`);
    }
  }

  console.log(`  ${sourceFiles.length} source files scanned`);

  if (undeclared.length > 0) {
    console.error("\nA module reads a secret without declaring `server-only`:");
    for (const finding of new Set(undeclared)) console.error(`  - ${finding}`);
    console.error(
      "\nAdd `import \"server-only\";` as the first line. Without it, nothing\n" +
        "stops a Client Component importing that module — directly or three\n" +
        "imports away — and Next will inline the value into a bundle every\n" +
        "visitor downloads, with a green build. That is how `lib/env.ts` came\n" +
        "to export the service role key from the same module the browser\n" +
        "Supabase client imported.\n",
    );
    process.exit(1);
  }

  /* ---------------------------------------------------------------- *
   * Passes 1 and 2: what the build actually produced
   * ---------------------------------------------------------------- */

  const clientFiles = CLIENT_DIRS.flatMap((dir) => {
    try {
      return walk(path.join(ROOT, dir), /\.(js|mjs|cjs|json|txt|map|css)$/);
    } catch {
      return [];
    }
  });

  if (clientFiles.length === 0) {
    console.error(
      "\nSecret check found no client bundle to look at. Run it after `next build`.\n",
    );
    process.exit(2);
  }

  const values = {};
  for (const name of SECRET_NAMES) {
    const value = process.env[name];
    if (typeof value === "string" && value.length >= MIN_SEARCHABLE) {
      values[name] = value;
    }
  }

  const findings = [];
  for (const file of clientFiles) {
    const contents = readFileSync(file, "utf8");
    for (const { name, kind } of judgeBundle(contents, values)) {
      findings.push(
        `${name} — its ${kind === "value" ? "VALUE" : "name"} appears in ${file}`,
      );
    }
  }

  console.log(`  ${clientFiles.length} client files scanned`);
  console.log(
    `  ${Object.keys(values).length} of ${SECRET_NAMES.length} secrets had a value to search for`,
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

  if (Object.keys(values).length === 0) {
    // Honest about what was not checked: locally and in CI there are no
    // secrets to find, so this pass proved only that no NAME leaked. The
    // value pass runs on Vercel, where they exist.
    console.log("  No secret values in this environment — names checked only.\n");
  } else {
    console.log("  No secret reached the browser.\n");
  }
}

main();
