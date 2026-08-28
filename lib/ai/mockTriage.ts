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
 * coming".
 *
 * `KEYWORD_RULES` is also the source of the price bands quoted to Claude
 * (lib/ai/price-bands.ts). The bands in the prompt are derived from these
 * numbers rather than copied, so the two cannot drift apart.
 */

import { SERVICE_CATEGORIES } from "@/lib/config/services";

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
  explanation: string;
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
    ],
    urgency: "emergency",
    priceRangeNPR: [1500, 4500],
    explanation:
      "This can cause damage fast, so we'll push you to the front of the queue and send whoever is closest.",
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
    ],
    urgency: "soon",
    priceRangeNPR: [900, 2200],
    explanation:
      "Most leaks are a washer or a joint — usually a single visit, and the plumber will carry the parts.",
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
    ],
    urgency: "soon",
    priceRangeNPR: [1200, 3000],
    explanation:
      "Blockages get worse if you keep using the fixture. A plumber will clear it and check what caused it.",
  },
  {
    category: "plumbing",
    keywords: [
      "no water",
      "water not coming",
      "dhara",
      "motor not working",
      "pump",
    ],
    urgency: "soon",
    priceRangeNPR: [1000, 2800],
    explanation:
      "Usually the pump, the inlet valve or an airlock. The plumber will trace it back from the tank.",
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
    ],
    urgency: "emergency",
    priceRangeNPR: [1500, 4000],
    explanation:
      "Treat this as urgent — switch off at the mains if you safely can. We'll dispatch the nearest electrician.",
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
    ],
    urgency: "soon",
    priceRangeNPR: [800, 2500],
    explanation:
      "An electrician will find whether it's the circuit, the fitting or the supply before quoting anything larger.",
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
    ],
    urgency: "soon",
    priceRangeNPR: [1800, 5500],
    explanation:
      "Weak cooling is usually a dirty filter or low gas. Servicing is cheaper; a refill costs more.",
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
    ],
    urgency: "soon",
    priceRangeNPR: [1200, 4000],
    explanation:
      "The technician diagnoses on site and tells you the part cost before doing any work.",
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
    ],
    urgency: "soon",
    priceRangeNPR: [2000, 6000],
    explanation:
      "Priced by the size of the flat and the treatment. Most jobs need one visit plus a follow-up.",
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
    ],
    urgency: "routine",
    priceRangeNPR: [1500, 5000],
    explanation:
      "Cleaning is booked by hours and flat size, so you'll see the exact price before confirming.",
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
    ],
    urgency: "routine",
    priceRangeNPR: [1000, 3500],
    explanation:
      "A carpenter will look at whether it's a repair or a replacement, and price the two separately.",
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
    ],
    urgency: "routine",
    priceRangeNPR: [4000, 25000],
    explanation:
      "Painting is quoted per square foot after a site visit — the range is wide until someone measures.",
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
    ],
    urgency: "routine",
    priceRangeNPR: [1500, 4000],
    explanation:
      "Tanks are priced by capacity. Most households do this twice a year.",
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
    ],
    urgency: "routine",
    priceRangeNPR: [5000, 20000],
    explanation:
      "Quoted on distance, floor level and how much you're moving — a survey call settles it in minutes.",
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
];

/**
 * The answer when nothing else fits.
 *
 * Also quoted to Claude as the "nothing fits" result, so a request we do not
 * cover comes back as this rather than as an invented category the router
 * cannot resolve.
 */
export const GENERIC_RESULT: TriageResult = {
  category: "plumbing",
  urgency: "soon",
  priceRangeNPR: [900, 4000],
  explanation:
    "We'll match you with the right professional — tell them the details and they'll confirm the price before starting.",
};

export function triageProblem(input: string): TriageResult {
  const text = input.toLowerCase().trim();

  if (!text) return GENERIC_RESULT;

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

  if (!best) {
    return isUrgent
      ? { ...GENERIC_RESULT, urgency: "emergency" }
      : GENERIC_RESULT;
  }

  const { rule } = best;

  return {
    category: rule.category,
    // An explicit "right now" upgrades urgency but never downgrades it.
    urgency:
      isUrgent && rule.urgency !== "emergency" ? "emergency" : rule.urgency,
    priceRangeNPR: rule.priceRangeNPR,
    explanation: rule.explanation,
  };
}

/** Display name for a category slug, for rendering triage results. */
export function categoryName(slug: string): string {
  return SERVICE_CATEGORIES.find((c) => c.slug === slug)?.name ?? "Home repair";
}

/**
 * Short lower-case label for inline sentences. Never derive this by
 * lower-casing `name` — "AC Servicing & Gas Refill" becomes "ac servicing &
 * gas refill", which breaks the acronym and overflows the button.
 */
export function categoryCtaLabel(slug: string): string {
  return (
    SERVICE_CATEGORIES.find((c) => c.slug === slug)?.ctaLabel ?? "home repair"
  );
}
