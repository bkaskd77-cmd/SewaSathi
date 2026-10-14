import { describe, expect, it } from "vitest";

// A plain Node script with no types; `allowJs` resolves it.
import {
  COULD_NOT_LOOK,
  LANDED,
  STALE,
  stamp,
  verdict,
} from "../../scripts/await-deploy.mjs";

/**
 * The wait that lets the post-deploy checks run at all.
 *
 * WHY IT IS TESTED HERE. This script runs on one branch, in one job, once per
 * production push — so between one push and the next nothing else exercises it,
 * which is the same reason `check-deployed.mjs` carries a `--self-test`. And
 * the thing it would break quietly is the exit-code contract: a version that
 * returned 2 for a stale production would make "we are serving last week's
 * build" indistinguishable from "the network is blocked", which is the
 * `/api/health` 503 story — one state nobody can act on swallowing every state
 * somebody could.
 */

const COMMIT = "a34478a55a066244e481a594d19403d93485162d";

describe("the build stamp is read off the page", () => {
  it("finds the meta the layout renders", () => {
    expect(
      stamp(`<head><meta name="x-build-commit" content="${COMMIT}"/></head>`),
    ).toBe(COMMIT);
  });

  it("is not confused by another meta beside it", () => {
    const head = `<meta name="og:url" content="https://example.test"/>
      <meta name="x-build-commit" content="${COMMIT}"/>`;
    expect(stamp(head)).toBe(COMMIT);
  });

  it("returns null when the build predates the stamp", () => {
    // Null, never the empty string: "there is nothing to compare" and "it
    // serves a commit called nothing" are different answers, and only one of
    // them is a finding.
    expect(stamp("<head><title>SajiloKaam</title></head>")).toBeNull();
  });
});

describe("the three answers are three different answers", () => {
  it("passes when the alias serves the commit CI is deploying", () => {
    expect(verdict({ reached: true, serving: COMMIT, commit: COMMIT })).toBe(
      LANDED,
    );
  });

  it("is a FINDING when the alias serves something else", () => {
    /*
     * The fault this whole chain exists for: four commits once sat on the
     * branch while production served an older build, and it was caught by a
     * person reading the HTML.
     */
    expect(
      verdict({ reached: true, serving: "0".repeat(40), commit: COMMIT }),
    ).toBe(STALE);
  });

  it("is NOT a finding when the site could not be reached", () => {
    expect(verdict({ reached: false, serving: null, commit: COMMIT })).toBe(
      COULD_NOT_LOOK,
    );
  });

  it("is NOT a finding when the page carries no stamp", () => {
    // Reached, read, and nothing to compare. Calling that stale would report a
    // fault about a build that may be perfectly current.
    expect(verdict({ reached: true, serving: null, commit: COMMIT })).toBe(
      COULD_NOT_LOOK,
    );
  });

  it("keeps the two failures distinguishable, which is the whole point", () => {
    expect(STALE).not.toBe(COULD_NOT_LOOK);
    expect(LANDED).toBe(0);
  });
});
