import { freeRefusal, type FreeRefusal } from "@/lib/ai/offtopic";
import type { AiLimits } from "@/lib/config/ai-limits";

/**
 * May this request reach the model, and if not, what does the person read?
 *
 * ONE PURE FUNCTION, HANDED EVERY COUNT RATHER THAN READING ANY. The caller does the
 * round trips; this decides. That is what makes the whole ceiling testable without a
 * database or a store, and it is the same posture as `judgeRefund` and
 * `inspectionRequired` — the rules that decide money in this product are all pure and all
 * readable in one screen.
 *
 * THE ORDER IS FREE-THEN-CHEAP-THEN-EXPENSIVE, and it is not cosmetic. Everything that
 * can be established from the string alone comes first, because those refusals cost
 * nothing at all; then the counters, which cost a round trip; then the budget, which is
 * the one that affects everybody else. A request refused at the top never touches the
 * store, so the cheapest abuse is also the cheapest to refuse.
 *
 * NOTHING HERE DECIDES SAFETY. Every refusal below returns `allowed: false` and the route
 * still runs the free keyword check over the text — gas, sparks, burning, live wire, in
 * English and Nepali — and still shows the emergency guidance. A ceiling that could
 * silence a hazard warning would be worth more than the money it saves. That is asserted
 * as behaviour in `tests/unit/ai-gate.test.ts` rather than promised here.
 */

export type GateRefusal =
  /** The string never needed a model: too short, one character, too long. */
  | { kind: "free"; reason: FreeRefusal; maxChars: number }
  /** A visitor asked for a photo analysis. Signed-out is text only. */
  | { kind: "photosNeedAccount" }
  /** A visitor used their questions for today. Everything else still works. */
  | { kind: "signInToContinue" }
  /** A visitor asked something off-topic. Their AI day ends there. */
  | { kind: "signInAfterOffTopic" }
  /** A signed-in account used its text allowance. */
  | { kind: "dailyTextSpent"; limit: number }
  /** A signed-in account used its photo allowance. Text still works. */
  | { kind: "dailyPhotosSpent"; limit: number }
  /** Two unrelated photographs on this question. Text still works. */
  | { kind: "photosClosedForThisQuestion" }
  /** AI triage is paused for this account after repeated off-topic questions. */
  | { kind: "paused"; until: string }
  /** The site's day budget, or this group's share of it, is spent. */
  | { kind: "budgetSpent"; group: "visitor" | "user"; until: string };

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; refusal: GateRefusal };

export type GateInput = {
  limits: AiLimits;
  /** Null when signed out. */
  accountId: string | null;
  text: string;
  hasPhoto: boolean;
  /** Counts already used today, from `lib/server/ai-quota.ts`. */
  used: {
    anonTriages: number;
    userText: number;
    userPhotos: number;
    /** Unrelated photographs inside the current question's window. */
    unrelatedPhotos: number;
  };
  /** The account's off-topic pause, as an ISO instant, or null. */
  pausedUntil: string | null;
  /** True when a signed-out visitor has already had an off-topic answer today. */
  anonOffTopicToday: boolean;
  /** What is left of today's budget for each group, in dollars. */
  budget: { visitorRemainingUsd: number; userRemainingUsd: number };
  /** When the Nepal day ends, for the "back tomorrow" line. */
  dayEndsAt: string;
  at: Date;
};

export function judgeAiRequest(input: GateInput): GateVerdict {
  const signedIn = Boolean(input.accountId);

  /* ---- free: nothing below this line costs a round trip ---------------- */

  /*
   * A VISITOR GETS NO PHOTO ANALYSIS AT ALL, and this is structural rather than a
   * quota. A photograph is the expensive call and it never caches, so the one place it
   * must not be available is the one with no account behind it. The upload button is
   * hidden for a visitor too; this is the half a script cannot skip.
   */
  if (!signedIn && input.hasPhoto) {
    return { allowed: false, refusal: { kind: "photosNeedAccount" } };
  }

  const maxChars = signedIn ? input.limits.userMaxChars : input.limits.anonMaxChars;
  const free = freeRefusal(input.text, { maxChars });
  /*
   * A PHOTOGRAPH IS A COMPLETE QUESTION ON ITS OWN, so an empty or short text beside one
   * is not a refusal — `tooShort` only applies when the text is all there is. `tooLong`
   * applies either way: the text is a cost whether or not a photograph came with it.
   */
  if (free && (free === "tooLong" || !input.hasPhoto)) {
    return { allowed: false, refusal: { kind: "free", reason: free, maxChars } };
  }

  /* ---- the account's own state ---------------------------------------- */

  if (input.pausedUntil) {
    const until = Date.parse(input.pausedUntil);
    if (!Number.isNaN(until) && until > input.at.getTime()) {
      return {
        allowed: false,
        refusal: { kind: "paused", until: input.pausedUntil },
      };
    }
  }

  if (!signedIn) {
    /*
     * ONE OFF-TOPIC QUESTION ENDS A VISITOR'S AI DAY, where a signed-in account gets two
     * in a row and then a pause. The asymmetry is deliberate: a visitor is anonymous and
     * costs us money, and the remedy offered is not a punishment but the thing we wanted
     * anyway — sign in. Everything else on the site stays open to them.
     */
    if (input.anonOffTopicToday) {
      return { allowed: false, refusal: { kind: "signInAfterOffTopic" } };
    }
    if (input.used.anonTriages >= input.limits.anonTriagesPerDay) {
      return { allowed: false, refusal: { kind: "signInToContinue" } };
    }
  } else if (input.hasPhoto) {
    if (input.used.unrelatedPhotos >= input.limits.unrelatedPhotosPerRequest) {
      return {
        allowed: false,
        refusal: { kind: "photosClosedForThisQuestion" },
      };
    }
    if (input.used.userPhotos >= input.limits.userPhotosPerDay) {
      return {
        allowed: false,
        refusal: { kind: "dailyPhotosSpent", limit: input.limits.userPhotosPerDay },
      };
    }
  } else if (input.used.userText >= input.limits.userTextPerDay) {
    return {
      allowed: false,
      refusal: { kind: "dailyTextSpent", limit: input.limits.userTextPerDay },
    };
  }

  /* ---- the site's budget, last because it is everybody's --------------- */

  const remaining = signedIn
    ? input.budget.userRemainingUsd
    : input.budget.visitorRemainingUsd;

  if (remaining <= 0) {
    return {
      allowed: false,
      refusal: {
        kind: "budgetSpent",
        group: signedIn ? "user" : "visitor",
        until: input.dayEndsAt,
      },
    };
  }

  return { allowed: true };
}

/**
 * The message key a refusal reads as, in both languages.
 *
 * A MAPPING RATHER THAN A TEMPLATE, so a refusal added to `GateRefusal` without a
 * sentence is a type error here instead of a key rendered into the page — which is what
 * `check:keys` catches after the fact and this catches before it.
 */
export const GATE_MESSAGE_KEY: Record<GateRefusal["kind"], string> = {
  free: "free",
  photosNeedAccount: "photosNeedAccount",
  signInToContinue: "signInToContinue",
  signInAfterOffTopic: "signInAfterOffTopic",
  dailyTextSpent: "dailyTextSpent",
  dailyPhotosSpent: "dailyPhotosSpent",
  photosClosedForThisQuestion: "photosClosedForThisQuestion",
  paused: "paused",
  budgetSpent: "budgetSpent",
};
