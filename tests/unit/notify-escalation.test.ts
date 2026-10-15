import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WAKES_A_PHONE, WORTH_AN_SMS, wakesAPhone, worthAnSms } from "@/lib/notify/urgency";
import { escalatesToSms } from "@/lib/notify";
import { LIST_NOTE_KINDS } from "@/lib/notify/channel";

/**
 * Push first, SMS only on a real miss — asserted as a rule rather than as a
 * comment, because this is the code that decides whether we are billed.
 */

describe("which notifications interrupt somebody", () => {
  it("wakes a phone for work being offered, and for a job that is moving", () => {
    expect(wakesAPhone("booking.assigned")).toBe(true);
    expect(wakesAPhone("booking.widened")).toBe(true);
    expect(wakesAPhone("booking.en_route")).toBe(true);
    expect(wakesAPhone("booking.providerArrived")).toBe(true);
  });

  it("stays quiet for the kinds that are a record rather than a summons", () => {
    /*
     * A PUSH FOR EVERYTHING IS A PUSH FOR NOTHING. There are twenty-six kinds
     * and most are news somebody can read later; buzzing on all of them teaches
     * people to swipe without looking, and the one that mattered goes with the
     * rest.
     */
    expect(wakesAPhone("booking.quoteApproved")).toBe(false);
    expect(wakesAPhone("booking.quoteDeclined")).toBe(false);
    expect(wakesAPhone("payment.receipt")).toBe(false);
    expect(wakesAPhone("review.published")).toBe(false);
    expect(wakesAPhone("claim.ledger")).toBe(false);
  });

  it("is an allow-list, so a kind nobody considered is silent", () => {
    // The default is quiet. A kind added to the union and not thought about
    // here does not start interrupting people on its own.
    expect(wakesAPhone("booking.somethingNew" as never)).toBe(false);
  });
});

describe("which notifications are worth paying for", () => {
  it("is strictly smaller than the push list", () => {
    /*
     * "FALL BACK FOR EVERYTHING PUSH COVERS" IS HOW A FREE CHANNEL'S
     * GENEROSITY BECOMES A BILL that scales with every booking this product
     * ever takes. Every SMS kind must also be a push kind — we never pay for
     * something we would not have sent free — and the two must not be equal.
     */
    for (const kind of WORTH_AN_SMS) {
      expect(WAKES_A_PHONE, `${kind} is paid for but never pushed`).toContain(kind);
    }
    expect(WORTH_AN_SMS.length).toBeLessThan(WAKES_A_PHONE.length);
  });

  it("does not pay for a progress update", () => {
    // Nothing stops if somebody misses "on the way": the professional still
    // arrives, and the in-app row and the live booking page both say so.
    expect(worthAnSms("booking.en_route")).toBe(false);
    expect(worthAnSms("booking.accepted")).toBe(false);
    expect(worthAnSms("booking.in_progress")).toBe(false);
    expect(worthAnSms("booking.completed")).toBe(false);
  });

  it("pays for work offered and for anything that stops the job", () => {
    expect(worthAnSms("booking.assigned")).toBe(true);
    expect(worthAnSms("booking.widened")).toBe(true);
    expect(worthAnSms("booking.quoteReady")).toBe(true);
    expect(worthAnSms("booking.priceCorrected")).toBe(true);
    expect(worthAnSms("payment.mismatch")).toBe(true);
  });

  it("never sends the payout-destination warning by SMS", () => {
    /*
     * THE ONE KIND WITH THE STRONGEST CLAIM TO AN SMS AND THE ONE IT MUST NOT
     * GET. `lib/notify/channel.ts` wrote the trap down before any channel
     * existed: somebody who has taken an account over changes the phone number
     * too, so a channel reading the number at send time warns the attacker
     * about their own theft and tells the real person nothing. Nothing in this
     * schema records what the number was BEFORE, so there is no honest SMS to
     * send. Push cannot be redirected from inside the product, so it goes
     * there and nowhere else.
     */
    expect(wakesAPhone("payout.destinationChanged")).toBe(true);
    expect(worthAnSms("payout.destinationChanged")).toBe(false);
  });

  it("refuses it in the data layer too, not only in the list", () => {
    // Two refusals for one rule, because the failure is a warning delivered to
    // an attacker. A future caller reaching the data layer directly must not be
    // able to reintroduce it.
    const source = readFileSync("lib/data/push.ts", "utf8");
    expect(source).toContain('notification.kind === "payout.destinationChanged"');
  });
});

describe("when a push failure earns a message we pay for", () => {
  it("escalates when there was nobody to send to, or everybody refused", () => {
    expect(escalatesToSms("noSubscription")).toBe(true);
    expect(escalatesToSms("refused")).toBe(true);
  });

  it("does not escalate because WE have no key configured", () => {
    /*
     * `notConfigured` means we have not set a VAPID key up, not that this
     * person is unreachable. Billing their phone for our own missing
     * configuration is the wrong way round — and in a deployment with no keys
     * it would send an SMS for every notification in the product on day one.
     */
    expect(escalatesToSms("notConfigured")).toBe(false);
  });

  it("does not escalate on a failed read", () => {
    // Rule 6: "we could not look" is not "they have no phone". Paying on a
    // database hiccup is a bill with no fact behind it.
    expect(escalatesToSms("unreadable")).toBe(false);
  });
});

describe("every interrupting kind has something to say", () => {
  /*
   * COPY CHECKED AGAINST THE LISTS, because next-intl renders a missing key as
   * its own dotted path — so a kind with no copy would push
   * `push.booking.widened.title` onto somebody's lock screen, in the language
   * they are least likely to be reading. `lib/notify/push.ts` guards with
   * `t.has` and sends nothing, which is the honest failure and also a silent
   * one; this is what makes it loud.
   */
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const ne = JSON.parse(readFileSync("messages/ne.json", "utf8"));

  const at = (tree: Record<string, unknown>, path: string) =>
    path.split(".").reduce<unknown>((node, part) => {
      if (node && typeof node === "object") {
        return (node as Record<string, unknown>)[part];
      }
      return undefined;
    }, tree);

  for (const kind of WAKES_A_PHONE) {
    it(`${kind} has a push title and body in both languages`, () => {
      for (const [name, tree] of [["en", en], ["ne", ne]] as const) {
        expect(typeof at(tree, `push.${kind}.title`), `${name} title`).toBe("string");
        expect(typeof at(tree, `push.${kind}.body`), `${name} body`).toBe("string");
      }
    });
  }

  for (const kind of WORTH_AN_SMS) {
    it(`${kind} has an SMS line in both languages`, () => {
      for (const [name, tree] of [["en", en], ["ne", ne]] as const) {
        const line = at(tree, `sms.${kind}`);
        expect(typeof line, `${name}`).toBe("string");
        // The reference is what makes an SMS actionable: there is no screen to
        // open and no link to tap, so the message has to name the job.
        expect(String(line), `${name} names the job`).toContain("{reference}");
      }
    });
  }

  it("has no push copy for a kind that never pushes", () => {
    // Copy for a silent kind is copy nobody reads and nobody maintains, and it
    // reads as evidence that the kind does push.
    const pushTree = (en.push ?? {}) as Record<string, Record<string, unknown>>;
    const spelled: string[] = [];
    for (const [group, kinds] of Object.entries(pushTree)) {
      if (group === "optIn") continue;
      for (const kind of Object.keys(kinds)) spelled.push(`${group}.${kind}`);
    }
    expect(spelled.sort()).toEqual([...WAKES_A_PHONE].sort());
  });
});

describe("the record is written for every kind, pushed or not", () => {
  it("still lists notes for kinds that never interrupt", () => {
    /*
     * Nothing in `urgency.ts` decides whether somebody is TOLD — only whether
     * they are interrupted. `payment.receipt` is silent on a lock screen and
     * still has a line on `/bookings`, and that must stay true.
     */
    expect(LIST_NOTE_KINDS).toContain("payment.receipt");
    expect(wakesAPhone("payment.receipt")).toBe(false);
  });
});
