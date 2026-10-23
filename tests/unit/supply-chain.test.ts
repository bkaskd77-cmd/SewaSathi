import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEPENDENCY_FLOORS,
  compareVersions,
  installedVersions,
  judgeFloors,
  parseVersion,
} from "../../scripts/dependency-floors.mjs";
import {
  INSTALL_SCRIPTS_EXPECTED,
  judgeInstallScripts,
} from "../../scripts/install-scripts.mjs";

/**
 * The supply chain: what may run, what version it must be, and how CI installs it.
 *
 * WHY EACH OF THESE IS A TEST AND NOT A HABIT. All three were measured failing or
 * absent on 2026-10-22:
 *
 *   - `check:advisories` asked `npm audit` and nothing else, and npm's feed was
 *     EIGHT DAYS behind a critical unauthenticated RCE in Next (CVSS 9.5) — and
 *     is still missing a second critical one that `next@16.4.1`'s own release
 *     notes name. A gate resting on one feed reports clean while a hole is open.
 *   - Every GitHub Action was referenced by a moving tag, so whoever controls
 *     `actions/checkout@v4` controlled a step running with a token that can push
 *     here and a hook that can deploy.
 *   - Install scripts were nobody's decision: five packages run code at `npm ci`
 *     time, and a sixth would have arrived as a diff nobody read.
 */

const WORKFLOWS = readdirSync(".github/workflows")
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => ({
    file: path.join(".github/workflows", f),
    text: readFileSync(path.join(".github/workflows", f), "utf8"),
  }));

const LOCK = JSON.parse(readFileSync("package-lock.json", "utf8"));

describe("GitHub Actions are pinned by commit, not by a moving tag", () => {
  it("finds the uses: lines, so a pattern that stopped matching fails", () => {
    /* The count first — a regex that quietly stopped matching would make the
       case below pass over an empty list, which is how a scanner comes to print
       a clean tick while scanning nothing. */
    expect(WORKFLOWS.length).toBeGreaterThan(0);
    const total = WORKFLOWS.reduce(
      (n, w) => n + [...w.text.matchAll(/uses:/g)].length,
      0,
    );
    expect(total).toBeGreaterThan(8);
  });

  it("pins every action to a 40-character SHA", () => {
    /*
     * A TAG IS A POINTER SOMEBODY ELSE CAN MOVE. `actions/checkout@v4` resolves
     * at run time to whatever that tag points at then, and these steps run with
     * a token that can push to this repository and, in the deploy job, with the
     * hook that puts a build into production. Pinning the commit means an
     * upstream account takeover cannot change what already runs here.
     */
    const unpinned: string[] = [];
    for (const { file, text } of WORKFLOWS) {
      for (const match of text.matchAll(/uses:\s*(\S+)/g)) {
        const ref = match[1];
        /* A local or docker action has no upstream tag to move. */
        if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
        if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(`${file}: ${ref}`);
      }
    }
    expect(
      unpinned,
      `Pin these to a commit SHA:\n  ${unpinned.join("\n  ")}\n\n` +
        "Resolve it with `git ls-remote --tags https://github.com/<owner>/<repo> " +
        "refs/tags/<tag>` and keep the tag in a trailing comment.",
    ).toEqual([]);
  });

  it("keeps the human-readable tag in a comment beside each SHA", () => {
    /*
     * A BARE SHA IS UNREVIEWABLE. Forty hex characters say nothing about which
     * release they are, so an upgrade becomes one opaque string replacing
     * another and nobody can tell a patch bump from a downgrade. The comment is
     * what makes the diff readable; the SHA is what makes it safe.
     */
    for (const { file, text } of WORKFLOWS) {
      for (const match of text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})(.*)$/gm)) {
        expect(
          match[2].trim(),
          `${file}: ${match[1]} has no version comment`,
        ).toMatch(/^#\s*v?\d+\.\d+/);
      }
    }
  });
});

describe("CI installs the lockfile and nothing else", () => {
  it("never reaches for npm install or npm i", () => {
    /*
     * `npm ci` INSTALLS THE LOCKFILE EXACTLY AND FAILS IF IT DISAGREES WITH
     * package.json. `npm install` is free to RESOLVE — it can pick up a newer
     * version inside a caret range and rewrite the lockfile, so what CI tested
     * would not be what the lockfile says and two runs of the same commit could
     * install different code. It is also what turns a floor into a guess: the
     * floors are read from the lockfile precisely because that is what ships.
     */
    const wrong: string[] = [];
    for (const { file, text } of WORKFLOWS) {
      for (const [i, line] of text.split("\n").entries()) {
        const code = line.replace(/#.*$/, "");
        if (/\bnpm\s+(install|i)\b/.test(code)) wrong.push(`${file}:${i + 1}`);
      }
    }
    expect(
      wrong,
      `Use \`npm ci\` in CI, not npm install:\n  ${wrong.join("\n  ")}`,
    ).toEqual([]);
  });

  it("installs with npm ci wherever it installs at all", () => {
    /* Not every workflow installs — `after-deploy.yml` runs plain Node with no
       imports beyond the standard library, deliberately. What matters is that
       the ones which DO install use `ci`, and that at least one does, so this
       case cannot pass over a set of workflows that stopped installing. */
    const installing = WORKFLOWS.filter((w) => /\bnpm\s+ci\b/.test(w.text));
    expect(installing.length).toBeGreaterThan(0);
  });
});

describe("the dependency floors", () => {
  it("covers the framework packages a critical advisory has already hit", () => {
    const names = DEPENDENCY_FLOORS.map((f: { package: string }) => f.package);
    expect(names).toContain("next");
    expect(names).toContain("react");
    expect(names).toContain("react-dom");
  });

  it("names the advisories that set each floor", () => {
    /*
     * A BARE MINIMUM VERSION IS A NUMBER THE NEXT READER CANNOT CHECK. The GHSA
     * is what lets somebody verify the floor is the right one — and what lets
     * them tell a security floor from a compatibility one, which are different
     * things with different rules about lowering them.
     */
    for (const floor of DEPENDENCY_FLOORS as Array<{
      package: string;
      advisories: string[];
      why: string;
    }>) {
      expect(floor.advisories.length, `${floor.package}`).toBeGreaterThan(0);
      for (const id of floor.advisories) {
        expect(id, `${floor.package}`).toMatch(/^GHSA-[\w-]+$/);
      }
      expect(floor.why.length, `${floor.package}'s reason`).toBeGreaterThan(80);
    }
  });

  it("holds against what the lockfile actually installs", () => {
    const rows = judgeFloors(installedVersions(LOCK));
    const bad = rows.filter(
      (r: { verdict: string }) => r.verdict !== "ok",
    );
    expect(
      bad.map((r: { package: string; version: string; minimum: string }) =>
        `${r.package} ${r.version} < ${r.minimum}`,
      ),
      "A floor is below its minimum. Upgrade in this commit.",
    ).toEqual([]);
  });

  it("reads the top-level version and not a nested copy", () => {
    /*
     * A NESTED `node_modules/x/node_modules/y` IS ANOTHER DEPENDENCY'S PRIVATE
     * COPY. Judging the floor against whichever sorted last would make the
     * verdict depend on the walk order, which is the kind of flake that gets a
     * security gate disabled.
     */
    const versions = installedVersions({
      packages: {
        "": { name: "root" },
        "node_modules/next": { version: "16.4.2" },
        "node_modules/vite/node_modules/next": { version: "1.0.0" },
      },
    });
    expect(versions.next).toBe("16.4.2");
  });

  it("fails on a version it cannot read, and says which side", () => {
    /*
     * UNREADABLE IS NOT A PASS — the `/api/health` rule on a security gate, and
     * the message names the side because the first version of it printed the
     * installed version while the FLOOR was the unreadable one.
     */
    const floors = [
      { package: "next", minimum: "nineteen", advisories: ["GHSA-x"], why: "x" },
    ];
    const bad = judgeFloors({ next: "16.4.2" }, floors)[0];
    expect(bad.verdict).toBe("unreadable");
    expect(bad.detail).toContain("floor");

    const missing = judgeFloors({}, floors)[0];
    expect(missing.verdict).toBe("unreadable");
    expect(missing.detail).toContain("lockfile");
  });

  it("sorts a prerelease below its release", () => {
    /*
     * THE DIRECTION THAT MATTERS: a canary carrying the version number of a fix
     * is not the fix. `16.4.1-canary.3` must not satisfy a floor of `16.4.1`.
     */
    expect(compareVersions("16.4.1-canary.3", "16.4.1")).toBeLessThan(0);
    expect(compareVersions("16.4.1", "16.4.1")).toBe(0);
    expect(compareVersions("16.4.2", "16.4.1")).toBeGreaterThan(0);
    expect(compareVersions("16.10.0", "16.9.0")).toBeGreaterThan(0);
    expect(compareVersions("17.0.0", "16.99.99")).toBeGreaterThan(0);
    expect(compareVersions("nope", "1.0.0")).toBeNull();
    expect(parseVersion("1.2.3")).not.toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("install scripts are declared, not discovered later", () => {
  it("has an entry for everything the lockfile runs at install time", () => {
    const { actual, undeclared } = judgeInstallScripts(LOCK);
    /* The count first, as above. */
    expect(actual.length).toBeGreaterThan(0);
    expect(
      undeclared.map((one: { name: string; scope: string }) =>
        `${one.name} (${one.scope})`,
      ),
      "An install script runs with the privileges of whoever typed `npm ci` — " +
        "on CI that is a token that can push here and a hook that can deploy. " +
        "Declare it in scripts/install-scripts.mjs with what pulls it in, or " +
        "remove the dependency.",
    ).toEqual([]);
  });

  it("declares nothing the lockfile no longer runs", () => {
    /* A stale entry waives whatever takes that package's name next — the rule
       `no-caller` and `routes-reachable` both keep for their exemptions. */
    const { stale } = judgeInstallScripts(LOCK);
    expect(stale, "Remove these from scripts/install-scripts.mjs").toEqual([]);
  });

  it("notices one moving between the dev and production trees", () => {
    const { misclassified } = judgeInstallScripts(LOCK);
    expect(
      misclassified.map((one: { name: string; scope: string }) =>
        `${one.name} is now ${one.scope}`,
      ),
      "A dev install script reaching the production tree is a different " +
        "decision from the one that was made.",
    ).toEqual([]);
  });

  it("says what pulls each one in, and why it stays", () => {
    for (const [name, entry] of Object.entries(
      INSTALL_SCRIPTS_EXPECTED as Record<
        string,
        { scope: string; script: string; pulledBy: string; why: string }
      >,
    )) {
      expect(["dev", "prod"]).toContain(entry.scope);
      expect(entry.pulledBy.length, `${name}.pulledBy`).toBeGreaterThan(3);
      /* "a helper" is not a reason; what needs it and what breaks without it is. */
      expect(entry.why.length, `${name}.why`).toBeGreaterThan(80);
      /* The command, so the claim is checkable against disk below. */
      expect(entry.script.length, `${name}.script`).toBeGreaterThan(0);
    }
  });

  it("describes the command each one actually runs", () => {
    /*
     * THE CASE THAT WOULD HAVE CAUGHT THREE WRONG DESCRIPTIONS. `@swc/core` and
     * `fsevents` were both written up as "npm flags a script and the package
     * declares none" — and both declare one; the false claim came from reading a
     * path that does not exist, getting an exception, and writing the lockfile's
     * bare `hasInstallScript` flag up as harmless. `@parcel/watcher` was then
     * described from npm 11's warning text (`node-gyp rebuild`) rather than from
     * its manifest (`node scripts/build-from-source.js`).
     *
     * The reasons were prose, so nothing could check them. This compares the
     * declared command against the package's own `package.json`, which turns the
     * claim into a fact a run can refuse. A copy that is not installed on this
     * platform is skipped rather than failed — `fsevents` is darwin-only, and
     * failing on it would make the guard unrunnable on every Linux runner.
     */
    const { misdescribed } = judgeInstallScripts(LOCK);
    expect(
      misdescribed.map(
        (one: { name: string; script: string }) =>
          `${one.name}: disk says ${JSON.stringify(one.script)}`,
      ),
      "Update `script` in scripts/install-scripts.mjs to what the package declares.",
    ).toEqual([]);
  });

  it("reports a nested copy under its own package name", () => {
    /*
     * `next-intl/node_modules/@swc/core` IS `@swc/core`: the question is which
     * CODE runs at install time, and a private copy runs the same script as a
     * top-level one. Keying on the path would let the same script in through a
     * different parent.
     */
    const rows = judgeInstallScripts(
      {
        packages: {
          "node_modules/a/node_modules/b": { hasInstallScript: true, dev: true },
        },
      },
      { b: { scope: "dev", pulledBy: "a", why: "x" } } as never,
    );
    /* `script` is null because the synthetic lock names no package on disk —
       unreadable, which this deliberately does not read as "declares none". */
    expect(rows.actual).toEqual([{ name: "b", scope: "dev", script: null }]);
    expect(rows.undeclared).toEqual([]);
  });

  it("calls a package in both trees a production one", () => {
    /* Prod is the stricter fact: a script reachable without `--include=dev`
       runs on a production install, whatever else also pulls it. */
    const rows = judgeInstallScripts(
      {
        packages: {
          "node_modules/x": { hasInstallScript: true, dev: true },
          "node_modules/y/node_modules/x": { hasInstallScript: true },
        },
      },
      { x: { scope: "prod", pulledBy: "y", why: "x" } } as never,
    );
    expect(rows.actual).toEqual([{ name: "x", scope: "prod", script: null }]);
    expect(rows.misclassified).toEqual([]);
  });
});

/**
 * The typed-array fix is present in the vendored RSC runtime we actually ship.
 *
 * WHY THIS IS A TEST AND NOT A SENTENCE IN `SECURITY.md`. `GHSA-673q-mjm6-r5xr`
 * — unauthenticated RCE in `use cache` functions returning typed arrays — is
 * fixed in `next@16.4.1`, and nothing in this repository could say which BYTES
 * make that true. The floor says `16.4.1` because a release note says so, and a
 * floor is a number somebody read; this is the fix itself, in the tree.
 *
 * IT ALSO SETTLES THE ARGUMENT A VERSION STRING COULD NOT. The vendored copies
 * live in `next/dist/compiled/` and are rebuilt bundles, so the backport changed
 * the code and left the version string alone: `16.4.0` and `16.4.1` both report
 * `19.3.0-canary-278794d7-20261002`, 16.4.1 changed 50 files and every one of
 * them is a `react-server-dom-*` bundle, and the guard below appears only in the
 * later one. An earlier reading of this question recorded "no React bump" as
 * evidence of absence, which is exactly the inference this case refuses.
 *
 * KEYED ON THE FUNCTION, NEVER A FILE LIST. Every bundle that defines
 * `emitTypedArrayChunk` is a serializer that can emit a typed array, so each one
 * must carry the guard — 24 of 24 on `next@16.4.2`. A filename list would go
 * stale the first time Next renamed a bundle, and would pass over the renamed
 * one in silence.
 */
describe("the vendored React Server Components runtime carries the typed-array fix", () => {
  const VENDORED = "node_modules/next/dist/compiled";

  function rscBundles(): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    for (const dir of readdirSync(VENDORED)) {
      if (!dir.startsWith("react-server-dom-")) continue;
      const cjs = path.join(VENDORED, dir, "cjs");
      for (const f of readdirSync(cjs)) {
        if (!f.endsWith(".js")) continue;
        const file = path.join(cjs, f);
        const text = readFileSync(file, "utf8");
        if (text.includes("function emitTypedArrayChunk")) out.push({ file, text });
      }
    }
    return out;
  }

  it("finds the serializers, so a moved path fails rather than passing over nothing", () => {
    /*
     * THE COUNT FIRST, `no-caller`'s and `drift-token`'s rule. If Next ever
     * moves `dist/compiled/` or renames the packages, this reads zero bundles
     * and every assertion below passes over an empty list — a scanner that has
     * stopped scanning printing the same tick as one that found nothing wrong.
     * Failing here is correct: a moved path means the question needs asking
     * again, not assuming.
     */
    expect(rscBundles().length).toBeGreaterThanOrEqual(8);
  });

  it("copies a typed array that is a view into a larger buffer, in every one", () => {
    /*
     * The three conditions are the defect: several typed arrays over ONE shared
     * `ArrayBuffer` is what the advisory's title describes, and before the fix
     * `emitTypedArrayChunk` enqueued a live view into that buffer rather than a
     * copy — mutable, detachable and resizable between enqueue and flush.
     *
     * Asserted as behaviour-bearing SOURCE rather than by running it: these are
     * minified bundles with no export anybody can call, so the text is the only
     * reachable evidence. That is the same trade `check:secrets`' source pass
     * makes, and the count case above is what keeps it honest.
     */
    const missing = rscBundles()
      .filter(
        ({ text }) =>
          !text.includes("typedArray.buffer.resizable") ||
          !text.includes("typedArray.byteLength !== typedArray.buffer.byteLength") ||
          !text.includes("supportsArrayBufferDetached"),
      )
      .map(({ file }) => file);

    expect(
      missing,
      `These vendored React Server Components serializers emit a typed array ` +
        `without copying a view into a larger buffer first:\n  ` +
        `${missing.join("\n  ")}\n\n` +
        `That is GHSA-673q-mjm6-r5xr — unauthenticated RCE in \`use cache\` ` +
        `functions returning typed arrays — which \`next@16.4.1\` fixed by ` +
        `backporting into these bundles WITHOUT changing the React canary ` +
        `version they report. So a version string cannot tell you whether the ` +
        `fix is here and this case can. Check what moved \`next\` before ` +
        `touching this test.`,
    ).toEqual([]);
  });

  it("holds `next` at or above the release that carries it", () => {
    /* The floor and this case are two halves of one claim: the floor says which
       version, this says which bytes. Pinned together so a lowered floor cannot
       quietly outlive the reason it exists. */
    const floor = DEPENDENCY_FLOORS.find((one) => one.package === "next");
    expect(floor?.advisories).toContain("GHSA-673q-mjm6-r5xr");
    expect(compareVersions(floor?.minimum, "16.4.1")).toBeGreaterThanOrEqual(0);
  });
});
