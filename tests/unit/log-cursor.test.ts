import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "@/lib/data/log-cursor";

/**
 * Paging a log that only grows.
 *
 * WHY THIS CODEBASE HAS NO OTHER PAGING, AND WHY THIS ONE IS RIGHT. Every
 * queue is cap-and-tell, and `lib/data/queue.ts` argues the case: a drain queue
 * with a page two invites working the wrong end of it, and what was missing was
 * never the second page but being TOLD one existed. None of that holds for an
 * append-only log — nothing is ever decided, nothing ever leaves, and what
 * somebody is looking for is rarely in the newest fifty.
 *
 * KEYSET RATHER THAN OFFSET. `security_events_at_idx` is `(at desc)` and `id`
 * is a monotonic identity, so a cursor walks backwards at constant cost. An
 * offset re-counts everything it skips, which on a table that only grows makes
 * the oldest page the slowest — exactly backwards for a log, where the old
 * entries are the ones somebody is digging for.
 *
 * `id` IS IN THE CURSOR BECAUSE `at` IS NOT UNIQUE. Several events are written
 * inside one transaction and share a timestamp to the microsecond; a cursor on
 * `at` alone would either skip the rest of that group or repeat it for ever.
 */

describe("the cursor", () => {
  it("survives a round trip", () => {
    const raw = encodeCursor({ at: "2026-09-25T11:04:05.123456+00:00", id: "4821" });
    expect(decodeCursor(raw)).toEqual({
      at: "2026-09-25T11:04:05.123456+00:00",
      id: "4821",
    });
  });

  /*
   * A timestamp contains colons, dashes and a plus. The separator is split on
   * the LAST bar for that reason — splitting on the first would work today and
   * break the moment a format carried one.
   */
  it("splits on the last separator, not the first", () => {
    expect(decodeCursor("2026-09-25T11:04:05+00:00|7")).toEqual({
      at: "2026-09-25T11:04:05+00:00",
      id: "7",
    });
  });

  /*
   * It arrives off a query string, so it is whatever somebody put there. A
   * malformed cursor is ignored and the reader falls back to the newest page —
   * which is a worse answer than they wanted, and a far better one than an
   * unfiltered predicate built out of their text.
   */
  it("refuses anything that is not a cursor", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("nonsense")).toBeNull();
    expect(decodeCursor("|7")).toBeNull();
    expect(decodeCursor("2026-09-25T11:04:05+00:00|")).toBeNull();
    expect(decodeCursor("2026-09-25T11:04:05+00:00|abc")).toBeNull();
  });

  it("refuses an id that is trying to be something else", () => {
    // The id is interpolated into a PostgREST filter, so "only digits" is the
    // property that matters rather than a nicety about types.
    expect(decodeCursor("2026-09-25|1;drop")).toBeNull();
    expect(decodeCursor("2026-09-25|1,2")).toBeNull();
    expect(decodeCursor("2026-09-25|-1")).toBeNull();
  });
});
