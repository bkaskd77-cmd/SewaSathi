import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ADMIN_QUEUE_KEYS,
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

const q = (total: number | null, oldest: string | null = null) => ({
  key: "applications" as AdminQueueKey,
  href: "/admin/applications",
  total,
  cap: QUEUE_CAP,
  oldest,
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
  /*
   * READ FROM THE SOURCE, NOT COPIED FROM IT. This list used to be written out
   * here as well as in `lib/data/queue.ts`, which made the promise in the
   * comment above conditional on somebody remembering to update both. It is one
   * list now, so a queue added without copy fails here because the catalogues
   * are short — which is what the comment always claimed.
   */
  const KEYS: readonly AdminQueueKey[] = ADMIN_QUEUE_KEYS;

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

describe("the two nulls on a queue card mean different things", () => {
  /*
   * `total` null is "the count failed"; `oldest` null is "nothing is waiting, or
   * this queue reports no age". A screen that read them as one fact would print
   * "nothing to approve" on a broken query — the sentence that tells somebody to
   * go home while a professional goes unpaid.
   */
  it("an unreadable count with no date is still unreadable, not clear", () => {
    expect(queuesState([q(null, null)])).toBe("unknown");
  });

  it("a queue with work and no age reported still says waiting", () => {
    // Seven of the eight queues report no age at all. Their cards must not read
    // as empty because of it.
    expect(queuesState([q(3, null)])).toBe("waiting");
  });

  it("an age never makes an empty queue read as waiting", () => {
    // A stale date beside a zero count would be the inverse mistake: it would
    // send somebody to a queue that has nothing in it.
    expect(queuesState([q(0, "2026-09-01T00:00:00.000Z")])).toBe("clear");
  });
});
