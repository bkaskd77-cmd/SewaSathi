import type { SafetyCopy } from "@/lib/ai/copy";
import type { TriageResult } from "@/lib/ai/mockTriage";

/**
 * The hazard guard.
 *
 * The system prompt already tells Claude to lead with a safety instruction for
 * gas, fire, sparking and live wiring. This runs anyway, on every result from
 * every source — the model, the cache, and the keyword fallback in the
 * browser. "We told the model to" is not a guarantee, and the failure mode is
 * somebody standing in a kitchen that smells of gas being shown a booking
 * button.
 *
 * Deliberately blunt: it reads the text the person typed, not the model's
 * answer. A false positive costs one unnecessary safety sentence. A false
 * negative costs something we are not willing to pay.
 *
 * Pure and dependency-free so the client fallback path can run it too. The
 * wording is passed in (see lib/ai/copy.ts) rather than held here: these lines
 * exist in both languages, and a person reading Nepali who is told in English
 * not to light a flame has not been told anything.
 */

export type Hazard = "gas" | "burning" | "live-wire";

// Romanized Nepali is written a dozen ways, so the patterns are loose on
// spelling and tight on meaning. Devanagari is included because people type
// it directly on an Android keyboard.
// `गन्ध` is the noun; `गन्हाउनु`/`गनाउनु` is the verb people actually type —
// "ग्यास गन्हाइरहेको छ" is how somebody says it, and matching only the noun
// sent that straight down the calm path. Found by a test, not by review.
const SMELL_OR_LEAK =
  /(smell|smelt|smelling|stink|odou?r|leak|leaking|leakage|gandha|gandh|bass?na|गन्ध|गन्हा|गनाउ|गनाइ|बास्ना|चुहि|लिक)/i;

const GAS = /(\bgas\b|lpg|ग्यास|सिलिन्डर|cylinder)/i;

// An AC gas top-up is a service, not a hazard, and it is the single most
// likely false positive in the whole product ("ac gas refill" is a category
// we sell). A refrigerant leak still reaches Claude, which treats it on its
// merits — it just does not get the LPG script, which would be wrong advice.
const AC_CONTEXT = /(\bac\b|a\/c|air ?con|air conditioner|एसी)/i;

const BURNING =
  /(burn(ing|t|ed)?\s*(smell|plastic|wire|rubber)?|smoke|smoking|spark|sparking|sparks|short.?circuit|fire|flame|jaleko|poleko|dhuwa|aago|पोलेको|जलेको|धुवाँ|आगो|आगलागी)/i;

// "burning" alone is too broad — a burning question, burning the rice. Pair it
// with something that belongs to a house fire.
const BURNING_CONTEXT =
  /(smell|smoke|wire|wiring|switch|socket|board|plug|fuse|mcb|meter|plastic|rubber|panel|बत्ती|तार|स्विच)/i;

const LIVE_WIRE =
  /(live wire|bare wire|exposed wire|open wire|naked wire|electric shock|electrocut|shock lag|current lag|karent lag|करेन्ट|बिजुली लाग|तार खुल)/i;

/** The hazard a description points at, or null. First match wins, worst first. */
export function detectHazard(input: string): Hazard | null {
  const text = input.toLowerCase();
  if (!text.trim()) return null;

  if (LIVE_WIRE.test(text)) return "live-wire";

  if (GAS.test(text) && SMELL_OR_LEAK.test(text) && !AC_CONTEXT.test(text)) {
    return "gas";
  }

  if (BURNING.test(text) && BURNING_CONTEXT.test(text)) return "burning";

  return null;
}

/**
 * Where the "we couldn't look at your photo" line is allowed to appear.
 *
 * Not a hazard claim — a statement that we could not check. It goes on the
 * categories where a gas or electrical hazard actually lives, so a photo of a
 * sofa awaiting a clean does not come back with a warning about flames.
 */
const HAZARD_PRONE_CATEGORIES = new Set([
  "electrical",
  "plumbing",
  "appliance-repair",
  "ac-servicing",
]);

/**
 * Does this explanation already open with something to do right now?
 *
 * Both scripts, because the model answers in the reader's language: the
 * English verbs, and the Nepali imperatives for switching off, not lighting a
 * flame, opening a window and staying clear. Getting this wrong only ever
 * costs a duplicated sentence, never a missing one.
 */
function leadsWithSafety(explanation: string, ours?: string): boolean {
  // Exact first: if this is our own line, we know it verbatim, and comparing
  // against it cannot drift when the copy is reworded. The heuristic below is
  // only for explanations the model wrote itself.
  if (ours && explanation.trimStart().startsWith(ours.trimStart())) return true;

  const opening = explanation.slice(0, 160).toLowerCase();
  if (
    /(switch off|turn off|don't|do not|open the window|leave the room|step outside|close the (cylinder|valve)|keep everyone away|unplug)/.test(
      opening,
    )
  ) {
    return true;
  }
  return /(मेन स्विच|स्विच बन्द|आगो नबाल्नु|नछुनुहोस्|झ्याल खोल्नु|बाहिर निस्कनु|टाढा राख्नु|भल्भ बन्द|प्लग निकाल्नु)/.test(
    opening,
  );
}

/** How a hazard was spotted. Recorded so the two paths can be audited apart. */
export type HazardVia = "text" | "vision";

export type SafetyOutcome = {
  result: TriageResult;
  hazard: Hazard | null;
  via: HazardVia | null;
  /** True when we added the "couldn't see your photo" line instead. */
  cautioned: boolean;
};

/**
 * Force the safety path onto a result when the description or the photo
 * warrants it. Safe to call on everything — a result with no hazard comes back
 * untouched.
 *
 * `visionHazard` is the model's read of the photo, and it is strictly one-way:
 * it can raise a result to emergency and add the safety line, and there is no
 * branch anywhere that lets it lower one. The text guard wins when both fire,
 * because it is deterministic.
 *
 * The text guard cannot see a photo, and the panic case is exactly the person
 * who photographs a sparking switchboard and types nothing — hence the second
 * input, and hence `photoUnseen`, for when we never got a look at all.
 */
export function applySafetyFloor(
  input: string,
  result: TriageResult,
  options: {
    /** The safety lines in the reader's language. */
    copy: SafetyCopy;
    visionHazard?: Hazard | null;
    photoUnseen?: boolean;
  },
): SafetyOutcome {
  const textHazard = detectHazard(input);
  const hazard = textHazard ?? options.visionHazard ?? null;
  const via: HazardVia | null = textHazard
    ? "text"
    : options.visionHazard
      ? "vision"
      : null;

  if (hazard) {
    const explanation = leadsWithSafety(result.explanation, options.copy[hazard])
      ? result.explanation
      : `${options.copy[hazard]} ${result.explanation}`;

    return {
      result: { ...result, urgency: "emergency", explanation },
      hazard,
      via,
      cautioned: false,
    };
  }

  // A photo arrived and nothing looked at it. Say so, on the categories where
  // the thing we failed to check could be dangerous. Urgency is left alone —
  // "we did not see it" is not evidence of a hazard, and treating it as one
  // would make every outage an emergency.
  if (options.photoUnseen && HAZARD_PRONE_CATEGORIES.has(result.category)) {
    return {
      result: {
        ...result,
        explanation: `${options.copy.unseenPhoto} ${result.explanation}`,
      },
      hazard: null,
      via: null,
      cautioned: true,
    };
  }

  return { result, hazard: null, via: null, cautioned: false };
}
