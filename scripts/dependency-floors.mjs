/**
 * The versions this product may not fall below, and why.
 *
 * WHY A FLOOR EXISTS AT ALL, AND IT IS A MEASURED FAILURE RATHER THAN A
 * PRECAUTION. `check:advisories` asks `npm audit`, which answers out of npm's
 * own advisory mirror — and that feed is both LATE and INCOMPLETE. Both halves
 * were measured on 2026-10-22:
 *
 *   LATE.  GHSA-2464-fhr4-w9xw — unauthenticated RCE in the Next image
 *          optimiser, critical, CVSS 9.5 — was published 2026-10-14, the same
 *          day `next@16.4.1` and `next@15.5.28` were published to fix it. This
 *          project sat on `next@16.3.8` from then until the 22nd. CI ran the
 *          advisories job on the 15th, 16th, 17th, 18th and 19th and it passed
 *          every time, because npm's feed did not yet carry the 16.x range. It
 *          began failing between runs 339 and 340 on the 22nd — 17:05 and
 *          17:23, on commits whose content was a markdown file and a test. The
 *          gate was eight days behind the advisory.
 *
 *   INCOMPLETE. `next@16.4.1`'s own release notes name THREE advisories it
 *          fixes. npm's feed carries two. GHSA-673q-mjm6-r5xr — unauthenticated
 *          RCE in `use cache` functions returning typed arrays, critical — is
 *          absent from `npm audit` at the time of writing, nine days after it
 *          was published. Asking npm would never have found it.
 *
 * SO THIS PASS ASKS A DIFFERENT QUESTION AND NEEDS NO NETWORK: not "does any
 * feed report a problem today", but "is the installed version at or above the
 * one a named advisory says is safe". A floor is a fact somebody read and wrote
 * down, so it cannot lag, cannot be incomplete, and cannot answer differently
 * on two days from the same lockfile. The audit pass stays, because it is what
 * finds advisories nobody here has heard of; this is what stops a known one
 * being invisible.
 *
 * IT IS NOT A SUBSTITUTE FOR UPGRADING. A floor is the minimum, the lockfile is
 * what ships, and an entry here is a note that somebody read an advisory. When
 * a new one lands, raise the floor in the same commit as the upgrade — that is
 * the whole maintenance cost, and it is the cost of not trusting one feed.
 *
 * `scripts/` RATHER THAN `lib/config/`, DELIBERATELY: this is read by a build
 * gate and by its test, never by the product, and `lib/` is on the import graph
 * of pages.
 */

/**
 * One package, the version it must be at least, and the advisories that say so.
 *
 * EVERY ENTRY NAMES ITS ADVISORIES, because a bare minimum version is a number
 * the next reader cannot check. `why` says what the exposure is for THIS
 * product rather than restating the advisory title — a generic summary is one
 * nobody weighs.
 */
export const DEPENDENCY_FLOORS = [
  {
    package: "next",
    minimum: "16.4.1",
    advisories: [
      "GHSA-2464-fhr4-w9xw",
      "GHSA-p3m5-59mp-jv5r",
      "GHSA-673q-mjm6-r5xr",
    ],
    why:
      "Three advisories, two of them critical unauthenticated RCE, all fixed " +
      "in 16.4.1 (published 2026-10-14). The image-optimiser one is not " +
      "theoretical here: customers upload photographs of a problem and " +
      "professionals upload arrival and claim evidence, all of it through " +
      "that path, which is why `lib/security/image.ts` reads magic bytes " +
      "rather than a content type. The Server Actions denial of service is in " +
      "how every write in this product is made.",
  },
  {
    package: "sharp",
    minimum: "0.35.5",
    advisories: ["GHSA-wq5f-xc86-pv6w", "GHSA-2464-fhr4-w9xw"],
    why:
      "THE FLOOR THAT ACTUALLY FIXES THE IMAGE RCE, where the `next` floor " +
      "above only carries the version that bundles it. The chain is on the " +
      "record in both advisories rather than inferred: librsvg's " +
      "CVE-2026-96889 (use-after-free) reaches us through sharp, so " +
      "GHSA-wq5f-xc86-pv6w is `sharp <0.35.5`; and GHSA-2464-fhr4-w9xw, the " +
      "Next critical, says in its own words that \"a memory-related " +
      "vulnerability has been discovered in an upstream library used for " +
      "Image Optimization\", carries CWE-1395 (dependency on a vulnerable " +
      "third-party component), references that same CVE, and gives as its " +
      "WORKAROUND: \"Ensure the version of `sharp` used by Next.js is greater " +
      "than or equal to 0.35.5.\" " +
      "SO IT IS LISTED SEPARATELY FROM `next` ON PURPOSE. sharp is an " +
      "OPTIONAL dependency of next (`^0.35.5`), which means the range can " +
      "resolve anywhere a future lockfile puts it, and the Next version alone " +
      "would not say whether the library carrying the bug had moved. 0.35.5 " +
      "also clears every sharp advisory there is — five historically, zero " +
      "affecting it. This matters here beyond the framework: customers upload " +
      "photographs of a problem and professionals upload arrival and claim " +
      "evidence, all of it through that path.",
  },
  {
    package: "react",
    minimum: "19.3.1",
    advisories: ["GHSA-xqc2-xf4c-x3h3"],
    why:
      "The React release train of 2026-10-14, which fixes an unauthenticated " +
      "RCE in React Server Components (critical, CVSS 9.5). The packages the " +
      "advisory NAMES are react-server-dom-webpack, -parcel and -turbopack, " +
      "and this project depends on none of them directly — Next vendors its " +
      "own copies. The floor is on `react` anyway, because 19.3.1 is the " +
      "release that carries the fix and staying on 19.3.0 is staying on the " +
      "pre-fix train, which is a position nobody chose.",
  },
  {
    package: "react-dom",
    minimum: "19.3.1",
    advisories: ["GHSA-xqc2-xf4c-x3h3"],
    why:
      "Published in lockstep with `react` — the React monorepo releases its " +
      "packages together, which is why the advisory's patched versions read as " +
      "a train (19.0.9, 19.1.10, 19.2.9, 19.3.1) rather than as one number. " +
      "Same reasoning as the entry above, and the pair must move together: a " +
      "`react` and a `react-dom` from different trains is a configuration " +
      "React does not support and will warn about at runtime.",
  },
];

/**
 * `1.2.3` → `[1, 2, 3]`, and a prerelease sorts BELOW its release.
 *
 * WRITTEN OUT RATHER THAN TAKEN FROM `semver`, which is in the tree only as a
 * transitive dependency of something else — reaching for it would make a build
 * gate depend on a package nobody chose, which is the shape this whole file is
 * about. Three numbers and a prerelease flag is all a floor needs.
 *
 * A PRERELEASE IS BELOW THE RELEASE, so `16.4.1-canary.3` does not satisfy a
 * floor of `16.4.1`. That is the direction that matters: a canary carrying the
 * version number of a fix is not the fix.
 */
export function parseVersion(raw) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+](.*))?$/.exec(String(raw).trim());
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** Negative, zero or positive, like any comparator. Null for an unreadable pair. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] - right.parts[i];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * Every floor judged against the versions actually installed.
 *
 * THREE OUTCOMES AND THE THIRD IS THE ONE THAT MATTERS: `ok`, `below`, and
 * `unreadable` — a package the lockfile does not name, or a version string this
 * cannot parse. Reading an unreadable version as satisfying the floor would be
 * the `/api/health` mistake on a security gate, so it fails, and the reason
 * says which of the two it is.
 */
export function judgeFloors(installed, floors = DEPENDENCY_FLOORS) {
  return floors.map((floor) => {
    const version = installed[floor.package];
    if (version === undefined || version === null) {
      return { ...floor, version: null, verdict: "unreadable", detail: "not in the lockfile" };
    }
    const order = compareVersions(version, floor.minimum);
    if (order === null) {
      /* WHICH SIDE, because the first version of this message printed the
         installed version while the FLOOR was the unreadable one — found by
         break-testing with a floor of "nineteen" and reading the output. A
         diagnostic that names the wrong value sends the reader to the wrong
         file, which costs exactly what the check saved. */
      const bad = parseVersion(version) === null ? "installed" : "floor";
      const value = bad === "installed" ? version : floor.minimum;
      return {
        ...floor,
        version,
        verdict: "unreadable",
        detail: `cannot read the ${bad} version "${value}"`,
      };
    }
    /* `detail` on every branch, so the returned shape is one shape: a union
       where only two of three members carry it makes every caller narrow before
       it can print the reason, and the reason is the whole value of a refusal. */
    return {
      ...floor,
      version,
      verdict: order >= 0 ? "ok" : "below",
      detail: order >= 0 ? "" : `below the floor of ${floor.minimum}`,
    };
  });
}

/**
 * `{ next: "16.4.2", … }` from a parsed `package-lock.json`.
 *
 * THE LOCKFILE, NOT `package.json`, because the range is not what ships: CI
 * installs with `npm ci`, which installs the lockfile and nothing else, and a
 * caret range would let this gate pass on a version nobody has.
 *
 * TOP LEVEL ONLY — `node_modules/<name>` and not a nested copy. A nested one is
 * a different dependency's private copy, and judging the floor against whichever
 * happened to sort last would make the verdict depend on the walk order.
 */
export function installedVersions(lock) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    if (match && entry?.version) out[match[1]] = entry.version;
  }
  return out;
}
