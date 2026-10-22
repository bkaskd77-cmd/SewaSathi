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
 * and refused: it would leave `esbuild` without its platform binary, so
 * `npm run test` would not start, and a gate nobody can run is worse than a
 * gate that names its risk. What would change the answer is a package appearing
 * here that nothing needs.
 */

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
    pulledBy: "next-intl (a non-optional dependency of it)",
    why:
      "A native file watcher, and the only install script in the PRODUCTION " +
      "tree. `next-intl` requires it outright, and next-intl is the whole i18n " +
      "layer of this product — Nepali is a first-class path here, so removing " +
      "it is not a dependency decision but a product one. Its `install` step " +
      "is `node scripts/build-from-source.js`, which compiles only when no " +
      "prebuilt binary matches the platform; the lockfile carries prebuilds " +
      "for all twelve platforms including linux-x64-glibc, so on Vercel and on " +
      "CI it resolves to a download rather than a compiler.",
  },
  esbuild: {
    scope: "dev",
    pulledBy: "vite, via vitest",
    why:
      "Its `postinstall` fetches the platform binary that `esbuild` IS. " +
      "Without it vitest cannot start, so `npm run test` — the gate this whole " +
      "repository rests on — does not run. This is the entry that makes a " +
      "blanket `ignore-scripts` unusable, and it is dev-only: it is never " +
      "installed by a production build.",
  },
  fsevents: {
    scope: "dev",
    pulledBy: "chokidar, via vite",
    why:
      "Flagged as having an install script and has none — its `scripts` block " +
      "is empty. It is darwin-only and optional, so it is not installed on " +
      "Linux at all, which is every CI runner and every build. Listed rather " +
      "than filtered out, because 'npm says it has one and it does not' is a " +
      "fact worth a line instead of a surprise.",
  },
  "@swc/core": {
    scope: "prod",
    pulledBy: "next-intl",
    why:
      "Same flag, same emptiness: the lockfile marks it as having an install " +
      "script and the package declares none. Kept in the inventory so the " +
      "count matches what the lockfile says rather than what somebody filtered.",
  },
  "unrs-resolver": {
    scope: "dev",
    pulledBy: "eslint-import-resolver-typescript",
    why:
      "Its `postinstall` fetches a native resolver binary. It is what lets " +
      "`no-restricted-imports` resolve `@/` paths, which is the rule enforcing " +
      "every module boundary in ARCHITECTURE.md — so without it `npm run lint` " +
      "stops enforcing the one architectural guarantee this product has. " +
      "Dev-only, like esbuild.",
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
export function installScriptsIn(lock) {
  const found = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key || !entry?.hasInstallScript) continue;
    const name = key.replace(/^(?:.*\/)?node_modules\//, "");
    const scope = entry.dev ? "dev" : "prod";
    /* Prod outranks dev: the same package reachable both ways is in the
       production tree, which is the stricter fact about it. */
    const existing = found.get(name);
    if (!existing || (existing === "dev" && scope === "prod")) {
      found.set(name, scope);
    }
  }
  return [...found].map(([name, scope]) => ({ name, scope })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
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
    stale: Object.keys(expected).filter((name) => !names.has(name)),
    misclassified: actual.filter(
      (one) => expected[one.name] && expected[one.name].scope !== one.scope,
    ),
  };
}
