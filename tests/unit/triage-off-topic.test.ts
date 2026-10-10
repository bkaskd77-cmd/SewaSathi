import { describe, expect, it } from "vitest";

import { buildTriagePrompt } from "@/lib/ai/prompt";
import { parseTriageResponse } from "@/lib/ai/triage-schema";
import { FALLBACK_PRICE_BANDS } from "@/lib/ai/price-bands";
import { hasSomethingToTriage } from "@/lib/ai/photo-retake";
import { keywordAnswer, GENERIC_RULE } from "@/lib/ai/mockTriage";
import { fallbackCause, firedDespiteKey } from "@/lib/ai/accuracy";
import { LOGGABLE_REASONS } from "@/lib/ai/reason";
import type { TriageCopy } from "@/lib/ai/copy";

/**
 * The bug: a prompt that asked for an answer the schema refused.
 *
 * `onTopic` has been in the prompt since the ceilings shipped and `category` was a
 * required enum, so a model correctly judging a question off-topic produced a reply this
 * product threw away whole — `unparseable`, verdict lost, keyword matcher prints
 * `GENERIC_RULE`. A visitor pasted lorem ipsum three times and read
 * "Plumbing · Needed soon · Rs 900 – Rs 4,000" three times. Seven rows in production on
 * 2026-10-10 carry exactly that shape.
 *
 * THE ASSERTIONS ARE OVER THE ENDS, NOT THE LINKS. Every individual piece worked: the
 * prompt asked, the model answered, `applyTopicVerdict` was correct, the counters were
 * atomic. What nobody ran was the pair. So the first test here parses the EXACT JSON the
 * prompt instructs the model to send — the same shape as `triage-band.test.ts`'s
 * `"band": null` case, which caught this class once before and was not generalised.
 */

const BANDS = FALLBACK_PRICE_BANDS;

describe("the reply the prompt asks for is a reply the schema accepts", () => {
  it("accepts an off-topic verdict with no trade named", () => {
    const parsed = parseTriageResponse(
      JSON.stringify({
        category: null,
        band: null,
        urgency: null,
        priceRangeNPR: null,
        explanation: "That looks like filler text rather than something at home.",
        hazard: "none",
        photoRelevance: null,
        photoRelevanceReason: null,
        onTopic: false,
        offTopicReason: "This reads as printing filler, not a problem in a house.",
      }),
      BANDS,
    );

    expect(parsed, "the whole reply was discarded").not.toBeNull();
    expect(parsed?.result, "no trade was named, so there is nothing to price").toBeNull();
    expect(parsed?.topic).toEqual({
      onTopic: false,
      reason: "This reads as printing filler, not a problem in a house.",
    });
  });

  it("accepts a home problem it could not place, which is not the same answer", () => {
    const parsed = parseTriageResponse(
      JSON.stringify({
        category: null,
        band: null,
        urgency: null,
        priceRangeNPR: null,
        explanation: "Something is wrong in the bathroom — which thing is it?",
        hazard: "none",
        onTopic: true,
        offTopicReason: null,
      }),
      BANDS,
    );

    expect(parsed?.result).toBeNull();
    expect(parsed?.topic?.onTopic).toBe(true);
  });

  /**
   * THE HAZARD IS THE REASON THIS MATTERS BEYOND TIDINESS. The prompt says in as many
   * words that `onTopic` never changes the hazard — so a reply that names no trade can
   * still be carrying "live-wire", and the old code dropped the whole object on the floor.
   */
  it("keeps the hazard on a reply that named no trade", () => {
    const parsed = parseTriageResponse(
      JSON.stringify({
        category: null,
        urgency: null,
        priceRangeNPR: null,
        explanation: "Switch it off at the mains before anything else.",
        hazard: "live-wire",
        onTopic: false,
        offTopicReason: "Mostly chat, but there is a live wire in there.",
      }),
      BANDS,
    );

    expect(parsed?.hazard).toBe("live-wire");
  });

  /**
   * AND THE LOOSENING STOPS THERE. `urgency` and `priceRangeNPR` became nullable only to
   * express "no trade"; a reply that DOES name one and omits them is malformed and is
   * still refused, exactly as it was before.
   */
  it("still refuses a named trade with no urgency or no price", () => {
    const base = {
      category: "plumbing",
      explanation: "A washer, most likely, and quick to change.",
      onTopic: true,
    };
    expect(
      parseTriageResponse(JSON.stringify({ ...base, priceRangeNPR: [900, 1200] }), BANDS),
    ).toBeNull();
    expect(
      parseTriageResponse(JSON.stringify({ ...base, urgency: "soon" }), BANDS),
    ).toBeNull();
    /* And with both, it is the ordinary answer it always was. */
    expect(
      parseTriageResponse(
        JSON.stringify({ ...base, urgency: "soon", priceRangeNPR: [900, 1200] }),
        BANDS,
      )?.result?.category,
    ).toBe("plumbing");
  });

  /**
   * THE PROMPT AND THE SCHEMA, CHECKED AS A PAIR. The whole fault was two halves that
   * each looked right. This asserts the instruction is actually there, so deleting it
   * fails here rather than silently going back to discarding every off-topic reply.
   */
  it("instructs the model to use null, and no longer to answer plumbing", () => {
    const prompt = buildTriagePrompt(BANDS, "en");
    expect(prompt).toMatch(/NO TRADE NAMED/);
    expect(prompt).toMatch(/"category", "band", "urgency" and "priceRangeNPR" all to null/);
    /* The instruction that used to hand the model GENERIC_RULE as a canned reply. */
    expect(prompt).not.toMatch(/If the request is not something we cover at all/);
  });
});

/** The same shape `triage-corpus.test.ts` uses: the words are irrelevant here. */
const COPY: TriageCopy = {
  explanations: new Proxy({} as Record<string, string>, {
    get: (_t, key) => `explanation for ${String(key)}`,
  }),
  safety: { gas: "GAS.", burning: "BURNING.", "live-wire": "WIRE.", unseenPhoto: "UNSEEN." },
  genericCategory: "a professional",
  genericCtaLabel: "Find a professional",
};

describe("nothing matched is not a recommendation", () => {
  const copy = COPY;

  it("says so when no keyword pointed anywhere", () => {
    const answer = keywordAnswer(
      "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
      copy,
    );
    expect(answer.matched).toBe(false);
    /* The result is still GENERIC_RULE — the scheduler needs a reservation. The point is
       that it is now labelled rather than silent. */
    expect(answer.result.category).toBe(GENERIC_RULE.category);
  });

  it("says so for a real problem", () => {
    const answer = keywordAnswer("the tap is leaking in the kitchen", copy);
    expect(answer.matched).toBe(true);
    expect(answer.result.category).toBe("plumbing");
  });

  /**
   * AN URGENT MARKER RAISES THE URGENCY OF AN ANSWER NOBODY FOUND. "right now" does not
   * find a trade, and if this ever returned `matched: true` the card would come back —
   * which is how a panicked visitor typing nonsense would be sent to a plumber.
   */
  it("does not count an urgency marker as having matched a trade", () => {
    const answer = keywordAnswer("need it right now right now", copy);
    expect(answer.matched).toBe(false);
  });
});

describe("what the hero shows when nobody named a trade", () => {
  const base = {
    hadPhoto: false,
    source: "claude" as const,
    verdict: null,
    hazard: null,
  };

  it("suppresses the card on an off-topic verdict", () => {
    expect(
      hasSomethingToTriage({
        ...base,
        text: "Lorem Ipsum is simply dummy text",
        topic: { onTopic: false },
      }),
    ).toBe(false);
  });

  it("suppresses it when nothing in the words pointed at a trade", () => {
    expect(
      hasSomethingToTriage({ ...base, text: "Lorem Ipsum is simply dummy text", matched: false }),
    ).toBe(false);
  });

  it("shows it for an ordinary question", () => {
    expect(
      hasSomethingToTriage({
        ...base,
        text: "tap leaking",
        topic: { onTopic: true },
        matched: true,
      }),
    ).toBe(true);
  });

  /**
   * THE ONE RULE THAT OUTRANKS EVERYTHING HERE. A hazard is never suppressed — not by an
   * off-topic verdict, not by the matcher finding nothing. Somebody who types a rambling
   * message containing "gas smell" has `applySafetyFloor` raise the answer to emergency,
   * and that answer is what they must see.
   */
  it("never suppresses an emergency, whatever either verdict says", () => {
    expect(
      hasSomethingToTriage({
        ...base,
        text: "whatever",
        hazard: "gas" as const,
        topic: { onTopic: false },
        matched: false,
      }),
    ).toBe(true);
  });

  /** An absent verdict is not an off-topic one — rule 6 on a judgement. */
  it("shows the card when nobody judged the words", () => {
    expect(
      hasSomethingToTriage({ ...base, text: "tap leaking", topic: null }),
    ).toBe(true);
  });
});

describe("a declined reply is counted as a reply, not as a fault", () => {
  it("is loggable, so the row survives the insert", () => {
    expect(LOGGABLE_REASONS).toContain("off-topic");
    expect(LOGGABLE_REASONS).toContain("no-trade");
  });

  it("groups both as the model declining, and neither as a fault", () => {
    for (const reason of ["off-topic", "no-trade"]) {
      const cause = fallbackCause({ reason, recorded: true });
      expect(cause).toBe("modelDeclined");
      expect(firedDespiteKey(cause)).toBe(false);
    }
  });

  /**
   * AND THE ONE THAT WAS ALREADY WRONG. `reason.ts` has said since the ceilings shipped
   * that counting a working ceiling among the faults "would make the fallback rate
   * unreadable" — and `fallbackCause` had no case for it, so every refusal fell through
   * `default` into `notRecorded` and was reported as a fallback nobody had diagnosed.
   * A comment describing behaviour the code did not have, one module over.
   */
  it("counts a ceiling as a ceiling rather than as undiagnosed", () => {
    const cause = fallbackCause({ reason: "ceiling-reached", recorded: true });
    expect(cause).toBe("ceilingReached");
    expect(firedDespiteKey(cause)).toBe(false);
  });
});

/**
 * The route's own wiring, read from its source.
 *
 * SAME SEAM AS `ai-quota-keys.test.ts` and for the same reason: these are decisions made
 * inside a handler that cannot be imported, and the failure they guard against is somebody
 * reaching for `source` again because it reads like the obvious field.
 */
describe("the route tells 'the model replied' from 'where the answer came from'", () => {
  it("does not decide the photo questions from `source`", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../app/api/triage/route.ts", import.meta.url),
      "utf8",
    );

    /*
     * THE COST OF GETTING THIS WRONG IS THE HAZARD. The model reads a photograph for gas,
     * burning and live wires BEFORE it decides what the words are about — so on a reply
     * that named no trade, `source` is `fallback` and a `source === "claude"` test here
     * would drop the vision hazard and tell the customer "we couldn't look at your photo"
     * by the product that had just looked at it.
     */
    expect(src).toMatch(/visionHazard: modelReplied \? visionHazard : null/);
    expect(src).toMatch(/photoUnseen: Boolean\(image\) && !modelReplied/);
    expect(src).toMatch(/const modelReplied = source === "claude" \|\| modelNamedNoTrade/);
  });

  it("logs the two declined replies apart", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../app/api/triage/route.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/\? "off-topic"\s*:\s*"no-trade"/);
  });
});

/**
 * The sentence that got through, kept verbatim.
 *
 * `matched: false` shipped and the card still appeared, carrying an EMERGENCY badge — a
 * worse answer than the "Needed soon" it replaced. `URGENT_MARKERS` contains "now", the
 * paste contained "now use Lorem Ipsum as their default model text", so the matcher
 * raised an answer it had found nothing for to `emergency`; and `hasSomethingToTriage`
 * tested the urgency BEFORE `matched`, so the escape meant for a hazard let it through.
 *
 * A word boundary would not have saved it: the text really does contain the word "now".
 * The fault is that an answer nobody found cannot be urgent about anything.
 *
 * TWO FIXES, SO TWO SETS OF CASES. The matcher no longer raises an unmatched answer, and
 * the one escape left in the suppression rule is the HAZARD rather than the label.
 */
describe("the lorem ipsum that reached a customer", () => {
  const PASTED =
    "now use Lorem Ipsum as their default model text, and a search for 'lorem ipsum' " +
    "will uncover many web sites still in their infancy";

  it("does not call an answer it never found urgent", () => {
    const answer = keywordAnswer(PASTED, COPY);
    expect(answer.matched).toBe(false);
    expect(answer.result.urgency, "the word 'now' is not an emergency").not.toBe(
      "emergency",
    );
  });

  it("shows no card for it, with or without a topic verdict", () => {
    const base = { hadPhoto: false, source: "fallback" as const, verdict: null };
    expect(
      hasSomethingToTriage({ ...base, text: PASTED, hazard: null, matched: false }),
    ).toBe(false);
    expect(
      hasSomethingToTriage({
        ...base,
        text: PASTED,
        hazard: null,
        matched: false,
        topic: { onTopic: false },
      }),
    ).toBe(false);
  });

  /**
   * THE HALF THAT MUST NOT HAVE BROKEN. Removing the urgency escape would be worthless if
   * it cost a hazard, so the same unmatched shape with gas in it still shows — and it
   * shows because `applySafetyFloor` read the gas, not because anything said "now".
   */
  it("still shows an answer when the words carry a hazard", () => {
    expect(
      hasSomethingToTriage({
        hadPhoto: false,
        source: "fallback",
        verdict: null,
        text: "ghar bhari gas ko gandha aairacha, kehi bhayo ki",
        hazard: "gas",
        matched: false,
      }),
    ).toBe(true);
  });

  /** And an ordinary urgent request is untouched: it matched, so it has a trade. */
  it("leaves a real urgent job alone", () => {
    const answer = keywordAnswer("tap is leaking, need someone right now", COPY);
    expect(answer.matched).toBe(true);
    expect(answer.result.urgency).toBe("emergency");
  });
});
