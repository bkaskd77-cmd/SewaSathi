import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every function in the tree is fingerprinted, counted a second way.
 *
 * WHY A SECOND WAY. `supabase/function-fingerprints.json` is what `/api/health`
 * compares the live database against, and it is produced by one regex in
 * `scripts/check-migrations.mjs` that has to match a whole function — the name,
 * the signature, the dollar quote, the body and the closing quote. That regex
 * was `as \$\$ … \$\$;` and nothing else, so two functions quoted `$fn$` were
 * invisible to it:
 *
 *   `enforce_claim_refund` kept the body of an older migration, so the live
 *   check reported production as drifted for four days when production was
 *   correct — the inverse of the fault the gate exists for, and identical from
 *   outside.
 *
 *   `add_ai_spend` never entered the file at all, so the gate has never
 *   compared it. A false positive is loud; a silent gap is not, which is why
 *   this test asserts coverage rather than correctness.
 *
 * The scanner self-tests now, which catches the spellings somebody thought of.
 * This catches the ones nobody did: it finds function NAMES with a pattern that
 * stops at the opening parenthesis and knows nothing about quoting, so the two
 * can only agree by both being right. A single regex checking itself is the
 * arrangement that failed.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

/** Deliberately the narrowest possible pattern: a name, and nothing after it. */
const DECLARED = /create or replace function public\.([a-z_]+)\s*\(/g;

function declaredInTree(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const src = readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const m of src.matchAll(DECLARED)) names.add(m[1]);
  }
  return names;
}

describe("the drift gate compares every function the tree defines", () => {
  const fingerprinted = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "supabase/function-fingerprints.json"),
      "utf8",
    ),
  ) as Record<string, { sha: string; file: string }>;

  it("fingerprints each one", () => {
    const missing = [...declaredInTree()].filter((n) => !(n in fingerprinted));
    expect(
      missing.sort(),
      "A function the migrations define is absent from the fingerprint file, so " +
        "/api/health has never compared it against production. The body scanner " +
        "in scripts/check-migrations.mjs did not match its definition — check " +
        "the dollar quoting and the signature.",
    ).toEqual([]);
  });

  it("fingerprints nothing the tree does not define", () => {
    // The other direction: a renamed or removed function leaving a fingerprint
    // behind means the gate is comparing production against a function that no
    // longer exists, which can only ever read as drift.
    const declared = declaredInTree();
    const orphaned = Object.keys(fingerprinted).filter((n) => !declared.has(n));
    expect(orphaned.sort()).toEqual([]);
  });

  it("names the file each fingerprint came from, and it is the LAST one", () => {
    /*
     * "Rebuild from the TREE's last definition" is the rule the live drift
     * taught, and it is only followable if the file named here is really the
     * last. `enforce_claim_refund` named `20260925000003_materials.sql` while
     * `20261008000003_claim_inspection_gate.sql` redefined it — which is what
     * the stale entry looked like from the outside, and is indistinguishable
     * from a correct entry unless somebody checks.
     */
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const last = new Map<string, string>();
    for (const file of files) {
      const src = readFileSync(path.join(MIGRATIONS, file), "utf8");
      for (const m of src.matchAll(DECLARED)) last.set(m[1], file);
    }

    const wrong = Object.entries(fingerprinted)
      .filter(([name, entry]) => last.get(name) !== entry.file)
      .map(([name, entry]) => `${name}: ${entry.file} (last is ${last.get(name)})`);

    expect(wrong.sort()).toEqual([]);
  });
});
