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
 * `KEYWORD_RULES` is also the source of the price bands quoted to Claude
 * (lib/ai/price-bands.ts). The bands in the prompt are derived from these
 * numbers rather than copied, so the two cannot drift apart.
 */

import type { Locale } from "@/i18n/routing";
import type { TriageCopy } from "@/lib/ai/copy";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";

export type Urgency = "emergency" | "soon" | "routine";

export type TriageResult = {
  /** Category slug — matches SERVICE_CATEGORIES, so it routes directly. */
  category: string;
  urgency: Urgency;
  priceRangeNPR: [number, number];
  explanation: string;
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
};

export const KEYWORD_RULES: KeywordRule[] = [
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
      "ग्यास चुहि",
      "ग्यासको गन्ध",
      "सिलिन्डर चुहि",
      "फुट्यो",
      "पानी पोखि",
      "बाढी",
    ],
    urgency: "emergency",
    priceRangeNPR: [1500, 4500],
    explanationKey: "plumbing-emergency",
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
      "पोलेको गन्ध",
      "जलेको गन्ध",
      "करेन्ट लाग्यो",
      "सर्ट भयो",
    ],
    urgency: "emergency",
    priceRangeNPR: [1500, 4000],
    explanationKey: "electrical-emergency",
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
};

export function triageProblem(input: string, copy: TriageCopy): TriageResult {
  const text = input.toLowerCase().trim();
  const generic = (urgency: Urgency = GENERIC_RULE.urgency): TriageResult => ({
    category: GENERIC_RULE.category,
    urgency,
    priceRangeNPR: GENERIC_RULE.priceRangeNPR,
    explanation: copy.explanations[GENERIC_RULE.explanationKey],
  });

  if (!text) return generic();

  // Longest keyword wins, so "ac not cooling" beats a bare "not working".
  let best: { rule: KeywordRule; score: number } | null = null;

  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (!text.includes(keyword)) continue;
      const score = keyword.length;
      if (!best || score > best.score) best = { rule, score };
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
