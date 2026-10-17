import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PAYOUT_HELD_REASONS,
  destinationReadiness,
  heldReasonFor,
  noticeCouldReachSomebody,
} from "@/lib/payments/destination";

/**
 * A destination change nobody could be told about.
 *
 * WHAT WAS ALREADY TRUE, PINNED FIRST SO THIS IS NOT MISREAD AS THE GATE IT IS
 * NOT. Every new destination was ALREADY held until a person confirmed it —
 * `first_payout_confirmed_at` is null, readiness says `unconfirmed`, and the
 * run refuses to draft a payable row. An admin has always had to act before
 * money follows a changed address, and the first case below is that fact
 * written down rather than assumed.
 *
 * WHAT IS NEW IS THE DIFFERENCE BETWEEN TWO CONFIRMATIONS THAT LOOKED THE SAME.
 * `DESTINATION_COOLDOWN_HOURS` holds a new account for 72 hours so the
 * professional can OBJECT; that is only a protection if somebody could be told.
 * An admin reading a row to confirm could not tell which of those two they were
 * looking at, and the sentence they read now depends on it.
 */

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-16T12:00:00Z");
const past = new Date(now.getTime() - 100 * HOUR);
const future = new Date(now.getTime() + 40 * HOUR);

describe("every destination change already needed a person", () => {
  it("holds a replacement that nobody has confirmed, device or no device", () => {
    // Two devices reached, cooldown elapsed, still unconfirmed — still held.
    expect(
      destinationReadiness(
        {
          retiredAt: null,
          usableFrom: past,
          firstPayoutConfirmedAt: null,
          replacedAnother: true,
          noticeDevices: 2,
        },
        now,
      ),
    ).toEqual({ ok: false, reason: "unconfirmed" });
  });

  it("releases only once a person has confirmed it", () => {
    expect(
      destinationReadiness(
        {
          retiredAt: null,
          usableFrom: past,
          firstPayoutConfirmedAt: past,
          replacedAnother: true,
          noticeDevices: 2,
        },
        now,
      ),
    ).toEqual({ ok: true });
  });
});

describe("when the warning could reach nobody", () => {
  const unreachable = {
    retiredAt: null,
    usableFrom: future,
    firstPayoutConfirmedAt: null,
    replacedAnother: true,
    noticeDevices: 0,
  };

  it("says so rather than naming a cooling date", () => {
    /*
     * THE ORDER IS THE POINT. The 72 hours is time to OBJECT, and an account
     * with no device was told nothing to object to — so reporting "cooling
     * until Thursday" would name a date as though a protection were running.
     * That is the `server.region` mistake in a place where it costs somebody
     * their earnings rather than a 503.
     */
    expect(destinationReadiness(unreachable, now)).toEqual({
      ok: false,
      reason: "unwitnessed",
    });
  });

  it("outranks cooling even once the window has elapsed", () => {
    expect(
      destinationReadiness({ ...unreachable, usableFrom: past }, now),
    ).toEqual({ ok: false, reason: "unwitnessed" });
  });

  it("clears when a person confirms, because that IS the control", () => {
    // Holding past the confirmation would refuse the only control we have
    // while demanding it be exercised.
    expect(
      destinationReadiness(
        { ...unreachable, usableFrom: past, firstPayoutConfirmedAt: past },
        now,
      ),
    ).toEqual({ ok: true });
  });

  it("treats an unrecorded count as unreached, never as reached", () => {
    /*
     * Rule 6, in the direction that costs a phone call rather than somebody's
     * earnings: a row written before the column existed cannot say, and
     * "cannot say" must not release money on the strength of a notice we have
     * no evidence anybody could read.
     */
    expect(
      destinationReadiness({ ...unreachable, noticeDevices: null }, now),
    ).toEqual({ ok: false, reason: "unwitnessed" });
    expect(
      destinationReadiness({ ...unreachable, noticeDevices: undefined }, now),
    ).toEqual({ ok: false, reason: "unwitnessed" });
  });

  it("does not apply to a first destination, which redirects nobody", () => {
    /*
     * There was no warning anybody needed to read: nothing was taken away. It
     * is gated by `unconfirmed` like any other new address, and flagging it
     * would bury the rows that matter under every professional we approve.
     */
    expect(
      destinationReadiness(
        {
          retiredAt: null,
          usableFrom: past,
          firstPayoutConfirmedAt: null,
          replacedAnother: false,
          noticeDevices: 0,
        },
        now,
      ),
    ).toEqual({ ok: false, reason: "unconfirmed" });
  });

  it("is still outranked by a retired row", () => {
    // No address to pay at all beats any statement about who was told.
    expect(
      destinationReadiness({ ...unreachable, retiredAt: past }, now),
    ).toEqual({ ok: false, reason: "retired" });
  });
});

describe("what a device count establishes", () => {
  it("is not a delivery receipt", () => {
    /*
     * Nothing here is named `delivered`, and the reason is `notify()`'s own:
     * a push service answers 201 when it has TAKEN a message, never when a
     * phone has shown it. What this establishes is weaker and is the most that
     * can be: there was a device to address.
     */
    expect(noticeCouldReachSomebody(1)).toBe(true);
    expect(noticeCouldReachSomebody(5)).toBe(true);
    expect(noticeCouldReachSomebody(0)).toBe(false);
    expect(noticeCouldReachSomebody(null)).toBe(false);
  });
});

describe("the payout is held for the right reason", () => {
  const held = (reason: string) =>
    heldReasonFor(5000, { readiness: { ok: false, reason } });

  it("carries unwitnessed through to the payout row", () => {
    expect(held("unwitnessed")).toBe("unwitnessed");
  });

  it("still puts a negative week first", () => {
    // Where they owe us, the bank account is irrelevant — nothing is sent.
    expect(
      heldReasonFor(-100, { readiness: { ok: false, reason: "unwitnessed" } }),
    ).toBe("negative");
  });
});

describe("the closed set is one list", () => {
  it("matches the constraint the database enforces", () => {
    /*
     * A reason the constraint does not know is refused at the INSERT, so a
     * payout that should have been held fails to draft at all — the run counts
     * it as an error and the week goes unpaid, on the one path where a silent
     * failure means somebody is not paid. The db suite compares these against
     * `pg_constraint`; this reads the migrations, because the two lists are
     * written in different languages and nothing else makes them agree.
     *
     * THE LAST DEFINITION, FOUND RATHER THAN NAMED, and that is the whole repair
     * this case needed. It used to read `20261016000001` by name and assert a
     * length of five. `20261017000002` then widened the constraint for the
     * enforcement ladder's step 4 and the case went red against a schema that
     * was correct — the policy trap CLAUDE.md records, one object type over:
     * a constraint is dropped and re-added by later migrations, so a test
     * pinned to an earlier file is measuring something nobody ships.
     *
     * COMPARED AS SETS, BOTH WAYS, rather than "contains" plus a count. A count
     * is a second place to remember, and `toContain` alone would pass over a
     * reason the SQL knows and the TypeScript does not — which is the direction
     * that silently widens what the database will accept.
     */
    const files = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const defining = files.filter((name) =>
      readFileSync(`supabase/migrations/${name}`, "utf8").includes(
        "payouts_held_reason_check",
      ),
    );
    // A scanner that found nothing would make every assertion below vacuous.
    expect(defining.length).toBeGreaterThan(0);

    const sql = readFileSync(
      `supabase/migrations/${defining[defining.length - 1]}`,
      "utf8",
    );
    const clause = sql.slice(sql.lastIndexOf("held_reason in ("));
    const inSql = [...clause.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

    expect([...inSql].sort()).toEqual([...PAYOUT_HELD_REASONS].sort());
  });

  it("has copy on both screens, in both languages", () => {
    // next-intl renders a missing key as its own dotted path — here, onto the
    // screen where somebody decides whether to release a week's earnings.
    for (const file of ["messages/en.json", "messages/ne.json"]) {
      const messages = JSON.parse(readFileSync(file, "utf8"));
      for (const reason of PAYOUT_HELD_REASONS) {
        expect(
          typeof messages.admin.payouts.held[reason],
          `${file} admin.payouts.held.${reason}`,
        ).toBe("string");
      }
      expect(
        typeof messages.provider.money.waiting.unwitnessed,
        `${file} provider.money.waiting.unwitnessed`,
      ).toBe("string");
    }
  });
});
