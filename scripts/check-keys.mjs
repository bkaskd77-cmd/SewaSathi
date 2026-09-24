#!/usr/bin/env node
/**
 * Does every message key the code asks for actually exist?
 *
 * WHAT `check:messages` CANNOT SEE, AND WHY IT IS NOT ITS FAULT. That check
 * compares `en.json` against `ne.json` and fails when they disagree. A key
 * missing from BOTH is perfectly consistent, so it passes — and next-intl
 * renders a miss as its own dotted path rather than throwing. The result is a
 * key path printed onto a page, in production, silently.
 *
 * It has happened. `admin.detail.payoutIsSomebodyElses` rendered as its own
 * name on the provider-application review screen, where it was supposed to
 * tell the reviewer that the payout number is one we never sent a code to.
 * The signal fired correctly and said nothing anybody could read. Two more
 * were found the same day.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PARSES TYPESCRIPT INSTEAD OF MATCHING A REGEX
 * ---------------------------------------------------------------------------
 *
 * Three regex versions were written before this one. Each was confident and
 * each was wrong, in a different way:
 *
 *   1. Taking the last `const t = useTranslations("x")` in a file: an
 *      unrelated file declares `t` four times, three as "triage" and one as
 *      "triage.debug", so every call in it resolved against the wrong
 *      namespace and sixteen keys were reported missing that exist.
 *   2. Scoping each declaration to the text until the same name is
 *      redeclared: a page declares `t` as "meta" inside `generateMetadata`
 *      and as its own namespace in the component, and the regions do not
 *      nest the way the text suggests.
 *   3. Both of the above still cannot see a binding that is not a
 *      declaration at all — a landing page binds `t` by DESTRUCTURING the
 *      result of a `Promise.all`, which no pattern over raw text will find.
 *
 * A checker that reports keys which are fine is worse than no checker: the
 * list gets long, somebody skims it, and the one real entry goes with it. So
 * scope is resolved by the TypeScript compiler, which already knows the
 * answer. `typescript` is a dependency of this repository, so this costs
 * nothing new.
 *
 * DYNAMIC KEYS ARE REPORTED, NEVER RESOLVED. `t(`errors.${reason}`)` cannot be
 * checked without knowing every value `reason` takes. Guessing is how a
 * checker starts lying, so those are counted and named, and the pattern that
 * makes them safe is the allow-list `listNoteKey` uses in `lib/notify`.
 *
 * PROVED BY BREAKING IT. `npm run check:keys -- --self-test` runs the resolver
 * over fixtures holding all three shapes above plus a genuinely missing key,
 * and fails if any verdict is wrong. It runs on every invocation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib"];

/** The next-intl factories that bind a namespace to a name. */
const FACTORIES = new Set(["useTranslations", "getTranslations"]);

/* ------------------------------------------------------------------ *
 * The resolver
 * ------------------------------------------------------------------ */

/** The namespace argument, from either `("ns")` or `({ namespace: "ns" })`. */
function namespaceOf(callNode) {
  const [arg] = callNode.arguments;
  if (!arg) return null;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        prop.name.getText() === "namespace" &&
        ts.isStringLiteralLike(prop.initializer)
      ) {
        return prop.initializer.text;
      }
    }
  }
  return null;
}

/** Unwrap `await x`, `(x)` and similar so the call underneath is visible. */
function unwrap(node) {
  let cur = node;
  while (
    cur &&
    (ts.isAwaitExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur))
  ) {
    cur = cur.expression;
  }
  return cur;
}

/**
 * Every name in a file bound to a namespace, with the scope it is bound in.
 *
 * Handles the three shapes that defeated the regex versions:
 *   - `const t = useTranslations("ns")`
 *   - `const t = await getTranslations({ namespace: "ns" })`
 *   - `const [a, t] = await Promise.all([..., getTranslations("ns"), ...])`
 *
 * Scope is the binding's enclosing function or source file, taken from the
 * AST, so a name redeclared in another function does not reach across.
 */
function collectBindings(source) {
  const bindings = [];

  const scopeOf = (node) => {
    let cur = node.parent;
    while (cur) {
      if (
        ts.isFunctionDeclaration(cur) ||
        ts.isFunctionExpression(cur) ||
        ts.isArrowFunction(cur) ||
        ts.isMethodDeclaration(cur) ||
        ts.isSourceFile(cur)
      ) {
        return cur;
      }
      cur = cur.parent;
    }
    return source;
  };

  const record = (nameNode, ns, declNode) => {
    if (!ns || !ts.isIdentifier(nameNode)) return;
    bindings.push({
      name: nameNode.text,
      namespace: ns,
      scope: scopeOf(declNode),
      pos: declNode.getStart(source),
    });
  };

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);

      // const t = useTranslations("ns")
      if (
        init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        FACTORIES.has(init.expression.text)
      ) {
        record(node.name, namespaceOf(init), node);
      }

      // const [a, t] = await Promise.all([ ..., getTranslations("ns"), ... ])
      if (
        init &&
        ts.isCallExpression(init) &&
        ts.isArrayBindingPattern(node.name)
      ) {
        const [list] = init.arguments;
        if (list && ts.isArrayLiteralExpression(list)) {
          node.name.elements.forEach((element, index) => {
            if (ts.isOmittedExpression(element)) return;
            const call = unwrap(list.elements[index]);
            if (
              call &&
              ts.isCallExpression(call) &&
              ts.isIdentifier(call.expression) &&
              FACTORIES.has(call.expression.text)
            ) {
              record(element.name, namespaceOf(call), node);
            }
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return bindings;
}

/** Is `node` lexically inside `scope`? */
function within(node, scope) {
  let cur = node;
  while (cur) {
    if (cur === scope) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Every `t("key")` call in a file, resolved to `namespace.key`.
 *
 * The innermost binding wins: scopes are compared by containment, so a name
 * rebound inside a function shadows the outer one exactly as it does at
 * runtime. That is the whole reason this is an AST walk.
 */
export function resolveFile(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const bindings = collectBindings(source);
  const resolved = [];
  const dynamic = [];
  if (bindings.length === 0) return { resolved, dynamic };

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.arguments.length > 0
    ) {
      const name = node.expression.text;
      const candidates = bindings.filter(
        (b) => b.name === name && within(node, b.scope),
      );

      if (candidates.length > 0) {
        // Innermost scope wins; among equals, the latest declaration does.
        let chosen = candidates[0];
        for (const c of candidates.slice(1)) {
          if (within(chosen.scope, c.scope)) continue;
          if (within(c.scope, chosen.scope) || c.pos > chosen.pos) chosen = c;
        }

        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        const [arg] = node.arguments;
        if (ts.isStringLiteralLike(arg)) {
          resolved.push({
            key: `${chosen.namespace}.${arg.text}`,
            line: line + 1,
          });
        } else {
          dynamic.push({ namespace: chosen.namespace, line: line + 1 });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return { resolved, dynamic };
}

/* ------------------------------------------------------------------ *
 * Catalogues
 * ------------------------------------------------------------------ */

function hasKey(catalogue, dotted) {
  let cur = catalogue;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return false;
    cur = cur[part];
  }
  // next-intl renders a namespace object as a miss, same as an absent key.
  return typeof cur === "string";
}

/* ------------------------------------------------------------------ *
 * Proving the resolver bites
 * ------------------------------------------------------------------ */

const FIXTURES = [
  {
    label: "a name rebound later in the file does not reach backwards",
    text: `
      function A() { const t = useTranslations("triage"); return t("heading"); }
      function B() { const t = useTranslations("triage.debug"); return t("submit"); }
    `,
    expect: ["triage.heading", "triage.debug.submit"],
  },
  {
    label: "metadata and page bind the same name to different namespaces",
    text: `
      export async function generateMetadata() {
        const t = await getTranslations({ locale: "en", namespace: "meta" });
        return { title: t("loginTitle") };
      }
      export default function Page() {
        const t = useTranslations("auth.login");
        return t("sendCode");
      }
    `,
    expect: ["meta.loginTitle", "auth.login.sendCode"],
  },
  {
    label: "a binding destructured out of a Promise.all is still found",
    text: `
      export default async function Home() {
        const [locale, t] = await Promise.all([getLocale(), getTranslations("home")]);
        return t("badge");
      }
    `,
    expect: ["home.badge"],
  },
  {
    label: "a dynamic key is reported, never guessed at",
    text: `
      function A() { const t = useTranslations("x"); return t(\`errors.\${r}\`); }
    `,
    expect: [],
    expectDynamic: 1,
  },
];

function selfTest() {
  const bad = [];

  for (const fixture of FIXTURES) {
    const { resolved, dynamic } = resolveFile("fixture.tsx", fixture.text);
    const keys = resolved.map((r) => r.key).sort();
    const want = [...fixture.expect].sort();
    if (JSON.stringify(keys) !== JSON.stringify(want)) {
      bad.push(`${fixture.label} — resolved ${JSON.stringify(keys)}, wanted ${JSON.stringify(want)}`);
    }
    if ((fixture.expectDynamic ?? 0) !== dynamic.length) {
      bad.push(`${fixture.label} — ${dynamic.length} dynamic, wanted ${fixture.expectDynamic ?? 0}`);
    }
  }

  // And the thing it is actually for: a key nobody wrote copy for.
  const cat = { a: { present: "yes" } };
  if (hasKey(cat, "a.absent") || !hasKey(cat, "a.present")) {
    bad.push("catalogue lookup judged a key wrongly");
  }
  // A namespace is not a string, and next-intl renders it as a miss.
  if (hasKey(cat, "a")) bad.push("a namespace object was treated as copy");

  if (bad.length > 0) {
    for (const line of bad) console.error(`  self-test FAILED — ${line}`);
    console.error(`\nMessage key check: ${bad.length} self-test failures.\n`);
    process.exit(1);
  }
  console.log(`  self-test passed — ${FIXTURES.length} scope shapes resolved correctly.`);
}

/* ------------------------------------------------------------------ *
 * Walking the tree
 * ------------------------------------------------------------------ */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function main() {
  console.log("\nMessage key check");

  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  selfTest();

  const catalogues = {};
  for (const locale of ["en", "ne"]) {
    catalogues[locale] = JSON.parse(
      readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"),
    );
  }

  const unreadable = [];
  const files = SOURCE_DIRS.flatMap((dir) => {
    try {
      return walk(path.join(ROOT, dir));
    } catch (error) {
      unreadable.push(`${dir} — ${error.message}`);
      return [];
    }
  });

  /*
   * A DIRECTORY WE CANNOT READ IS NOT A DIRECTORY WITH NOTHING IN IT — the
   * same false green as the npm-audit envelope, and the rule check-contacts
   * and check-secrets both follow.
   */
  if (unreadable.length > 0 || files.length === 0) {
    console.error("");
    for (const entry of unreadable) console.error(`  UNREADABLE  ${entry}`);
    if (files.length === 0) console.error("  EMPTY       no source files found");
    console.error(
      "\n  This is NOT a pass. The check looked at less of the product than\n" +
        "  it is supposed to, which is indistinguishable from finding nothing.\n",
    );
    process.exit(2);
  }

  const missing = [];
  let checked = 0;
  let dynamicCount = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const { resolved, dynamic } = resolveFile(rel, readFileSync(file, "utf8"));
    dynamicCount += dynamic.length;

    for (const { key, line } of resolved) {
      checked += 1;
      const absent = ["en", "ne"].filter((l) => !hasKey(catalogues[l], key));
      if (absent.length > 0) {
        missing.push(`${key} — ${rel}:${line} (missing in ${absent.join(", ")})`);
      }
    }
  }

  console.log(`  ${files.length} files, ${checked} keys resolved`);
  console.log(`  ${dynamicCount} dynamic keys reported rather than guessed at`);

  if (missing.length > 0) {
    console.error("\nThe code asks for copy that does not exist:");
    for (const entry of [...new Set(missing)]) console.error(`  - ${entry}`);
    console.error(
      "\nnext-intl renders a missing key as its own dotted path, so each of\n" +
        "these prints onto a page instead of failing. Add the copy to BOTH\n" +
        "catalogues, or fix the key. `check:messages` cannot see this: it\n" +
        "compares en against ne, and a key absent from both agrees perfectly.\n",
    );
    process.exit(1);
  }

  console.log("  Every key the code asks for exists in both catalogues.\n");
}

main();
