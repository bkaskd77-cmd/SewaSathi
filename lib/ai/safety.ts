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
 * Pure and dependency-free so the client fallback path can run it too.
 */

export type Hazard = "gas" | "burning" | "live-wire";

const LEAD_LINE: Record<Hazard, string> = {
  gas: "Don't light a flame or touch any switch — open the windows, close the cylinder valve if you can reach it, and step outside.",
  burning:
    "Switch off at the mains if you can reach it safely, and don't use that switch or socket again until it has been checked.",
  "live-wire":
    "Switch off at the mains and keep everyone away from the wire until an electrician has been.",
};

// Romanized Nepali is written a dozen ways, so the patterns are loose on
// spelling and tight on meaning. Devanagari is included because people type
// it directly on an Android keyboard.
const SMELL_OR_LEAK =
  /(smell|smelt|smelling|stink|odou?r|leak|leaking|leakage|gandha|gandh|bass?na|गन्ध|बास्ना|चुहि|लिक)/i;

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

/** Does this explanation already open with something to do right now? */
function leadsWithSafety(explanation: string): boolean {
  const opening = explanation.slice(0, 140).toLowerCase();
  return /(switch off|turn off|don't|do not|open the window|leave the room|step outside|close the (cylinder|valve)|keep everyone away|unplug)/.test(
    opening,
  );
}

/**
 * Force the safety path onto a result when the description warrants it.
 *
 * Returns the result unchanged when there is no hazard, so it is safe to call
 * on everything.
 */
export function applySafetyFloor(
  input: string,
  result: TriageResult,
): { result: TriageResult; hazard: Hazard | null } {
  const hazard = detectHazard(input);
  if (!hazard) return { result, hazard: null };

  const explanation = leadsWithSafety(result.explanation)
    ? result.explanation
    : `${LEAD_LINE[hazard]} ${result.explanation}`;

  return {
    result: { ...result, urgency: "emergency", explanation },
    hazard,
  };
}
