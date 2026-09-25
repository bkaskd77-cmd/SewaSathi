import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  QUEUE_CAP,
  queuesState,
  unreadableQueue,
  type AdminQueueKey,
} from "@/lib/data/queue";

/**
 * The admin index, and the one distinction it exists to keep.
 *
 * A queue count is three things, not two: some, none, and we-could-not-look.
 * Folding the third into the second gives an admin the one sentence that tells
 * them to stop checking — "nothing is waiting" — on the morning a query is
 * broken and the work is piling up behind it.
 */

const q = (total: number | null) => ({
  key: "applications" as AdminQueueKey,
  href: "/admin/applications",
  total,
  cap: QUEUE_CAP,
});

describe("does anything need a person", () => {
  it("says waiting when any queue has something in it", () => {
    expect(queuesState([q(0), q(3), q(0)])).toBe("waiting");
  });

  it("says clear only when every count was actually read", () => {
    expect(queuesState([q(0), q(0)])).toBe("clear");
  });

  it("never reads an unreadable queue as clear", () => {
    // The whole point. A failed count is not a zero.
    expect(queuesState([q(null), q(null)])).toBe("unknown");
  });

  it("is unknown when even one of six could not be read", () => {
    // The first version asked whether EVERY queue had failed, so five empty
    // ones and one broken one printed "nothing is waiting".
    expect(
      queuesState([q(0), q(0), q(0), q(0), q(0), q(null)]),
    ).toBe("unknown");
  });

  it("still says waiting when one count failed and another has work", () => {
    // Something is definitely waiting; that is the more urgent truth and it is
    // not weakened by a second query having failed.
    expect(queuesState([q(null), q(2)])).toBe("waiting");
  });

  it("does not claim clear on a mix of readable-empty and unreadable", () => {
    // One of them might hold work and we cannot say. "Clear" would be a guess.
    expect(queuesState([q(0), q(null)])).not.toBe("clear");
  });
});

describe("a read that failed makes no claim about how many there are", () => {
  it("returns no rows and no total, keeping the cap it tried", () => {
    const page = unreadableQueue<string>(50);
    expect(page.rows).toEqual([]);
    expect(page.total).toBeNull();
    expect(page.cap).toBe(50);
  });
});

/**
 * The index builds its labels as `queues.<key>.name`, which is a dynamic key —
 * `check:keys` reports those rather than guessing at them, by design. The keys
 * come from a closed union, so the catalogues can be checked exhaustively here
 * instead, which is stronger than an allow-list: adding a seventh queue fails
 * this test until both languages have words for it.
 */
describe("every queue on the index has words in both languages", () => {
  const KEYS: AdminQueueKey[] = [
    "applications",
    "claims",
    "refunds",
    "verdicts",
    "surveyFees",
    "appeals",
    "mismatches",
  ];

  for (const file of ["messages/en.json", "messages/ne.json"]) {
    it(`${file} names and describes every one`, () => {
      const messages = JSON.parse(readFileSync(file, "utf8"));
      const queues = messages.admin.index.queues;

      for (const key of KEYS) {
        expect(queues[key]?.name, `${key}.name in ${file}`).toBeTruthy();
        expect(queues[key]?.what, `${key}.what in ${file}`).toBeTruthy();
      }
      expect(Object.keys(queues).sort()).toEqual([...KEYS].sort());
    });
  }
});
