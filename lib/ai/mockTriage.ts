/**
 * The keyword matcher. No longer the product — the fallback underneath it.
 *
 * Phase 4 moved real triage to Claude (lib/ai/triage.ts calls /api/triage).
 * This file stayed, because the user must always get an answer: when the API
 * key is missing, the call times out, the model returns something that fails
 * validation, or the rate limit bites, `triageProblem` here is what answers.
 * It returns the same `TriageResult`, so nothing downstream can tell.
 *
 * It is deliberately generous about phrasing because people describe these
 * problems in whatever words they have: "no water", "dhara chaina", "tap not
 * coming", "पानी आएन".
 *
 * Devanagari is in the lists for a reason that only became true with the
 * Nepali locale: this is what answers when the API key is missing or the
 * network is gone, and a Nepali reader whose every description fell through to
 * the generic result would have had a fallback in name only. `includes` on a
 * lower-cased string works unchanged — Devanagari has no case.
 *
 * The trade words people type — मिस्त्री, कालिगड, plumber, धारा — are not in
 * the lists below. They live in lib/data/synonyms.ts, shared with the catalogue
 * search, and are folded in as rules further down. A word somebody turned out
 * to use gets added in one place and both surfaces learn it.
 */

import type { Locale } from "@/i18n/routing";
import type { TriageCopy } from "@/lib/ai/copy";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import { CATEGORY_ALIASES } from "@/lib/data/synonyms";
import { containsKeyword, foldNepali } from "@/lib/text";

export type Urgency = "emergency" | "soon" | "routine";

export type TriageResult = {
  /** Category slug — matches SERVICE_CATEGORIES, so it routes directly. */
  category: string;
  urgency: Urgency;
  priceRangeNPR: [number, number];
  explanation: string;
  /**
   * WHICH PRODUCT INSIDE THE TRADE, when that can be told. Null when it cannot.
   *
   * The fifth key, and the first widening of this contract since Phase 2. It
   * carries a `category_price_bands` slug, which is where the researched price
   * AND the researched duration both live — so naming the product is what lets
   * a booking know how long it will take without anybody inventing a number.
   *
   * NULL IS A REAL ANSWER AND THE COMMON ONE HERE. "I need a painter" does not
   * say whether that is a touch-up or a whole flat, and guessing would file the
   * booking under the wrong product in every signal that later reads it. The
   * matcher below manages it for two rules out of fourteen; the model, which
   * is handed the labelled list and reads the whole sentence, is the path this
   * is actually expected to come from — and `triage_logs` records which, so
   * whether that is true stops being an assumption.
   */
  band: string | null;
};

export type KeywordRule = {
  category: string;
  keywords: string[];
  urgency: Urgency;
  priceRangeNPR: [number, number];
  /**
   * Key into the `fallback` namespace of the message catalogue.
   *
   * The sentence itself is not stored here because this path answers in
   * whatever language the person is reading — an English explanation is not a
   * fallback for a Nepali reader, it is a second failure.
   */
  explanationKey: string;
  /**
   * The one product this rule can only mean, or null.
   *
   * TWELVE OF THE FOURTEEN RULES BELOW ARE NULL, and that is the honest shape
   * of a keyword matcher: it recognises a TRADE from one word reliably, and a
   * PRODUCT hardly ever. Naming the product needs the sentence, which is what
   * the model reads and this file cannot.
   *
   * IT STARTED AT NINE AND AN AUDIT MOVED IT TO TWELVE. Three bands were set
   * by reading a rule's name and its English keywords, and every one was wrong
   * once the Romanized and Devanagari terms underneath were read too — see the
   * comments on each. The lesson is in `tests/unit/triage-band.test.ts`, which
   * now runs real phrasings through this matcher and fails if any rule names a
   * product its own keywords could contradict.
   *
   * A WRONG PRODUCT IS WORSE THAN NONE, in both directions that matter: it
   * books the wrong span out of somebody's week, and it files the booking
   * under the wrong product in `category_pricing_signals` — the signal that
   * exists to find our own mispricing. Null is recoverable. A confident wrong
   * answer is a measurement nobody knows is false.
   */
  band: string | null;
};

const PROBLEM_RULES: KeywordRule[] = [
  {
    category: "plumbing",
    keywords: [
      "gas leak",
      "gas smell",
      "smell of gas",
      "burst",
      "flooding",
      "flood",
      "water everywhere",
      "overflowing",
      // Stems, not whole phrases. Nepali conjugates, so "ग्यासको गन्ध" does
      // not match "ग्यास गन्हायो" — the same trap that broke lib/ai/safety.ts
      // twice. See the note at the top of that file.
      "ग्यास चुहि",
      "ग्याँस चुहि",
      "ग्यासको गन्ध",
      "ग्यास गन्हा",
      "ग्याँस गन्हा",
      "ग्यास लिक",
      "ग्याँस लिक",
      "ग्यास निस्कि",
      "सिलिन्डर चुहि",
      "सिलिन्डर गन्हा",
      "फुट्यो",
      "पानी पोखि",
      "बाढी",
    ],
    urgency: "emergency",
    priceRangeNPR: [1500, 4500],
    explanationKey: "plumbing-emergency",
    /*
     * NO BAND, AND THE FIRST VERSION OF THIS FILE SAID `burst`. Read the
     * keyword list above rather than the rule's name: half of it is a GAS
     * LEAK — "ग्यास चुहि", "सिलिन्डर चुहि", "gas smell". A gas leak is not
     * "Burst pipe or flooding", and filing it as one would put every gas
     * report into the wrong product in `category_pricing_signals`.
     */
    band: null,
  },
  {
    category: "plumbing",
    keywords: [
      "leak",
      "leaking",
      "dripping",
      "drip",
      "tap",
      "faucet",
      "pipe",
      "water coming",
      "चुहि",
      "चुहावट",
      "धारा चुहि",
      "टपक",
      "पाइप",
    ],
    urgency: "soon",
    priceRangeNPR: [900, 2200],
    explanationKey: "plumbing-leak",
    // Spans a tap washer and a pipe run — `leak` and `pipe-work` are different products.
    band: null,
  },
  {
    category: "plumbing",
    keywords: [
      "blocked",
      "block",
      "clog",
      "clogged",
      "drain",
      "sink not draining",
      "toilet",
      "commode",
      "sewage",
      "bathroom smell",
      "जाम भयो",
      "जाम",
      "ढल",
      "कमोड",
      "शौचालय",
      "बेसिन",
    ],
    urgency: "soon",
    priceRangeNPR: [1200, 3000],
    explanationKey: "plumbing-blockage",
    // Blocked drain or commode. One product.
    band: "blockage",
  },
  {
    category: "plumbing",
    keywords: [
      "no water",
      "water not coming",
      "dhara",
      "motor not working",
      "pump",
      "पानी आएन",
      "पानी आएको छैन",
      "धारा आएन",
      "मोटर चलेन",
      "पम्प",
      "pani aayena",
    ],
    urgency: "soon",
    priceRangeNPR: [1000, 2800],
    explanationKey: "plumbing-water",
    /*
     * NO BAND, AND THIS ONE WAS CAUGHT BY A REAL SENTENCE. The list above
     * contains the bare "dhara", which just means TAP — so "bathroom ko
     * dhara chuhiyo", a dripping tap, matched here and was filed as "No
     * water, pump or airlock". Confidently wrong, and twice the length.
     */
    band: null,
  },
  {
    category: "electrical",
    keywords: [
      "short circuit",
      "shortcircuit",
      "sparking",
      "spark",
      "burning smell",
      "smoke",
      "shock",
      "electric shock",
      "आगो",
      "धुवाँ",
      "स्पार्क",
      // Stems again: लाग- covers लाग्यो, लागेको, लागिरहेको; पोल- covers
      // पोलेको, पोल्यो, पोलिरहेको.
      "पोलेको",
      "जलेको",
      "डढेको",
      "धुवा",
      "करेन्ट लाग",
      "बिजुली लाग",
      "झट्का लाग",
      "नाङ्गो तार",
      "तार खुल",
      "सर्ट भयो",
      "सर्ट सर्किट",
    ],
    urgency: "emergency",
    priceRangeNPR: [1500, 4000],
    explanationKey: "electrical-emergency",
    // Short circuit, sparking or burning smell. One product.
    band: "fault",
  },
  {
    category: "electrical",
    keywords: [
      "power cut",
      "no power",
      "no light",
      "light not working",
      "bulb",
      "switch",
      "socket",
      "plug point",
      "wiring",
      "mcb",
      "fuse",
      "tripping",
      "inverter",
      "battery",
      "बत्ती गयो",
      "बत्ती गएन",
      "बत्ती बलेन",
      "बिजुली गयो",
      "स्विच",
      "सकेट",
      "एमसीबी",
      "फ्युज",
      "इन्भर्टर",
      "वायरिङ",
      "batti gayo",
    ],
    urgency: "soon",
    priceRangeNPR: [800, 2500],
    explanationKey: "electrical-fault",
    // A dead light could be a switch, an MCB, a new point or a rewire.
    band: null,
  },
  {
    category: "ac-servicing",
    keywords: [
      "ac not cooling",
      "ac",
      "air con",
      "aircon",
      "air conditioner",
      "cooling",
      "gas refill",
      "gas top",
      "एसी",
      "चिसो भएन",
      "चिसो दिएन",
      "ग्यास भर्न",
    ],
    urgency: "soon",
    priceRangeNPR: [1800, 5500],
    explanationKey: "ac-cooling",
    // "Not cooling" is a service, a gas refill or a repair — 1,200 to 7,500 apart.
    band: null,
  },
  {
    category: "appliance-repair",
    keywords: [
      "fridge",
      "refrigerator",
      "washing machine",
      "washer",
      "geyser",
      "water heater",
      "microwave",
      "oven",
      "tv",
      "not working",
      "not starting",
      "appliance",
      "फ्रिज",
      "वासिङ मेसिन",
      "गिजर",
      "माइक्रोवेभ",
      "टिभी",
      "बिग्रियो",
      "चलेको छैन",
    ],
    urgency: "soon",
    priceRangeNPR: [1200, 4000],
    explanationKey: "appliance",
    /*
     * NO BAND. "not working", "बिग्रियो" and "चलेको छैन" are in this list
     * and say nothing about whether it is a diagnosis, a labour-only repair
     * or a compressor — 500 to 5,000 apart. "geyser" is in it too, and that
     * is a PLUMBING product as well as an appliance one.
     */
    band: null,
  },
  {
    category: "pest-control",
    keywords: [
      "cockroach",
      "cockroaches",
      "termite",
      "termites",
      "bed bug",
      "bedbug",
      "rats",
      "rat",
      "mice",
      "mosquito",
      "ants",
      "pest",
      "insects",
      "साङ्लो",
      "धमिरा",
      "उडुस",
      "मुसा",
      "लामखुट्टे",
      "कमिला",
      "किरा",
    ],
    urgency: "soon",
    priceRangeNPR: [2000, 6000],
    explanationKey: "pest",
    // Cockroaches, bed bugs and termites are three treatments.
    band: null,
  },
  {
    category: "home-cleaning",
    keywords: [
      "clean",
      "cleaning",
      "deep clean",
      "dusty",
      "mess",
      "after party",
      "moving out",
      "kitchen clean",
      "bathroom clean",
      "sofa",
      "सरसफाइ",
      "घर सफा",
      "सफाइ",
      "सफा गर्न",
      "धुलो",
      "ghar safa",
    ],
    urgency: "routine",
    priceRangeNPR: [1500, 5000],
    explanationKey: "cleaning",
    // One room and a whole-flat deep clean differ by six hours.
    band: null,
  },
  {
    category: "carpentry",
    keywords: [
      "door",
      "furniture",
      "cupboard",
      "almirah",
      "wardrobe",
      "hinge",
      "drawer",
      "shelf",
      "wood",
      "carpenter",
      "lock",
      "window",
      "ढोका",
      "दराज",
      "कब्जा",
      "फर्निचर",
      "सिकर्मी",
      "ताल्चा",
      "झ्याल",
    ],
    urgency: "routine",
    priceRangeNPR: [1000, 3500],
    explanationKey: "carpentry",
    // A hinge and a built-in cupboard are two days apart.
    band: null,
  },
  {
    category: "painting",
    keywords: [
      "paint",
      "painting",
      "repaint",
      "touch up",
      "touch-up",
      "wall",
      "damp patch",
      "peeling",
      "whitewash",
      "रङरोगन",
      "रङ लगाउन",
      "पेन्ट",
      "भित्ता",
      "ओसिलो",
    ],
    urgency: "routine",
    priceRangeNPR: [4000, 25000],
    explanationKey: "painting",
    // THE CASE THAT MATTERS AND THE MATCHER CANNOT CALL IT. Touch-up to
    // whole flat is one day to seven, and the word "painting" says nothing
    // about which. This is exactly why the model names the band and this
    // file does not guess.
    band: null,
  },
  {
    category: "water-tank-cleaning",
    keywords: [
      "tank",
      "water tank",
      "sump",
      "overhead",
      "dirty water",
      "smelly water",
      "algae",
      "ट्यांकी",
      "ट्यांकी सफा",
      "पानी गन्हा",
      "सम्प",
    ],
    urgency: "routine",
    priceRangeNPR: [1500, 4000],
    explanationKey: "tank",
    // Overhead, underground and combined are different tanks.
    band: null,
  },
  {
    category: "movers-packers",
    keywords: [
      "shift",
      "shifting",
      "move",
      "moving",
      "movers",
      "packers",
      "relocate",
      "transport",
      "new flat",
      "सामान सार्न",
      "घर सर्न",
      "प्याकिङ",
      "सिफ्ट",
    ],
    urgency: "routine",
    priceRangeNPR: [5000, 20000],
    explanationKey: "movers",
    // A survey trade has no sub-bands at all.
    band: null,
  },
];

/** Words that push an otherwise ordinary job to the front of the queue. */
const URGENT_MARKERS = [
  "urgent",
  "emergency",
  "immediately",
  "right now",
  "asap",
  "today",
  "tonight",
  "now",
  "quickly",
  "अहिल्यै",
  "तुरुन्त",
  "आजै",
  "हतार",
  "छिटो",
  "abhi",
  "aaja",
  "turunta",
];

/**
 * The answer when nothing else fits.
 *
 * Also quoted to Claude as the "nothing fits" result, so a request we do not
 * cover comes back as this rather than as an invented category the router
 * cannot resolve.
 */
export const GENERIC_RULE = {
  category: "plumbing",
  urgency: "soon" as Urgency,
  priceRangeNPR: [900, 4000] as [number, number],
  explanationKey: "generic",
  // Nothing matched, so nothing is known about which product this is.
  band: null,
};

/**
 * The rule a trade word points at.
 *
 * An alias names a *trade*, not a problem — "मिस्त्री" says who you want, not
 * what broke. So it borrows the pricing and wording of that category's ordinary
 * rule, never its emergency one: somebody typing "plumber" has not told us
 * anything is on fire, and answering as though they had would be a lie in the
 * one direction this product must not lie.
 */
function defaultRuleFor(category: string): KeywordRule | undefined {
  return PROBLEM_RULES.find(
    (rule) => rule.category === category && rule.urgency !== "emergency",
  );
}

/**
 * Trade words folded in as rules of their own.
 *
 * Doing it here rather than as a second lookup means the existing
 * longest-match-wins scan handles them with no new branching — and it is what
 * makes "फर्निचर मर्मत" resolve to carpentry rather than to the bare "मर्मत"
 * it contains.
 */
const ALIAS_RULES: KeywordRule[] = CATEGORY_ALIASES.flatMap((alias) => {
  const base = defaultRuleFor(alias.categories[0]);
  return base
    ? [
        {
          ...base,
          keywords: [alias.term.toLowerCase()],
          /*
           * AND IT DROPS THE BAND, for the same reason it borrows the ordinary
           * rule rather than the emergency one. "मिस्त्री" says who you want,
           * not what broke — so it cannot name a product, and inheriting the
           * base rule's would file every alias booking under whichever product
           * that rule happened to mean.
           */
          band: null,
        },
      ]
    : [];
});

export const KEYWORD_RULES: KeywordRule[] = [...PROBLEM_RULES, ...ALIAS_RULES];

/**
 * Words that describe a STATE, not a thing.
 *
 * WHY THIS EXISTS. Ranking was `score = keyword.length`, and length is not
 * specificity. `बिग्रियो` ("broke", 8 characters) outranked `स्विच` ("switch",
 * 5), so a broken switch reached an appliance technician; `ढोका` ("door", 4)
 * lost the same way; and `cooling` (7) outranked `fridge` (6), so a warm fridge
 * reached an AC technician. Three misroutes, one cause.
 *
 * THE RULE IS THAT AN OBJECT BEATS A SYMPTOM, whatever the length. The object
 * says which trade; the symptom says only that something is wrong, and nearly
 * every trade has a way of being wrong. Within a kind, longest still wins, so
 * "ac not cooling" still beats a bare "ac".
 *
 * It is a short list on purpose. A word goes in here only when it names no
 * object and belongs to no trade on its own — `leak` stays out, because a leak
 * is a symptom but it is unmistakably plumbing's. A test asserts every entry
 * is a keyword some rule actually uses, so this cannot drift away from the
 * lists above.
 */
export const GENERIC_SYMPTOMS = new Set(
  [
    "not working",
    "not starting",
    "बिग्रियो",
    "चलेको छैन",
    // Bare `cooling` says a thing is warm. `ac not cooling` names the object
    // and is its own keyword, so demoting this costs nothing.
    "cooling",
    "चिसो भएन",
    "चिसो दिएन",
  ].map((word) => foldNepali(word)),
);

export function triageProblem(input: string, copy: TriageCopy): TriageResult {
  // Folded, like the safety guard and the catalogue search. The keywords are
  // folded beside it below, so a list authored with `ट्याङ्की` still matches
  // somebody who typed `ट्यांकी`. See lib/text/nepali.ts.
  const text = foldNepali(input.toLowerCase().trim());
  const generic = (urgency: Urgency = GENERIC_RULE.urgency): TriageResult => ({
    category: GENERIC_RULE.category,
    urgency,
    priceRangeNPR: GENERIC_RULE.priceRangeNPR,
    explanation: copy.explanations[GENERIC_RULE.explanationKey],
    band: GENERIC_RULE.band,
  });

  if (!text) return generic();

  /*
   * AN OBJECT BEATS A SYMPTOM; WITHIN A KIND, LONGEST WINS.
   *
   * The second half is the original rule and still does the work — "ac not
   * cooling" beats a bare "ac". The first half is what stops `बिग्रियो`
   * outranking `स्विच`: length measures how much of the sentence a keyword
   * accounts for, which is a decent proxy for confidence and a bad one for
   * specificity. See GENERIC_SYMPTOMS.
   */
  let best: { rule: KeywordRule; specific: boolean; score: number } | null =
    null;

  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      const folded = foldNepali(keyword);
      if (!containsKeyword(text, folded)) continue;
      // Scored on the FOLDED length so two spellings of one keyword cannot
      // outrank each other by a character.
      const score = folded.length;
      const specific = !GENERIC_SYMPTOMS.has(folded);
      if (
        !best ||
        (specific && !best.specific) ||
        (specific === best.specific && score > best.score)
      ) {
        best = { rule, specific, score };
      }
    }
  }

  const isUrgent = URGENT_MARKERS.some((marker) => text.includes(marker));

  if (!best) return generic(isUrgent ? "emergency" : GENERIC_RULE.urgency);

  const { rule } = best;

  return {
    category: rule.category,
    // An explicit "right now" upgrades urgency but never downgrades it.
    urgency:
      isUrgent && rule.urgency !== "emergency" ? "emergency" : rule.urgency,
    priceRangeNPR: rule.priceRangeNPR,
    explanation: copy.explanations[rule.explanationKey],
    band: rule.band,
  };
}

/** Display name for a category slug, for rendering triage results. */
export function categoryName(
  slug: string,
  locale: Locale,
  fallback: string,
): string {
  const category = SERVICE_CATEGORIES.find((c) => c.slug === slug);
  return category ? categoryCopy(category, locale).name : fallback;
}

/**
 * Short lower-case label for inline sentences. Never derive this by
 * lower-casing `name` — "AC Servicing & Gas Refill" becomes "ac servicing &
 * gas refill", which breaks the acronym and overflows the button.
 */
export function categoryCtaLabel(
  slug: string,
  locale: Locale,
  fallback: string,
): string {
  const category = SERVICE_CATEGORIES.find((c) => c.slug === slug);
  return category ? categoryCopy(category, locale).ctaLabel : fallback;
}
