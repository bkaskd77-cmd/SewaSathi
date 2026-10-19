import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_TOOLS } from "@/lib/data/admin-tools";

/**
 * Every screen can be reached by clicking, in each role's own product.
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
 * REACHABILITY IS PER ROLE, which is what widening it beyond `(admin)` found.
 * `/account/security` carries a comment reading "DELIBERATELY NOT BEHIND THE
 * ADMIN GATE" — it is the screen a customer or a professional enrols a second
 * factor on — and the only links to it in the whole product were
 * `components/admin/reauth-notice.tsx` and a `?next=` redirect, both admin.
 * So a screen written for two roles could be found by neither. A single
 * product-wide set of hrefs would have called it reachable.
 *
 * IT READS THE DIRECTORY RATHER THAN A LIST, which is `coverageGaps`' rule in
 * `check:deployed`: a screen nobody listed is exactly the screen that goes
 * unlinked, so a maintained list of screens-to-check would have the same blind
 * spot as the navigation itself. The exceptions are declared with a reason
 * each, and the test fails on an exception that no longer exists — because a
 * stale exemption is how the next screen slips through.
 */

/**
 * One role's product: where its screens live, and what it can click.
 *
 * THE NAVIGATION FILES ARE NAMED RATHER THAN SEARCHED FOR. Scanning every
 * component for an href would make any incidental link count as navigation —
 * and a link that only renders inside one feature's error state is not a way to
 * find a screen. These are the frames each role actually carries.
 */
const PRODUCTS = [
  {
    role: "admin",
    dir: "app/[locale]/(admin)/admin",
    prefix: "/admin",
    /** `ADMIN_TOOLS` is imported; these are read as text. */
    navFiles: ["lib/data/admin-queues.ts"],
    extraHrefs: () => ADMIN_TOOLS.map((tool) => tool.href),
  },
  {
    role: "provider",
    dir: "app/[locale]/(work)/provider",
    prefix: "/provider",
    navFiles: [
      "components/provider/work-header.tsx",
      /* The dashboard's money card is the only door to `/provider/payouts` —
         the header carries two tabs and money is reached from the summary. */
      "components/provider/money.tsx",
    ],
    extraHrefs: () => [],
  },
  {
    role: "customer",
    dir: "app/[locale]/(app)",
    prefix: "",
    navFiles: [
      "components/marketing/footer.tsx",
      "components/marketing/site-header.tsx",
      "components/marketing/account-menu.tsx",
      /* The landing page is navigation for a visitor: it is the only thing
         that links `/providers/join`, where a professional starts. */
      "app/[locale]/page.tsx",
      /* `/account` is where a signed-in customer manages their own account,
         which makes it the door to anything about that account. */
      "app/[locale]/(app)/account/page.tsx",
      /* The professional's front door, itself linked from the landing page.
         It is navigation rather than an exemption: it is where somebody reads
         the standards before signing up, and a two-hop chain through a page
         that is genuinely a door is reachable. */
      "app/[locale]/(app)/providers/join/page.tsx",
    ],
    extraHrefs: () => [],
  },
] as const;

/**
 * Screens that are deliberately not in any navigation, each with why.
 *
 * A REASON PER ENTRY, NOT A LIST OF PATHS. "It is fine" is what makes an
 * exemption list grow until it covers the thing it was meant to catch.
 */
const NOT_IN_NAVIGATION: Record<string, string> = {
  "/admin":
    "It IS the admin index. Linking to itself is the one path that cannot be missing.",
  "/admin/login":
    "The signed-out door. The admin index requires a session, so somebody who needs this screen cannot be looking at it.",
  "/admin/content/categories":
    "Reached from /admin/content, which is on the index and links to both of its children.",
  "/admin/content/documents":
    "Reached from /admin/content, as above.",
  "/book":
    "A step inside the booking flow, entered from a category page or the triage card with the intent on the URL. A standing link would start somebody at a form with nothing chosen.",
  "/bookings/[id]":
    "One booking, opened from the /bookings list. There is nothing to link to without an id.",
  "/providers/apply":
    "The application form, which /providers/join redirects to once somebody is signed in. Two doors to one flow would be two places to keep in step.",
  "/services/[slug]":
    "One trade, opened from the catalogue or the landing grid.",
  "/services/[slug]/[providerId]":
    "One professional's profile, opened from that trade's list.",
  "/legal/[slug]":
    "The three legal documents, each linked from the footer by its own slug rather than through the segment.",
  "/admin/applications/[id]":
    "One application, opened from the review queue. There is nothing to link to without an id.",
  "/admin/content/documents/[...slug]":
    "One long-form document, opened from the documents list that /admin/content links.",
};

/** Every static route under one directory — no dynamic segments collapsed. */
function routesUnder(dir: string, prefix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "page.tsx") {
      found.push(prefix === "" ? "/" : prefix);
      continue;
    }
    if (!statSync(path).isDirectory()) continue;
    /* A route group is a frame, not a path segment. */
    const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
    found.push(...routesUnder(path, `${prefix}${segment}`));
  }
  return found;
}

/**
 * Every href one role's navigation renders.
 *
 * Both spellings, because a list of tabs writes `href: "/x"` and a JSX link
 * writes `href="/x"`. The count is asserted by the caller, since a pattern that
 * stopped matching would make every case pass over an empty set.
 */
function hrefsIn(files: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/href[:=]\s*"(\/[^"]*)"/g)) {
      /* A query string is still that route. `#fragment` is the same page. */
      found.push(match[1].split(/[?#]/)[0]);
    }
  }
  return found;
}

describe("a screen nobody can click on is a screen nobody has", () => {
  for (const product of PRODUCTS) {
    it(`links to every ${product.role} screen from the ${product.role} navigation`, () => {
      const nav = [...hrefsIn(product.navFiles), ...product.extraHrefs()];
      expect(
        nav.length,
        `no hrefs found in the ${product.role} navigation — the pattern has ` +
          `stopped matching, which would make this case pass over nothing`,
      ).toBeGreaterThan(1);

      const reachable = new Set(nav);
      const unreachable = routesUnder(product.dir, product.prefix).filter(
        (route) => !reachable.has(route) && !(route in NOT_IN_NAVIGATION),
      );

      expect(
        unreachable,
        `these ${product.role} screens are reachable only by typing the URL. ` +
          `Add them to that role's navigation, or declare them in ` +
          `NOT_IN_NAVIGATION with the reason they do not need a link`,
      ).toEqual([]);
    });
  }

  it("keeps no exemption for a screen that no longer exists", () => {
    /*
     * THE OTHER DIRECTION, and the one that makes the list safe to have. An
     * exemption outliving its screen silently covers whatever takes that path
     * next — the same shape as an acknowledged health failure outliving its
     * fault.
     */
    const all = new Set(
      PRODUCTS.flatMap((product) => routesUnder(product.dir, product.prefix)),
    );
    for (const path of Object.keys(NOT_IN_NAVIGATION)) {
      expect(all.has(path), `${path} is exempted and does not exist`).toBe(true);
    }
  });

  it("gives every exemption a reason somebody can argue with", () => {
    for (const [path, why] of Object.entries(NOT_IN_NAVIGATION)) {
      expect(why.trim().length, `${path} has no reason`).toBeGreaterThan(30);
    }
  });
});

describe("every tool on the admin index has words in both languages", () => {
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

/**
 * A route one role needs, living in another role's group.
 *
 * THE GUARD ABOVE CANNOT SEE THIS and the limit is worth stating rather than
 * engineering around. It asks "is every screen in this group reachable from
 * this group's navigation", which is the right question for a group — and
 * `/providers/standards` lives in `(app)` while the person it is written for
 * works in `(work)`. It passes the customer case because `/providers/join`
 * links it, and a professional who signed up six months ago never opens that
 * page again.
 *
 * So the two links that matter are pinned as behaviour. The published ladder is
 * the one page in this product whose whole value is being readable BEFORE
 * somebody is measured against it, and the suspension card is the moment it
 * matters most.
 */
describe("the published ladder is reachable by the people it governs", () => {
  /** Comments stripped, so naming a path in prose is not a link to it. */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  }

  it("is in the professional's own frame, on every screen they work on", () => {
    expect(code("app/[locale]/(work)/layout.tsx")).toMatch(
      /href="\/providers\/standards"/,
    );
  });

  it("is on the suspension card, where somebody needs it most", () => {
    /*
     * A SUSPENDED PROFESSIONAL GOT A PHONE NUMBER AND NOTHING ELSE. The card
     * named this page in a comment while linking neither it nor anything that
     * says what the step was or how it lifts — which is "deterrence nobody can
     * read", the trap that page exists to refuse, reproduced on the one screen
     * where the person is already having a bad day.
     */
    const source = code("components/shared/suspension-notice.tsx");
    expect(source).toMatch(/href="\/providers\/standards"/);
    /* Provider only: the ladder is about professional conduct, and pointing a
       suspended customer at it would show them rules that are not theirs. */
    expect(source).toMatch(/audience === "provider"/);
  });
});
