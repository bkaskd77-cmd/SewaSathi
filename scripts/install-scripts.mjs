/**
 * Every dependency allowed to run code at install time, and why it may.
 *
 * WHAT AN INSTALL SCRIPT IS, IN THE TERMS THAT MATTER HERE. `preinstall`,
 * `install` and `postinstall` run with the privileges of whoever typed
 * `npm ci` — on a developer's machine, and on a CI runner that holds a token
 * able to push to this repository and a deploy hook able to put a build into
 * production. It is the one place a dependency executes before anybody has read
 * a line of it, which makes it the shortest path from a compromised package to
 * our deploy. `npm audit` says nothing about it.
 *
 * SO THE INVENTORY IS DECLARED AND THE SCAN FINDS THE REST — `no-caller`'s and
 * `unarmed-levers`' arrangement, and the same answer to the same objection: a
 * list of packages to check has the blind spot it exists to close, so the list
 * holds the exceptions and a NEW install script fails until somebody decides
 * about it. The point is not that today's five are frightening; it is that the
 * sixth should arrive as a decision rather than as a diff nobody read.
 *
 * NOTHING HERE IS REMOVABLE, WHICH IS THE HONEST ANSWER AND NOT A SHRUG. Each
 * entry names the dependency that pulls it, and in every case that dependency
 * is one the product or the suite genuinely needs. `ignore-scripts` was weighed
 * and refused: it would leave `unrs-resolver` without its native binary, so
 * `npm run lint` would stop enforcing every module boundary in
 * ARCHITECTURE.md, and a gate nobody can run is worse than a gate that names
 * its risk. What would change the answer is a package appearing here that
 * nothing needs.
 *
 * **AND THE COMMAND IS DECLARED, BECAUSE TWO OF THESE REASONS WERE FALSE.**
 * `@swc/core` and `fsevents` were both written up as 'npm flags a script and
 * the package declares none' — and both declare one. The reasons were prose,
 * so nothing could check them; `script` is compared against the package's own
 * `package.json` on disk now, which turns the claim into a fact a run can
 * refuse. The guard caught neither, because it only ever asked whether a
 * package was declared and never whether the declaration was true.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Keyed by package name as the lockfile names it.
 *
 * `pulledBy` IS PART OF THE DECISION, not decoration: an install script is
 * tolerable because something we chose requires it, so the entry has to say
 * what that is. If the parent ever goes, the entry goes with it, and the stale
 * check below is what says so.
 */
export const INSTALL_SCRIPTS_EXPECTED = {
  "@parcel/watcher": {
    scope: "prod",
    /* The package's OWN declaration, which is what runs. npm 11's
       install-scripts warning prints `node-gyp rebuild` for it — a sensible
       summary of what the script ends up doing, and not what the manifest
       says. Taking npm's word for it was this entry's third wrong
       description, caught by the comparison below rather than by reading. */
    script: "node scripts/build-from-source.js",
    pulledBy: "next-intl (a non-optional dependency of it)",
    why:
      "A native file watcher, and one of two install scripts in the PRODUCTION " +
      "tree. `next-intl` requires it outright, and next-intl is the whole i18n " +
      "layer of this product — Nepali is a first-class path here, so removing " +
      "it is not a dependency decision but a product one. It compiles only " +
      "when no prebuilt binary matches the platform; the lockfile carries " +
      "prebuilds for all twelve platforms including linux-x64-glibc, so on " +
      "Vercel and on CI it resolves to a download rather than a compiler.",
  },
  "@swc/core": {
    scope: "prod",
    script: "node postinstall.js",
    pulledBy: "next-intl",
    why:
      "THIS ENTRY SAID IT DECLARED NO SCRIPT AND THAT WAS WRONG. It reads " +
      "`postinstall: node postinstall.js` — a native binary fetch — confirmed " +
      "against the registry and against the copy on disk. The false claim came " +
      "from reading `node_modules/@swc/core/package.json`, a path that does not " +
      "exist (the copy is nested under next-intl), getting an exception, and " +
      "writing the lockfile's bare `hasInstallScript` flag up as 'flagged but " +
      "harmless'. It is the second install script in the production tree, and " +
      "next-intl requires it the same way it requires the watcher.",
  },
  fsevents: {
    scope: "dev",
    script: "node-gyp rebuild",
    pulledBy: "chokidar, via tailwindcss",
    why:
      "WRONG IN THIS ENTRY TOO, and in the same way: it said the scripts block " +
      "was empty. `fsevents@2.3.3` declares `install: node-gyp rebuild`. What " +
      "was right is the part that makes it harmless — `os: [\"darwin\"]` and " +
      "optional, so it is never installed on Linux, which is every CI runner " +
      "and every Vercel build. The compile can only happen on a developer's " +
      "Mac, and that is the honest statement rather than 'it has no script'.",
  },
  "unrs-resolver": {
    scope: "dev",
    script: "node postinstall.js",
    pulledBy: "eslint-import-resolver-typescript",
    why:
      "Its `postinstall` fetches a native resolver binary. It is what lets " +
      "`no-restricted-imports` resolve `@/` paths, which is the rule enforcing " +
      "every module boundary in ARCHITECTURE.md — so without it `npm run lint` " +
      "stops enforcing the one architectural guarantee this product has. It is " +
      "also the entry that makes a blanket `ignore-scripts` unusable, now that " +
      "`esbuild` has left the tree.",
  },
};

/**
 * `{ name, scope }` for every package the lockfile marks as running a script.
 *
 * THE LOCKFILE IS THE ORACLE, not `node_modules`, for the reason the floors use
 * it too: `npm ci` installs the lockfile, so what it declares is what will run.
 * A scan of an installed tree would also miss a platform-specific package that
 * did not install here and WILL install on the runner.
 *
 * A NESTED COPY IS REPORTED UNDER ITS OWN NAME. `next-intl/@swc/core` is
 * `@swc/core`: the question is which CODE runs, and a private copy of a package
 * runs the same script as a top-level one.
 */
/**
 * The install script a package actually declares, read off disk.
 *
 * NULL MEANS "COULD NOT READ", NEVER "DECLARES NONE" — rule 6, and the exact
 * confusion that made two of these entries false. A platform-specific package
 * that did not install here (`fsevents` on Linux) is unreadable, and reading
 * that as "no script" is how it got written up as harmless.
 */
function declaredScript(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    for (const hook of ["preinstall", "install", "postinstall"]) {
      if (scripts[hook]) return scripts[hook];
    }
    return "";
  } catch {
    return null;
  }
}

export function installScriptsIn(lock) {
  const found = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key || !entry?.hasInstallScript) continue;
    const name = key.replace(/^(?:.*\/)?node_modules\//, "");
    const scope = entry.dev ? "dev" : "prod";
    const script = declaredScript(key);
    /* Prod outranks dev: the same package reachable both ways is in the
       production tree, which is the stricter fact about it. A readable script
       outranks an unreadable one for the same reason — one copy on disk is
       evidence and a missing copy is not. */
    const existing = found.get(name);
    if (
      !existing ||
      (existing.scope === "dev" && scope === "prod") ||
      (existing.script === null && script !== null)
    ) {
      found.set(name, { scope, script: script ?? existing?.script ?? null });
    }
  }
  return [...found]
    .map(([name, one]) => ({ name, ...one }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the inventory and the lockfile disagree about.
 *
 * BOTH DIRECTIONS, because they are different problems. An UNDECLARED script is
 * install-time code nobody weighed. A STALE entry is worse in the quiet way the
 * repo keeps recording: it waives whatever takes that package's name next, so a
 * dependency that disappears has to take its waiver with it. A MISCLASSIFIED
 * one — declared `dev` and now in the production tree — is the one that would
 * otherwise read as fine, so it is named separately.
 */
export function judgeInstallScripts(lock, expected = INSTALL_SCRIPTS_EXPECTED) {
  const actual = installScriptsIn(lock);
  const names = new Set(actual.map((one) => one.name));

  return {
    actual,
    undeclared: actual.filter((one) => !(one.name in expected)),
    /*
     * THE DECLARED COMMAND AGAINST THE ONE ON DISK, which is the case that
     * would have caught `@swc/core` and `fsevents` being written up as
     * scriptless. An UNREADABLE copy is skipped rather than failed: a
     * darwin-only package is genuinely absent on every runner, and failing on
     * it would make the whole guard unrunnable on Linux. That is the cost of
     * the check and it is stated rather than hidden — what it covers is every
     * package actually installed here.
     */
    misdescribed: actual.filter(
      (one) =>
        expected[one.name] &&
        one.script !== null &&
        expected[one.name].script !== one.script,
    ),
    stale: Object.keys(expected).filter((name) => !names.has(name)),
    misclassified: actual.filter(
      (one) => expected[one.name] && expected[one.name].scope !== one.scope,
    ),
  };
}
