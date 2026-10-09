import { describe, expect, it } from "vitest";

import { judgeAiRequest, type GateInput } from "@/lib/ai/gate";
import {
  applyTopicVerdict,
  freeRefusal,
  aiPaused,
  type OffTopicState,
} from "@/lib/ai/offtopic";
import { priceCall, shareOf } from "@/lib/ai/spend";
import {
  DEFAULT_AI_LIMITS,
  aiLimitsFrom,
  clampLimit,
  nepalDayEndsAt,
  nepalDayKey,
  snake,
} from "@/lib/config/ai-limits";
import { applySafetyFloor } from "@/lib/ai/safety";
import type { SafetyCopy } from "@/lib/ai/copy";
import { triageProblem } from "@/lib/ai/mockTriage";

/**
 * What the AI is allowed to cost, and what one person is allowed to ask.
 *
 * THE CASE THAT MATTERS MOST IS THE LAST ONE: a hazard still reaches somebody with every
 * ceiling in this file refusing the model call. A budget that could silence "switch off
 * at the mains" would be worth more than the money it saves.
 */

const AT = new Date("2026-10-09T06:00:00Z");

const SAFETY_COPY: SafetyCopy = {
  gas: "Leave the building and open the windows.",
  burning: "Switch off at the mains.",
  sparking: "Switch off at the mains.",
  "live-wire": "Do not touch it.",
  liveWire: "Do not touch it.",
  shock: "Switch off at the mains.",
  unseenPhoto: "We couldn't look at your photo.",
} as SafetyCopy;

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    limits: DEFAULT_AI_LIMITS,
    accountId: "acc-1",
    text: "the kitchen tap is dripping",
    hasPhoto: false,
    used: { anonTriages: 0, userText: 0, userPhotos: 0, unrelatedPhotos: 0 },
    pausedUntil: null,
    anonOffTopicToday: false,
    budget: { visitorRemainingUsd: 0.2, userRemainingUsd: 0.8 },
    dayEndsAt: nepalDayEndsAt(AT).toISOString(),
    at: AT,
    ...over,
  };
}

describe("what a visitor gets", () => {
  it("gets two questions and is then asked to sign in", () => {
    const visitor = { accountId: null };
    expect(judgeAiRequest(input({ ...visitor, used: counts({ anonTriages: 1 }) })).allowed).toBe(true);
    const spent = judgeAiRequest(input({ ...visitor, used: counts({ anonTriages: 2 }) }));
    expect(spent.allowed).toBe(false);
    if (spent.allowed) return;
    expect(spent.refusal.kind).toBe("signInToContinue");
  });

  it("gets no photo analysis at all, however much budget is left", () => {
    /* Structural rather than a quota: the expensive call that never caches is the one
       place it must not be available without an account behind it. */
    const verdict = judgeAiRequest(
      input({ accountId: null, hasPhoto: true, text: "" }),
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.refusal.kind).toBe("photosNeedAccount");
  });

  it("loses the AI for the day on ONE off-topic question", () => {
    const verdict = judgeAiRequest(
      input({ accountId: null, anonOffTopicToday: true }),
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.refusal.kind).toBe("signInAfterOffTopic");
  });

  it("is capped at a shorter question than a signed-in account", () => {
    /* Varied, because two distinct characters repeated is a DIFFERENT refusal — which
       is how the first version of this case accidentally tested the wrong rule. */
    const long = "the kitchen tap is dripping badly onto the floor, ".repeat(8);
    expect(long.trim().length).toBeGreaterThan(DEFAULT_AI_LIMITS.anonMaxChars);
    expect(long.trim().length).toBeLessThan(DEFAULT_AI_LIMITS.userMaxChars);

    const visitor = judgeAiRequest(input({ accountId: null, text: long }));
    expect(visitor.allowed).toBe(false);
    expect(judgeAiRequest(input({ text: long })).allowed).toBe(true);
  });
});

describe("what a signed-in account gets", () => {
  it("has separate daily allowances for text and photographs", () => {
    const textSpent = counts({ userText: DEFAULT_AI_LIMITS.userTextPerDay });
    const photosSpent = counts({ userPhotos: DEFAULT_AI_LIMITS.userPhotosPerDay });

    expect(judgeAiRequest(input({ used: textSpent })).allowed).toBe(false);
    /* THE WHOLE REASON FOR TWO ALLOWANCES: spending one does not close the other. */
    expect(
      judgeAiRequest(input({ used: textSpent, hasPhoto: true, text: "" })).allowed,
    ).toBe(true);
    expect(
      judgeAiRequest(input({ used: photosSpent, hasPhoto: true, text: "" })).allowed,
    ).toBe(false);
    expect(judgeAiRequest(input({ used: photosSpent })).allowed).toBe(true);
  });

  it("closes photographs for this question after two unrelated ones, and leaves text open", () => {
    const used = counts({ unrelatedPhotos: 2 });
    const photo = judgeAiRequest(input({ used, hasPhoto: true, text: "" }));
    expect(photo.allowed).toBe(false);
    if (photo.allowed) return;
    expect(photo.refusal.kind).toBe("photosClosedForThisQuestion");
    expect(judgeAiRequest(input({ used })).allowed).toBe(true);
  });

  it("refuses while a pause is running and allows once it has passed", () => {
    const running = new Date(AT.getTime() + 3_600_000).toISOString();
    const over = new Date(AT.getTime() - 1_000).toISOString();
    expect(judgeAiRequest(input({ pausedUntil: running })).allowed).toBe(false);
    expect(judgeAiRequest(input({ pausedUntil: over })).allowed).toBe(true);
  });

  it("is allowed a longer question than a visitor and still has a ceiling", () => {
    const huge = "a leaking tap ".repeat(60);
    expect(huge.length).toBeGreaterThan(DEFAULT_AI_LIMITS.userMaxChars);
    expect(judgeAiRequest(input({ text: huge })).allowed).toBe(false);
  });
});

describe("the free refusals cost nothing", () => {
  it("refuses a string too short to be a question", () => {
    expect(freeRefusal("hi", { maxChars: 500 })).toBe("tooShort");
    expect(freeRefusal("   ", { maxChars: 500 })).toBe("tooShort");
  });

  it("refuses one character held down", () => {
    expect(freeRefusal("aaaaaaaaaa", { maxChars: 500 })).toBe("repeated");
    expect(freeRefusal("..........", { maxChars: 500 })).toBe("repeated");
    expect(freeRefusal("ababababab", { maxChars: 500 })).toBe("repeated");
  });

  it("lets a real short report through", () => {
    /* Somebody standing in a wet kitchen types the minimum. Four distinct characters in
       five is an ordinary report, not noise. */
    expect(freeRefusal("leaks", { maxChars: 500 })).toBeNull();
    expect(freeRefusal("ढल गयो", { maxChars: 500 })).toBeNull();
  });

  it("is reached before any counter, so the cheapest abuse is the cheapest to refuse", () => {
    const verdict = judgeAiRequest(
      input({ text: "aaaa", used: counts({ userText: 99 }) }),
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.refusal.kind).toBe("free");
  });

  it("does not call a photograph with no words too short", () => {
    /* A photograph is a complete question on its own — that is how the hero has always
       worked, and a length rule about the text must not take it away. */
    expect(judgeAiRequest(input({ text: "", hasPhoto: true })).allowed).toBe(true);
  });
});

describe("the budget", () => {
  it("reserves the larger part for people who signed in", () => {
    const shares = shareOf({
      dailyBudgetUsd: 1,
      visitorShareBps: 2000,
      spentUsd: 0,
      visitorSpentUsd: 0,
    });
    expect(shares.visitorRemainingUsd).toBeCloseTo(0.2);
    expect(shares.userRemainingUsd).toBeCloseTo(1);
  });

  it("closes the visitors' share without closing anybody else's", () => {
    const shares = shareOf({
      dailyBudgetUsd: 1,
      visitorShareBps: 2000,
      spentUsd: 0.2,
      visitorSpentUsd: 0.2,
    });
    expect(shares.visitorRemainingUsd).toBe(0);
    expect(shares.userRemainingUsd).toBeCloseTo(0.8);

    const visitor = judgeAiRequest(
      input({ accountId: null, budget: { visitorRemainingUsd: 0, userRemainingUsd: 0.8 } }),
    );
    expect(visitor.allowed).toBe(false);
    if (visitor.allowed) return;
    expect(visitor.refusal.kind).toBe("budgetSpent");
    expect(judgeAiRequest(input({ budget: { visitorRemainingUsd: 0, userRemainingUsd: 0.8 } })).allowed).toBe(true);
  });

  it("never lets a visitor spend the last of the whole day", () => {
    /* Their own share is untouched and there is almost nothing left overall. Bounded by
       both, or a quiet visitor morning would eat a busy signed-in afternoon. */
    const shares = shareOf({
      dailyBudgetUsd: 1,
      visitorShareBps: 2000,
      spentUsd: 0.99,
      visitorSpentUsd: 0,
    });
    expect(shares.visitorRemainingUsd).toBeCloseTo(0.01);
  });

  it("prices a call from what the provider reported, not from our own guess", () => {
    const cost = priceCall("claude-sonnet-4-6", {
      input_tokens: 2_250,
      output_tokens: 400,
      cache_read_input_tokens: 2_000,
      cache_creation_input_tokens: 0,
    });
    // 2250*3 + 400*15 + 2000*0.30, per million
    expect(cost.usd).toBeCloseTo((2250 * 3 + 400 * 15 + 2000 * 0.3) / 1e6, 10);
    expect(cost.pricedAsUnknown).toBe(false);
  });

  it("prices a model it does not know at the dearest rate it does, never at zero", () => {
    /* A model id we do not recognise is a model somebody switched to. A budget that reads
       it as free stops working on the day it matters most. */
    const cost = priceCall("claude-something-new", { input_tokens: 1000, output_tokens: 1000 });
    expect(cost.pricedAsUnknown).toBe(true);
    expect(cost.usd).toBeGreaterThan(0);
  });

  it("reports no usage as no cost rather than guessing one", () => {
    expect(priceCall("claude-sonnet-4-6", null).usd).toBe(0);
  });
});

describe("the off-topic streak", () => {
  const fresh: OffTopicState = { streak: 0, pausedUntil: null, lastPausedAt: null };

  it("pauses on the second off-topic question in a row", () => {
    const first = applyTopicVerdict({ ...rule(), state: fresh, onTopic: false });
    expect(first.paused).toBe(false);
    expect(first.next.streak).toBe(1);

    const second = applyTopicVerdict({ ...rule(), state: first.next, onTopic: false });
    expect(second.paused).toBe(true);
    expect(aiPaused(second.next, AT)).toBe(true);
  });

  it("is cleared by one on-topic question", () => {
    const first = applyTopicVerdict({ ...rule(), state: fresh, onTopic: false });
    const good = applyTopicVerdict({ ...rule(), state: first.next, onTopic: true });
    expect(good.next.streak).toBe(0);

    /* And the next off-topic one starts over rather than finishing the old streak. */
    const after = applyTopicVerdict({ ...rule(), state: good.next, onTopic: false });
    expect(after.paused).toBe(false);
  });

  it("flags a second pause inside the window for a person, and acts on nothing", () => {
    const earlier = new Date(AT.getTime() - 3 * 86_400_000).toISOString();
    const state: OffTopicState = { streak: 1, pausedUntil: null, lastPausedAt: earlier };
    const outcome = applyTopicVerdict({ ...rule(), state, onTopic: false });
    expect(outcome.paused).toBe(true);
    expect(outcome.flagForReview).toBe(true);
    /* No permanent block exists in the type, so none can be reached. */
    expect(Object.keys(outcome)).toEqual(["next", "paused", "flagForReview"]);
  });

  it("does not flag a pause outside the window", () => {
    const old = new Date(AT.getTime() - 30 * 86_400_000).toISOString();
    const state: OffTopicState = { streak: 1, pausedUntil: null, lastPausedAt: old };
    expect(applyTopicVerdict({ ...rule(), state, onTopic: false }).flagForReview).toBe(false);
  });

  it("does not let an on-topic question end a pause early", () => {
    const paused: OffTopicState = {
      streak: 0,
      pausedUntil: new Date(AT.getTime() + 3_600_000).toISOString(),
      lastPausedAt: AT.toISOString(),
    };
    const good = applyTopicVerdict({ ...rule(), state: paused, onTopic: true });
    expect(aiPaused(good.next, AT)).toBe(true);
  });
});

describe("safety never depends on the AI", () => {
  /*
   * THE CASE THE WHOLE FILE EXISTS TO PROTECT. Every ceiling above refuses the model
   * call. The keyword matcher costs nothing, runs in the browser, and the safety floor
   * runs over its answer — so somebody who smells gas gets told what to do with the
   * budget spent, the account paused and the day's questions gone.
   */
  it("still shows the emergency guidance with every ceiling refusing", () => {
    for (const text of ["I can smell gas in the kitchen", "ग्यास गन्हायो"]) {
      const refused = judgeAiRequest(
        input({
          text,
          accountId: null,
          anonOffTopicToday: true,
          used: counts({ anonTriages: 99 }),
          budget: { visitorRemainingUsd: 0, userRemainingUsd: 0 },
        }),
      );
      expect(refused.allowed).toBe(false);

      const answer = applySafetyFloor(
        text,
        triageProblem(text, explanations()),
        { copy: SAFETY_COPY },
      );
      expect(answer.result.urgency).toBe("emergency");
      expect(answer.result.explanation.length).toBeGreaterThan(10);
    }
  });
});

describe("the day rolls in Kathmandu, not in UTC", () => {
  it("is still yesterday at UTC midnight", () => {
    /* UTC midnight is 05:45 local. A UTC day would reset the budget during the morning
       and again mid-evening on the clock somebody is actually reading. */
    expect(nepalDayKey(new Date("2026-10-09T00:00:00Z"))).toBe("2026-10-09");
    expect(nepalDayKey(new Date("2026-10-08T18:00:00Z"))).toBe("2026-10-08");
    expect(nepalDayKey(new Date("2026-10-08T18:16:00Z"))).toBe("2026-10-09");
  });

  it("ends the day at local midnight", () => {
    const ends = nepalDayEndsAt(new Date("2026-10-09T06:00:00Z"));
    expect(ends.toISOString()).toBe("2026-10-09T18:15:00.000Z");
  });
});

describe("the limits are bounded, and a bad row cannot widen them", () => {
  it("clamps a value outside its bounds", () => {
    expect(clampLimit("dailyBudgetUsd", -5)).toBe(0);
    expect(clampLimit("dailyBudgetUsd", 99_999)).toBe(1000);
    expect(clampLimit("visitorShareBps", 50_000)).toBe(10_000);
  });

  it("falls back per field rather than throwing the whole row away", () => {
    const limits = aiLimitsFrom({ daily_budget_usd: 2, anon_triages_per_day: null });
    expect(limits.dailyBudgetUsd).toBe(2);
    expect(limits.anonTriagesPerDay).toBe(DEFAULT_AI_LIMITS.anonTriagesPerDay);
  });

  it("reads an unreadable row as the defaults, never as no limit", () => {
    expect(aiLimitsFrom(null)).toEqual(DEFAULT_AI_LIMITS);
  });

  it("derives the column names rather than writing them twice", () => {
    expect(snake("anonTriagesPerDay")).toBe("anon_triages_per_day");
    expect(snake("visitorShareBps")).toBe("visitor_share_bps");
  });
});

/* ------------------------------------------------------------------ */

function counts(over: Partial<GateInput["used"]> = {}): GateInput["used"] {
  return { anonTriages: 0, userText: 0, userPhotos: 0, unrelatedPhotos: 0, ...over };
}

function rule() {
  return {
    at: AT,
    streakToPause: DEFAULT_AI_LIMITS.offTopicStreakToPause,
    pauseHours: DEFAULT_AI_LIMITS.offTopicPauseHours,
    repeatWindowDays: DEFAULT_AI_LIMITS.offTopicRepeatWindowDays,
  };
}

/** Just enough `TriageCopy` for the matcher and the safety floor. */
function explanations(): Parameters<typeof triageProblem>[1] {
  return {
    safety: SAFETY_COPY,
    /* A Proxy so every rule key resolves — the matcher looks one up by name and the
       case under test is the safety line, not which explanation came back. */
    explanations: new Proxy(
      {},
      { get: () => "We'll match you with the right professional." },
    ) as Record<string, string>,
    genericCategory: "Plumbing",
    genericCtaLabel: "Find a plumber",
  };
}
