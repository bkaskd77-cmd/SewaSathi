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

/*
 * ---------------------------------------------------------------------------
 * How this matcher is built, and why it is built this way
 * ---------------------------------------------------------------------------
 *
 * Twice the Nepali path broke silently. First the keyword rules were
 * Latin-only. Then this file matched the noun `गन्ध` but not the verb
 * `गन्हाउनु` — so "ग्यास गन्हाइरहेको छ", which is how somebody actually says
 * it, went down the calm path. Both were invisible in review and both were
 * found by a test.
 *
 * The cause was the same each time: matching dictionary words. Nepali
 * conjugates by suffixing, so one verb is a dozen surface forms —
 * गन्हायो, गन्हाउँछ, गन्हाइरहेको छ, गन्हाएको, गन्हाउन थाल्यो. A word list
 * misses all but the one somebody happened to think of.
 *
 * So: MATCH STEMS, NOT WORDS. `गन्हा` catches every form above. Devanagari has
 * no usable word boundary for a regex anyway, which makes stem matching both
 * the correct approach and the natural one. Every list below is stems, and
 * each is annotated with the forms it is meant to cover.
 *
 * Romanized Nepali has no spelling standard at all — the same word arrives as
 * gandha / gandh / ganha / ganhayo — so those lists are deliberately loose.
 *
 * The trade is stated once and holds throughout: a false positive costs one
 * unnecessary safety sentence. A false negative costs something we are not
 * willing to pay. When in doubt, match.
 */

/** Joins stems into an alternation. Nothing here needs escaping today. */
function anyOf(...stems: string[]): RegExp {
  return new RegExp(`(${stems.join("|")})`, "i");
}

// Smelling something. Devanagari stems cover the whole conjugation:
//   गन्हा  -> गन्हायो, गन्हाउँछ, गन्हाइरहेको, गन्हाएको, गन्हाउन
//   गनाउ  -> गनायो, गनाउँछ, गनाइरहेको   (the eastern/colloquial form)
//   बास्न  -> बास्ना, बास्न आयो
const SMELL = anyOf(
  "smell", "smelt", "smelling", "stink", "stinking", "odou?r", "fumes",
  "gandha", "gandh", "ganha", "ganau", "gana+yo", "basna", "bassna",
  "गन्ध", "गन्हा", "गन्धा", "गनाउ", "गनाइ", "गनाय", "बास्न", "वास्न",
);

// Leaking or escaping. Stems:
//   चुहि -> चुहियो, चुहिरहेको, चुहिएको     चुहे -> चुहेको
//   पोखि -> पोखियो (spilling)             निस्कि -> निस्किरहेको (escaping)
const LEAK = anyOf(
  "leak", "leaking", "leakage", "leaked", "escaping",
  "chuhi", "chuhe", "chuha", "pokhi", "niski",
  "चुहि", "चुहे", "चुहा", "चुहाव", "पोखि", "निस्कि", "निस्के",
  "लिक", "लीक",
);

// The substance. `ग्याँस` with the chandrabindu is at least as common as
// `ग्यास` when typed on a phone, and missing it was a silent gap.
const GAS = anyOf(
  "\\bgas\\b", "\\bgais\\b", "\\bgyas\\b", "lpg", "cylinder", "silinder",
  "ग्यास", "ग्याँस", "ग्यास्", "सिलिन्डर", "सिलिण्डर", "एलपीजी",
);

/*
 * An AC gas top-up is a service we sell, not a hazard, and it is the single
 * most likely false positive in the product. `ग्यास भर्नु` — to refill gas —
 * is the Nepali phrasing and belongs here too, or "एसीमा ग्यास भर्नुपर्‍यो"
 * gets the LPG script, which is wrong advice for the wrong appliance.
 *
 * A genuine refrigerant leak still reaches Claude and is treated on its
 * merits. It simply does not get told to open a window and leave the room.
 */
const AC_CONTEXT = anyOf(
  "\\bac\\b", "a/c", "air ?con", "air conditioner", "refill", "recharge",
  "fridge", "refrigerator", "freezer",
  "एसी", "ए\\.सी", "एयर ?कन", "ग्यास भर", "ग्याँस भर", "रिफिल", "फ्रिज",
);

// Fire, smoke, scorching. Stems:
//   पोल -> पोल्यो, पोलेको, पोलिरहेको      जल -> जल्यो, जलेको, जलिरहेको
//   डढ  -> डढ्यो, डढेको                   बलिरह/बलेको (alight — bare बल is
//   "strength" and far too broad to include on its own)
// `धुवा` without the chandrabindu is how it is usually typed.
const BURNING = anyOf(
  "burn", "burnt", "burned", "burning", "smoke", "smoking", "smould",
  "scorch", "singe", "spark", "sparking", "sparks", "flame", "flames",
  "\\bfire\\b", "short.?circuit",
  "poleko", "polyo", "jaleko", "jalyo", "dadheko", "dhuwa", "dhuwaa",
  "aago", "aagalagi", "aagolagyo", "sort ?circuit",
  "पोल", "जल्", "जले", "जलि", "डढ", "बलिरह", "बलेको", "आगो", "आगलागी",
  "धुवाँ", "धुवा", "धुँवा", "ज्वाला", "स्पार्क", "झिल्का", "सर्ट सर्किट",
  "सर्किट",
);

/*
 * "Burning" alone is a burning question or burnt rice. Pair it with something
 * that belongs to an electrical fire or a house fire before escalating.
 */
const BURNING_CONTEXT = anyOf(
  "smell", "smoke", "wire", "wiring", "switch", "socket", "board", "plug",
  "fuse", "mcb", "meter", "plastic", "rubber", "panel", "cable", "heater",
  "tar\\b", "waayar", "wayar", "switch", "socket",
  "तार", "वायर", "स्विच", "स्वीच", "सकेट", "सोकेट", "बोर्ड", "प्लग",
  "फ्युज", "मिटर", "प्लास्टिक", "रबर", "बत्ती", "हिटर", "केबल", "गन्ध",
  "गन्हा", "धुवा", "धुवाँ",
);

/*
 * A wire somebody could touch. These fire on their own — there is no innocent
 * reading of "नाङ्गो तार".
 */
const BARE_WIRE = anyOf(
  "live wire", "bare wire", "exposed wire", "open wire", "naked wire",
  "nango tar", "khula tar", "tar nango",
  "नाङ्गो तार", "नांगो तार", "खुला तार", "तार खुल", "तार नाङ्गो",
  "तार चुँडि", "तार झुण्डि", "तार झुन्डि",
);

/*
 * Being shocked. This one MUST be paired with the "struck" verb.
 *
 * Bare `करेन्ट` was a false positive waiting to happen: "करेन्ट आएको छैन"
 * means the power is out — the single most ordinary complaint there is — and
 * it would have been escalated to an emergency about live wiring.
 *
 * Stems: लाग -> लाग्यो, लागेको, लागिरहेको. झट्का is the word people actually
 * use for a shock, far more than "करेन्ट".
 */
const SHOCK_SOURCE = anyOf(
  "current", "karent", "kurrent", "bijuli", "bijulee", "jhatka", "jhatkaa",
  "shock", "electric",
  "करेन्ट", "करेण्ट", "कर्रेन्ट", "बिजुली", "विजुली", "झट्का", "झड्का", "शक",
);
const SHOCK_VERB = anyOf(
  "shock", "electrocut", "lag", "lagyo", "laagyo", "lageko", "hit", "struck",
  "लाग", "लागे", "लाग्", "छो", "पस",
);

/**
 * The hazard a description points at, or null.
 *
 * Order is worst-first and the first match wins: a live wire outranks a smell,
 * because the action it asks for is the more urgent one.
 */
export function detectHazard(input: string): Hazard | null {
  const text = input.toLowerCase();
  if (!text.trim()) return null;

  if (BARE_WIRE.test(text)) return "live-wire";
  if (SHOCK_SOURCE.test(text) && SHOCK_VERB.test(text)) return "live-wire";

  if (GAS.test(text) && !AC_CONTEXT.test(text)) {
    if (SMELL.test(text) || LEAK.test(text)) return "gas";
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
