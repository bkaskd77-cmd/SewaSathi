import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_TOOLS } from "@/lib/data/admin-tools";

/**
 * Every admin screen can be reached by clicking.
 *
 * THE BUG THIS EXISTS FOR WAS REPORTED BY THE OWNER, who had built the
 * enforcement ladder and could not find it. `/admin/enforcement` was complete —
 * the board, the five steps, the jobs rescued when somebody is suspended,
 * `/providers/standards` publishing the policy it applies — and **nothing
 * anywhere linked to it**. It was reachable only by typing the URL, for the
 * whole life of the feature, so the real answer to a dangerous professional was
 * still effectively hand-written SQL.
 *
 * NOTHING COULD HAVE CAUGHT IT, which is the part worth fixing rather than the
 * one link. `check:deployed` walks that route and proved it deploys and is
 * guarded; `check:keys` proved its copy exists; the db suite proved its writes
 * are locked down. Every guard passed, because "does it work" and "can anybody
 * find it" are different questions and only the first had an answer.
 *
 * IT READS THE DIRECTORY RATHER THAN A LIST, which is `coverageGaps`' rule in
 * `check:deployed`: a screen nobody listed is exactly the screen that goes
 * unlinked, so a maintained list of screens-to-check would have the same blind
 * spot as the index itself. The exceptions below are declared with a reason
 * each, and the test fails on an exception that no longer exists — because a
 * stale exemption is how the next screen slips through.
 */

const ADMIN_DIR = "app/[locale]/(admin)/admin";

/**
 * Screens that are deliberately not on the index, each with why.
 *
 * A REASON PER ENTRY, NOT A LIST OF PATHS. "It is fine" is what makes an
 * exemption list grow until it covers the thing it was meant to catch.
 */
const NOT_ON_THE_INDEX: Record<string, string> = {
  "/admin":
    "It IS the index. Linking to itself is the one path that cannot be missing.",
  "/admin/login":
    "The signed-out door. The index requires a session, so somebody who needs this screen cannot be looking at the index.",
  "/admin/content/categories":
    "Reached from /admin/content, which is on the index and links to both of its children.",
  "/admin/content/documents":
    "Reached from /admin/content, as above.",
};

/** Every static route under the admin group — no dynamic segments. */
function adminRoutes(dir = ADMIN_DIR, prefix = "/admin"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "page.tsx") {
      found.push(prefix);
      continue;
    }
    if (!statSync(path).isDirectory()) continue;
    /*
     * A DYNAMIC SEGMENT IS NOT A SCREEN SOMEBODY NAVIGATES TO. `[id]` and
     * `[...slug]` are opened from a row on their parent, so there is no link
     * for the index to carry and demanding one would be noise.
     */
    if (entry.startsWith("[")) continue;
    found.push(...adminRoutes(path, `${prefix}/${entry}`));
  }
  return found;
}

/** Every `/admin/...` href the index itself renders. */
function hrefsOnTheIndex(): Set<string> {
  const tools = ADMIN_TOOLS.map((tool) => tool.href);
  /*
   * THE QUEUE HREFS ARE READ OUT OF THE SOURCE rather than imported, because
   * `lib/data/admin-queues.ts` is `server-only` and builds each card around a
   * live count. What is needed here is only which paths it names, and a regex
   * over `href: "/admin/..."` cannot cry wolf: every match is a literal href.
   */
  const source = readFileSync("lib/data/admin-queues.ts", "utf8");
  const queues = [...source.matchAll(/href:\s*"(\/admin[^"]*)"/g)].map(
    (match) => match[1],
  );
  expect(
    queues.length,
    "no queue hrefs found in lib/data/admin-queues.ts — the pattern has " +
      "stopped matching, which would make every case below pass over an " +
      "empty list",
  ).toBeGreaterThan(5);

  return new Set([...tools, ...queues]);
}

describe("an admin screen nobody can click on is a screen nobody has", () => {
  it("links to every static admin route from the index", () => {
    const reachable = hrefsOnTheIndex();
    const unreachable = adminRoutes().filter(
      (route) => !reachable.has(route) && !(route in NOT_ON_THE_INDEX),
    );

    expect(
      unreachable,
      "these admin screens are reachable only by typing the URL. Add them to " +
        "ADMIN_TOOLS (or a queue), or declare them in NOT_ON_THE_INDEX with " +
        "the reason they do not need a link",
    ).toEqual([]);
  });

  it("keeps no exemption for a screen that no longer exists", () => {
    /*
     * THE OTHER DIRECTION, and the one that makes the list above safe to have.
     * An exemption outliving its screen silently covers whatever takes that
     * path next — the same shape as an acknowledged health failure outliving
     * its fault.
     */
    const routes = new Set(adminRoutes());
    for (const path of Object.keys(NOT_ON_THE_INDEX)) {
      expect(routes.has(path), `${path} is exempted and does not exist`).toBe(
        true,
      );
    }
  });

  it("gives every exemption a reason somebody can argue with", () => {
    for (const [path, why] of Object.entries(NOT_ON_THE_INDEX)) {
      expect(why.trim().length, `${path} has no reason`).toBeGreaterThan(30);
    }
  });
});

describe("every tool on the index has words in both languages", () => {
  /*
   * The same arrangement as the queue cards one file over, and for the same
   * reason: the keys are a closed union, so the catalogues can be checked
   * exhaustively rather than against an allow-list. A tool added without copy
   * renders its own dotted key path on the admin front page.
   */
  for (const file of ["messages/en.json", "messages/ne.json"]) {
    it(`${file} names and describes every one`, () => {
      const messages = JSON.parse(readFileSync(file, "utf8"));
      const tools = messages.admin.index.tools;

      for (const tool of ADMIN_TOOLS) {
        expect(tools[tool.key]?.name, `${tool.key}.name in ${file}`).toBeTruthy();
        expect(tools[tool.key]?.what, `${tool.key}.what in ${file}`).toBeTruthy();
      }
      expect(Object.keys(tools).sort()).toEqual(
        ADMIN_TOOLS.map((tool) => tool.key).sort(),
      );
    });
  }
});
