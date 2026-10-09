/**
 * Refusing a question before it costs anything, and reading the model's verdict when it
 * does.
 *
 * TWO LAYERS AND THEY ARE DIFFERENT KINDS OF THING. The free layer is three mechanical
 * facts about the string — too short, one character repeated, too long — and it runs
 * before any model call, so the cheapest abuse costs nothing at all. The model layer is a
 * judgement: "this is not a home-service problem", with the model's own sentence for why.
 *
 * THE MODEL'S HALF IS A JUDGEMENT AND IS NEVER SCORED — rule 6. There is no confidence
 * number, no total, no threshold on a screen. `onTopic` is a named answer with a reason
 * beside it, null means nobody asked or nobody answered, and null is never read as "fine".
 * What it feeds is a count of CONSECUTIVE off-topic questions, which is a count of
 * answers somebody gave, not a score of the person.
 *
 * AND THE STREAK RESETS. One on-topic question clears it, because the thing worth acting
 * on is a pattern and not an accident: somebody whose first attempt was a joke and whose
 * second is a leaking tap is a customer.
 */

/** A fact about the string, established without asking anybody. */
export type FreeRefusal =
  /** Fewer than five characters. "hi", "...", an accidental submit. */
  | "tooShort"
  /** Two or fewer distinct characters. "aaaaaaa", "....", "ababab". */
  | "repeated"
  /** Longer than this caller is allowed — 300 signed out, 500 signed in. */
  | "tooLong";

/**
 * The shortest a question can be and still be a question.
 *
 * FIVE, MATCHING THE CLAIM DESCRIPTION'S FLOOR. "leak" is four characters and a complete
 * report; "tap" is three. The floor is deliberately low — a person standing in a wet
 * kitchen types the minimum — and it is here to catch an empty submit rather than to
 * demand a sentence.
 */
export const MIN_QUESTION_CHARS = 5;

/**
 * How few distinct characters make a string noise rather than a question.
 *
 * TWO, counting after whitespace is removed. "aaaaaa" is one, "ababab" is two, and
 * "छ छ छ" is one once the spaces go. Three distinct characters is where real words start
 * — "ढल", "tap", "गयो" — so the test stops below them rather than guessing at language.
 */
const MIN_DISTINCT_CHARS = 3;

/**
 * Judge the string, for free.
 *
 * ORDER IS BY WHAT THE PERSON CAN DO ABOUT IT. "say a little more" is the useful sentence
 * for a short string; telling somebody their six characters are repetitive is true and
 * unhelpful. Length last, because it is the only one that is about us rather than them.
 */
export function freeRefusal(
  text: string,
  options: { maxChars: number },
): FreeRefusal | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_QUESTION_CHARS) return "tooShort";

  const distinct = new Set(trimmed.replace(/\s+/g, "")).size;
  if (distinct > 0 && distinct < MIN_DISTINCT_CHARS) return "repeated";

  if (trimmed.length > options.maxChars) return "tooLong";
  return null;
}

/** What the model said about the question itself. Null is "not recorded". */
export type TopicVerdict = {
  onTopic: boolean;
  /** The model's own sentence. Shown to the person, so it has to be actionable. */
  reason: string | null;
};

export type OffTopicState = {
  /** Consecutive off-topic questions. Reset to zero by one on-topic answer. */
  streak: number;
  /** When the current pause ends, or null. */
  pausedUntil: string | null;
  /** When the last pause started, for the repeat-within-7-days flag. */
  lastPausedAt: string | null;
};

export type OffTopicOutcome = {
  /** The state to store. */
  next: OffTopicState;
  /** True when this answer started a pause. */
  paused: boolean;
  /**
   * True when this is a second pause inside the repeat window.
   *
   * A FLAG FOR A PERSON, NEVER AN ACTION. There is no automatic permanent block here and
   * there is not going to be one: the whole evidence is "somebody typed things a model
   * called off-topic", and a model that is wrong twice about somebody's Nepali is a model
   * being wrong, not a person to lock out.
   */
  flagForReview: boolean;
};

/**
 * Apply one verdict to an account's running state.
 *
 * PURE, SO THE RULE IS TESTABLE WITHOUT A DATABASE — the same posture as
 * `lib/payments/pricing.ts` and `lib/photos/evidence.ts`. The caller stores `next` and
 * acts on the two booleans; nothing here reads a clock it was not handed.
 */
export function applyTopicVerdict(input: {
  state: OffTopicState;
  onTopic: boolean;
  at: Date;
  streakToPause: number;
  pauseHours: number;
  repeatWindowDays: number;
}): OffTopicOutcome {
  if (input.onTopic) {
    /* ONE GOOD QUESTION CLEARS IT. The pause itself is left alone — serving its time is
       not something an on-topic question undoes, or the pause would mean nothing. */
    return {
      next: { ...input.state, streak: 0 },
      paused: false,
      flagForReview: false,
    };
  }

  const streak = input.state.streak + 1;
  if (streak < input.streakToPause) {
    return {
      next: { ...input.state, streak },
      paused: false,
      flagForReview: false,
    };
  }

  const pausedUntil = new Date(
    input.at.getTime() + input.pauseHours * 3_600_000,
  ).toISOString();

  const previous = input.state.lastPausedAt
    ? Date.parse(input.state.lastPausedAt)
    : null;
  const repeat =
    previous !== null &&
    !Number.isNaN(previous) &&
    input.at.getTime() - previous <= input.repeatWindowDays * 86_400_000;

  return {
    /* The streak resets with the pause: it has been acted on, and carrying it would make
       the next single off-topic question pause them again the moment the first lifts. */
    next: { streak: 0, pausedUntil, lastPausedAt: input.at.toISOString() },
    paused: true,
    flagForReview: repeat,
  };
}

/** Is this account's AI triage paused right now? */
export function aiPaused(state: OffTopicState, at: Date = new Date()): boolean {
  if (!state.pausedUntil) return false;
  const until = Date.parse(state.pausedUntil);
  return !Number.isNaN(until) && until > at.getTime();
}
