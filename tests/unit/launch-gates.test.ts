import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GATES,
  blocksLaunch,
  parseEntries,
} from "../../scripts/check-launch-blockers.mjs";
import {
  tradeOpenable,
  tradeSpanStandings,
} from "@/lib/config/launch-readiness";
import { PAYOUT_RUN, payoutRunRefusal } from "@/lib/config/payout-policy";
import {
  confirmationIsSoleControl,
  destinationReadiness,
  heldReasonFor,
} from "@/lib/payments/client";
import { ALL_LOCALES, englishOnly, servedLocales } from "@/lib/config/locales";
import { isLocale, routing, stripLocale } from "@/i18n/routing";

/**
 * What each launch blocker gates, and whether the narrower gates actually bite.
 *
 * THE RISK THIS FILE EXISTS FOR IS NOT THE CLASSIFICATION, IT IS THE
 * ENFORCEMENT. Until 2026-10-24 every open entry refused a `LAUNCH=true` build,
 * which made the flag unreachable — a Play Store listing sequenced after launch
 * held the same veto as "nobody can sign in" — so four entries moved to narrower
 * gates. A classification whose enforcement lives nowhere is this repository's
 * most-recorded sin wearing a new hat: `applyRedoRecovery`, `proposeBand` and
 * `mode: "correction"` were all written, documented and reached by nothing.
 *
 * So the cases below are in two halves. The first asserts the register and the
 * script agree. The second asserts that `payout-run`, `launch-scope` and
 * `post-launch` each name something that really refuses, really closes, or is
 * really written down — read out of the sources, because a gate value that
 * pointed at nothing would otherwise read exactly like one that worked.
 */

const REGISTER = readFileSync("LAUNCH-BLOCKERS.md", "utf8");
const entries = parseEntries(REGISTER);

/** Comments stripped: naming a function to explain it is documentation. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("every open blocker says what it gates", () => {
  it("parses the register, so the cases below cannot pass over nothing", () => {
    /* The count first — `no-caller`'s and `drift-token`'s rule. */
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.filter((e) => e.status === "unresolved").length).toBeGreaterThan(5);
  });

  it("gives every unresolved entry a gate the script knows", () => {
    /*
     * REQUIRED WHILE UNRESOLVED, optional once resolved, because a resolved
     * entry gates nothing by definition — so flipping one back to `unresolved`
     * fails here until somebody classifies it. An absent gate must never fall
     * through to `none`: rule 6's shape for a gate, where an absence is not a
     * permission.
     */
    /* ONE CASE, NOT TWO. The first draft also wrote
       `!(e.gates ?? "") in GATES`, which parses as `(!(e.gates ?? "")) in GATES`
       — a boolean tested against the key set, so always false and always
       passing. A blind assertion beside a working one is worse than no
       assertion: it reads as two guards. */
    const bad = entries
      .filter(
        (e) => e.status === "unresolved" && !Object.keys(GATES).includes(e.gates ?? ""),
      )
      .map((e) => `${e.id} -> ${e.gates ?? "(none)"}`);

    expect(
      bad,
      `These open entries have no gate the guard recognises:\n  ${bad.join("\n  ")}\n\n` +
        `Add "- Gates: <${Object.keys(GATES).join("|")}>" to the entry. An ` +
        `unclassified blocker must not fall through to "none".`,
    ).toEqual([]);
  });

  it("refuses a launch on `launch`, and on the Nepali read only while Nepali is served", () => {
    expect(blocksLaunch("launch", false)).toBe(true);
    expect(blocksLaunch("launch", true)).toBe(true);

    /*
     * THE OPTION, BOTH WAYS ROUND. Unread money, safety and legal Nepali copy
     * cannot mislead a reader who is never served it — and the moment Nepali IS
     * served, it gates again. A single case would pass under a gate that always
     * forgave it.
     */
    expect(blocksLaunch("launch-unless-english-only", false)).toBe(true);
    expect(blocksLaunch("launch-unless-english-only", true)).toBe(false);

    for (const gate of ["payout-run", "launch-scope", "post-launch", "none"]) {
      expect(blocksLaunch(gate, false), `${gate} must not hold a build`).toBe(false);
      expect(blocksLaunch(gate, true), `${gate} must not hold a build`).toBe(false);
    }
  });

  it("keeps the five named launch gates, so a quiet reclassification fails", () => {
    /*
     * THE DECISION ITSELF, pinned. These five were chosen deliberately on
     * 2026-10-24; moving one to `none` is a product decision and should cost a
     * failing test rather than passing as a tidy-up.
     */
    const byId = new Map(entries.map((e) => [e.id, e.gates]));
    expect(byId.get("sms-gateway-unverified")).toBe("launch");
    expect(byId.get("test-account-otps")).toBe("launch");
    expect(byId.get("support-phone-number")).toBe("launch");
    expect(byId.get("legal-documents-unreviewed")).toBe("launch");
    expect(byId.get("nepali-native-read")).toBe("launch-unless-english-only");

    /*
     * `payout-notice-undeliverable` HELD `launch` BY DEFAULT AND NOW GATES THE
     * RUN, decided 2026-10-24: it protects where money goes, money moves only at
     * the payout run, and accounts without push already need admin confirmation
     * after a destination change. Pinned here because it is the one entry whose
     * classification was once "nobody has answered", and a silent move back to
     * `launch` would hide that somebody did.
     */
    expect(byId.get("payout-notice-undeliverable")).toBe("payout-run");
    expect(byId.get("withholding-tax-unconfirmed")).toBe("payout-run");
    expect(byId.get("sub-band-durations")).toBe("launch-scope");
    expect(byId.get("multi-day-scheduling")).toBe("launch-scope");
    expect(byId.get("payouts-unbuilt")).toBe("post-launch");
  });
});

describe("the narrower gates are enforcement and not relabelling", () => {
  it("refuses the payout run while the withholding rate is unconfirmed", () => {
    /*
     * ZERO IS NOT AN ANSWER, which is the whole reason this gate can exist.
     * `withholdingTaxBps` has read 0 since the run was written and reads the
     * same whether an accountant confirmed zero or nobody looked — so the
     * confirmation is its own fact, and it is what the run reads.
     */
    expect(PAYOUT_RUN.withholdingTaxConfirmedAt).toBeNull();
    expect(payoutRunRefusal()).toBe("withholding-unconfirmed");
  });

  it("has the run ask that rule rather than re-deriving it", () => {
    /* The wiring, not the function — `labelCategory`'s lesson. A refusal nothing
       calls is the no-caller sin on a money path. */
    const run = code("lib/data/payouts.ts");
    expect(run).toContain("payoutRunRefusal()");
    expect(run).toContain("refused");
    /* And it is asked BEFORE the bookings read, so a refusal cannot read as a
       run that looked at the work and found none. */
    expect(run.indexOf("payoutRunRefusal()")).toBeLessThan(
      run.indexOf('.from("bookings")'),
    );
  });

  it("says why on the screen, so no drafts cannot read as nothing owed", () => {
    const page = code("app/[locale]/(admin)/admin/payouts/page.tsx");
    expect(page).toContain("payoutRunRefusal()");
    expect(page).toContain("runRefused.");
  });

  /* ------------------------------------------------------------------
   * payout-notice-undeliverable → payout-run
   *
   * THE HOLD WAS ALREADY STRUCTURAL; THE CLEARANCE WAS NOT. These cases assert
   * both halves, because the gate's claim is that money cannot reach a
   * destination nobody could be warned about — and half of that was true
   * before this entry was reclassified. Asserting only the new half would let
   * somebody delete `unwitnessed` from `destinationReadiness` and still pass.
   * ------------------------------------------------------------------ */

  it("holds a payout to a destination whose change notice reached nobody", () => {
    const changed = {
      retiredAt: null,
      usableFrom: new Date("2026-01-01T00:00:00Z"),
      firstPayoutConfirmedAt: null,
      replacedAnother: true,
      noticeDevices: 0,
    };
    const readiness = destinationReadiness(changed, new Date("2026-02-01T00:00:00Z"));
    expect(readiness).toEqual({ ok: false, reason: "unwitnessed" });

    /* And the run turns that into a hold rather than a payment. */
    expect(heldReasonFor(5_000, { readiness })).toBe("unwitnessed");
  });

  it("outranks cooling, so no date is named over a window nobody is inside", () => {
    /*
     * BOTH APPLY AND ONLY ONE IS HONEST. Reporting "cooling until Thursday"
     * on a change nobody was told about names a date as though an objection
     * window were running — the `server.region` mistake where it costs
     * somebody's earnings rather than a 503.
     */
    const readiness = destinationReadiness(
      {
        retiredAt: null,
        usableFrom: new Date("2026-02-05T00:00:00Z"),
        firstPayoutConfirmedAt: null,
        replacedAnother: true,
        noticeDevices: null,
      },
      new Date("2026-02-01T00:00:00Z"),
    );
    expect(readiness).toEqual({ ok: false, reason: "unwitnessed" });
  });

  it("asks for words only where the confirmation is the whole control", () => {
    /*
     * THE ASYMMETRY IS THE RULE. A notice that reached a device means the
     * professional was told and said nothing for 72 hours — the silence is the
     * record and a demanded sentence there is how people learn to type anything
     * into the box that matters. Null is "not recorded" and behaves as
     * unreached: rule 6, in the direction that costs a typed sentence.
     */
    expect(
      confirmationIsSoleControl({ replacedAnother: true, noticeDevices: 0 }),
    ).toBe(true);
    expect(
      confirmationIsSoleControl({ replacedAnother: true, noticeDevices: null }),
    ).toBe(true);
    expect(
      confirmationIsSoleControl({ replacedAnother: true, noticeDevices: 2 }),
    ).toBe(false);
    /* A first destination redirects nobody, so there was nothing to object to. */
    expect(
      confirmationIsSoleControl({ replacedAnother: false, noticeDevices: 0 }),
    ).toBe(false);
  });

  it("has the writer refuse a sole-control clearance with no reason", () => {
    /*
     * THE WIRING, NOT THE FUNCTION — `labelCategory`'s lesson, and the one that
     * matters most here: `confirmFirstPayout` is the ONLY thing that clears an
     * `unwitnessed` hold, so a rule it does not ask is a rule that stops
     * nothing. Read out of the source because the behaviour needs a Supabase
     * client with no seam.
     */
    const writer = code("lib/data/payout-destinations.ts");
    expect(writer).toContain("confirmationIsSoleControl(");
    /*
     * THE RETURN, NOT THE TYPE. Written first as
     * `toContain('reason: "reasonRequired"')`, which matched the
     * `ConfirmResult` union near the top of the file — so deleting the refusal
     * outright left this case GREEN, and the ordering assertion below compared
     * the type's position against the write and passed trivially. Found by
     * break-testing rather than by reading. The guard is the refusal
     * EXPRESSION, which only the statement has.
     */
    const refusal = '{ ok: false, reason: "reasonRequired" }';
    expect(writer).toContain(refusal);
    /* Judged BEFORE the stamp is written, not after. */
    expect(writer.indexOf(refusal)).toBeLessThan(
      writer.indexOf("first_payout_confirmed_at: new Date()"),
    );
    /* And the clearance is recorded with which kind it was. */
    expect(writer).toContain("recordDestinationConfirmation(");
    expect(writer).toContain("soleControl,");
  });

  it("does not let the browser say whether a reason is required", () => {
    /*
     * `stateBand`'s SPLIT, on the control that decides whether somebody else's
     * bank account gets paid: what a person TYPED crosses the wire, because the
     * record has to hold what they said; whether words are REQUIRED is read
     * server-side. A posted `soleControl` would waive the only check there is.
     */
    const action = code(
      "app/[locale]/(admin)/admin/payout-destinations/actions.ts",
    );
    expect(action).toContain('formData.get("reason")');
    expect(action).not.toContain('formData.get("soleControl")');
  });

  it("says on the screen why this row needs words, above the box", () => {
    /* A required field with no reason given is a threshold found by tripping
       it — the trap `/providers/standards` refuses one layer out. */
    const panel = code("components/admin/confirm-destination.tsx");
    expect(panel).toContain('t("soleControl")');
    expect(panel).toContain('name="reason"');
    const page = code("app/[locale]/(admin)/admin/payout-destinations/page.tsx");
    expect(page).toContain("confirmationIsSoleControl({");
  });

  it("records the confirmation as its own audit kind, carrying the reading", () => {
    /*
     * `payout.confirmed` IS A DIFFERENT ACT and is deliberately absent — it
     * records a rail's answer about money already sent. This one releases the
     * hold on a CHANGED account and is the account-takeover control itself, so
     * the log has to carry WHICH kind of confirmation it was. The destination
     * row could only ever say who and when.
     */
    const audit = readFileSync("lib/audit/index.ts", "utf8");
    expect(audit).toContain('"payoutDestination.confirmed"');
    const stripped = code("lib/audit/index.ts");
    expect(stripped).toContain("recordDestinationConfirmation");
    expect(stripped).toContain("soleControl");
    /* Never an account number: `payoutDestination.viewed` stays the only kind
       that means anybody saw digits. */
    expect(stripped).not.toContain("accountRef");
  });

  it("refuses the whole run for withholding and deliberately not for this", () => {
    /*
     * THE SHAPE DIFFERENCE, PINNED, because the sibling gate's enforcement is a
     * whole-run refusal and the next reader's reflex will be to add a second
     * `PayoutRunRefusal` value here. The withholding rate applies to every
     * payout, so nobody can be paid correctly until it is confirmed. This entry
     * has nothing to say about a professional who never changed their
     * destination — refusing the run would stop paying people to guard against
     * a risk they are not carrying, and would be a wall, since nothing can
     * close the entry until a contact-number history exists.
     */
    expect(payoutRunRefusal()).toBe("withholding-unconfirmed");
    const policy = code("lib/config/payout-policy.ts");
    expect(policy).not.toContain("destination");
  });

  it("closes exactly the trade whose typical product needs an unmeasured span", () => {
    /*
     * THE RULE THE ALTERNATIVES WOULD HAVE GOT WRONG. Three trades carry an
     * authored multi-day span — painting (1,2,4,7), electrical (1,1,1,1,2) and
     * carpentry (1,1,1,2) — and every one of those spans is `invented`. "Any
     * multi-day product closes the trade" would close electrical, which is the
     * trade the safety floor points at for gas and live wires; "more than half"
     * is a threshold nobody measured. The MEDIAN says something checkable: the
     * typical way to buy this trade needs a span we cannot promise.
     */
    const closed = [...tradeSpanStandings().values()]
      .filter((s) => !s.openable)
      .map((s) => s.slug)
      .sort();
    expect(closed).toEqual(["painting"]);
    expect(tradeOpenable("painting")).toBe(false);
    expect(tradeOpenable("electrical")).toBe(true);
    expect(tradeOpenable("carpentry")).toBe(true);
    expect(tradeOpenable("plumbing")).toBe(true);
  });

  it("opens the trade again when its spans are measured, with no code change", () => {
    /*
     * IT CLEARS ITSELF, which is what makes this a gate rather than a ban. A
     * span moving off `invented` — researched by hand, or promoted by the
     * duration loop out of `duration_observations` — drops the trade off the
     * list. Asserted by moving the provenance rather than the lengths, because
     * the lengths were never the problem.
     */
    const measured = [
      { categorySlug: "painting", slug: "a", typicalElapsedDays: 1, spanSource: "observed" },
      { categorySlug: "painting", slug: "b", typicalElapsedDays: 2, spanSource: "observed" },
      { categorySlug: "painting", slug: "c", typicalElapsedDays: 4, spanSource: "observed" },
      { categorySlug: "painting", slug: "d", typicalElapsedDays: 7, spanSource: "observed" },
    ] as never;
    expect(tradeOpenable("painting", measured)).toBe(true);

    /* And one unmeasured span is enough to hold it, so a partial research pass
       cannot open the trade by accident. */
    const partly = [
      { categorySlug: "painting", slug: "a", typicalElapsedDays: 1, spanSource: "observed" },
      { categorySlug: "painting", slug: "b", typicalElapsedDays: 2, spanSource: "observed" },
      { categorySlug: "painting", slug: "c", typicalElapsedDays: 4, spanSource: "invented" },
      { categorySlug: "painting", slug: "d", typicalElapsedDays: 7, spanSource: "observed" },
    ] as never;
    expect(tradeOpenable("painting", partly)).toBe(false);
  });

  it("treats a trade with no products as openable, not as a second gate", () => {
    /* Movers sells no products by design and `categoryReadiness` already
       reports a trade with none as a gap. Refusing here would be a quieter
       second gate on a case that has one. */
    expect(tradeOpenable("movers")).toBe(true);
    expect(tradeSpanStandings().has("movers")).toBe(false);
  });

  it("has the scope writer refuse it, and only while the scope is on", () => {
    const writer = code("lib/data/launch-scope-admin.ts");
    expect(writer).toContain("tradeOpenable");
    expect(writer).toContain("spanUnmeasured");
    /* `enabled` guards it: with the switch off the arrays are a parked plan the
       reads ignore, so refusing would make the plan unwritable. */
    expect(writer).toContain("if (input.enabled)");
  });

  it("names the first-week payout verification in the runbook", () => {
    /* `post-launch` is the one gate a build cannot check, so what makes it real
       is that it is written down as a dated step somebody follows. */
    const runbook = readFileSync("docs/LAUNCH-RUNBOOK.md", "utf8");
    expect(runbook).toContain("payouts-unbuilt");
    expect(runbook.toLowerCase()).toContain("first week");
  });
});

describe("hiding the Nepali locale hides it from the product too", () => {
  it("reads one variable, in the gate and in the router", () => {
    /*
     * ONE LIST WRITTEN TWICE IS THIS REPOSITORY'S MOST-REPEATED SHAPE, and here
     * it would be a gate forgiving unread copy that somebody is still being
     * served. `lib/config/locales.ts` is what hides the locale and
     * `check-launch-blockers.mjs` is what forgives the entry; both must read
     * `NEXT_PUBLIC_ENGLISH_ONLY` and nothing else.
     */
    expect(code("lib/config/locales.ts")).toContain("NEXT_PUBLIC_ENGLISH_ONLY");
    expect(code("scripts/check-launch-blockers.mjs")).toContain(
      "NEXT_PUBLIC_ENGLISH_ONLY",
    );
  });

  it("serves both by default, so CI keeps exercising Nepali", () => {
    /* A switch that changed the default would quietly stop testing the language
       it is about — the paint check, the bundle budget and the booking-flow walk
       all load `/ne` paths. */
    expect(englishOnly()).toBe(false);
    expect(servedLocales()).toEqual(["en", "ne"]);
    expect(routing.locales).toEqual(["en", "ne"]);
  });

  it("keeps `Locale` as both languages whatever is served", () => {
    /*
     * THE TYPE-LEVEL TRAP. `Locale` was `(typeof routing.locales)[number]`,
     * which was the same thing until a deployment could serve one language.
     * Narrowing it would make hiding Nepali a type-level deletion of
     * `messages/ne.json`, `categoryCopy` and every `locale === "ne"` branch.
     */
    expect(ALL_LOCALES).toEqual(["en", "ne"]);
    expect(isLocale("ne")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("strips a `/ne` prefix whether or not Nepali is served", () => {
    /*
     * THE DANGEROUS HALF OF HIDING A LOCALE, and the reason `stripLocale`
     * iterates `ALL_LOCALES`. Route guards match the unprefixed path, so if it
     * iterated the SERVED list then with Nepali hidden `/ne/account` would strip
     * to `/ne/account` — not in `PROTECTED_ROUTES`, so `middleware.ts` would
     * wave it through. A hidden locale must 404 at the router, never become a
     * way past the guard, and `/ne/...` is still a string anybody can type.
     */
    expect(stripLocale("/ne/account")).toBe("/account");
    expect(stripLocale("/ne")).toBe("/");
    expect(stripLocale("/account")).toBe("/account");
    expect(code("i18n/routing.ts")).toContain("for (const locale of ALL_LOCALES)");
  });

  it("offers no language toggle when there is nothing to switch to", () => {
    /* A toggle would advertise the thing that has been removed and land
       somebody on a 404. Gated at the MOUNT, because an early return above the
       hooks is what `react-hooks/rules-of-hooks` refuses. */
    const toggle = code("components/marketing/language-toggle.tsx");
    expect(toggle).toContain("export function canSwitchLanguage()");
    expect(toggle).toContain("routing.locales.length > 1");
    expect(code("components/marketing/site-header.tsx")).toContain(
      "canSwitchLanguage()",
    );
  });
});
