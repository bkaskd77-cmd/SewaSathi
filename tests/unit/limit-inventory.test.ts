import { describe, expect, it } from "vitest";

import { DEFAULT_AI_LIMITS } from "@/lib/config/ai-limits";
import { LIMITS } from "@/lib/server/rate-limit";

/**
 * The ceiling table in SECURITY.md names every ceiling that exists.
 *
 * WHY A TEST AND NOT A CAREFUL HABIT. The table was written so the GAPS are visible —
 * a limit somebody can find is a limit somebody can argue with, and the row that is
 * missing is the finding. A table that silently stops listing everything inverts that:
 * it makes a new unlimited surface look like a decision somebody took. The same shape as
 * `guard-clauses.test.ts`'s inverse check, one document along.
 *
 * It asserts PRESENCE, not the numbers. Pinning "12 / 60" here would mean editing a
 * security document to retune a limit, which is how a document becomes something people
 * route around.
 */
describe("every ceiling is in the table", () => {
  it("names each rate limit", async () => {
    const doc = await read();
    for (const name of Object.keys(LIMITS)) {
      expect(doc, `\`${name}\` is not in SECURITY.md § 1b`).toContain(`\`${name}\``);
    }
  });

  it("names each AI ceiling", async () => {
    const doc = await read();
    for (const name of Object.keys(DEFAULT_AI_LIMITS)) {
      /* Four of the twelve are shapes of one rule rather than ceilings of their own —
         a character cap, the pause's length, the repeat window, the photo window — and
         the table names the rule instead. Listed here so the exemption is a decision. */
      if (
        [
          "anonMaxChars",
          "userMaxChars",
          "offTopicPauseHours",
          "offTopicRepeatWindowDays",
          "photoRequestWindowMinutes",
        ].includes(name)
      ) {
        continue;
      }
      expect(doc, `\`${name}\` is not in SECURITY.md § 1b`).toContain(`\`${name}\``);
    }
  });

  it("still carries the named gaps, so the table is not read as complete", () => {
    /* The gaps are the point. A table of what IS limited, with no statement of what is
       not, reads as "everything is covered" to the next person. */
    return read().then((doc) => {
      expect(doc).toContain("The gaps, named rather than left to be found");
      expect(doc).toContain("has no rate limit at all");
    });
  });
});

async function read(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL("../../SECURITY.md", import.meta.url), "utf8");
}
