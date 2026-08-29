/**
 * The words people type, mapped to the categories we sell.
 *
 * The interface uses one formal term per trade — प्राविधिक, सिकर्मी काम,
 * किरा नियन्त्रण. Nobody types those. They type मिस्त्री, कालिगड, plumber,
 * धारा, फर्निचर मर्मत, or the English word they saw on a van. A product whose
 * search only matches its own vocabulary is a product that works for the people
 * who wrote it.
 *
 * So this is deliberately a separate layer from the display copy. Renaming a
 * category in `categories` does not narrow what people can find it by, and
 * adding a word people turned out to use does not touch the interface.
 *
 * Two consumers, one table:
 *   - the catalogue search on /services
 *   - the keyword matcher in lib/ai/mockTriage.ts, which is what answers
 *     triage when the API key is missing or the network is gone
 *
 * `categories` is ordered: the first entry is what a single-answer caller
 * (triage) picks. A generalist word like मिस्त्री is genuinely ambiguous — it
 * means a tradesman, and which trade depends on what broke — so it lists
 * several, most-likely first, and search shows all of them.
 */

export type CategoryAlias = {
  /** Lower-cased. Matched with `includes`, so a fragment is fine. */
  term: string;
  /** Most likely first. Triage takes the head; search takes all of them. */
  categories: string[];
};

export const CATEGORY_ALIASES: CategoryAlias[] = [
  // --- generalists: a trade word with no trade attached ------------------
  // मिस्त्री is whoever fixes the thing that broke. Plumbing is both the
  // highest-volume category and the safest default — it is already what an
  // unmatched triage falls back to.
  { term: "मिस्त्री", categories: ["plumbing", "electrical", "carpentry"] },
  { term: "mistri", categories: ["plumbing", "electrical", "carpentry"] },
  { term: "कालिगड", categories: ["carpentry", "plumbing"] },
  { term: "कालिगढ", categories: ["carpentry", "plumbing"] },
  { term: "कारीगर", categories: ["carpentry", "plumbing"] },
  { term: "kaligad", categories: ["carpentry", "plumbing"] },
  { term: "मेकानिक", categories: ["appliance-repair"] },
  { term: "मर्मत", categories: ["appliance-repair", "plumbing", "electrical"] },
  { term: "marmat", categories: ["appliance-repair", "plumbing"] },
  { term: "बनाउने मान्छे", categories: ["plumbing", "carpentry"] },

  // --- plumbing ----------------------------------------------------------
  { term: "plumber", categories: ["plumbing"] },
  { term: "plumbing", categories: ["plumbing"] },
  { term: "प्लम्बर", categories: ["plumbing"] },
  { term: "प्लम्बिङ", categories: ["plumbing"] },
  { term: "धारा", categories: ["plumbing"] },
  { term: "धारा मर्मत", categories: ["plumbing"] },
  { term: "नलकर्मी", categories: ["plumbing"] },
  { term: "पानीको काम", categories: ["plumbing"] },
  { term: "पाइपको काम", categories: ["plumbing"] },
  { term: "dhara", categories: ["plumbing"] },

  // --- electrical --------------------------------------------------------
  { term: "electrician", categories: ["electrical"] },
  { term: "electrical", categories: ["electrical"] },
  { term: "इलेक्ट्रिसियन", categories: ["electrical"] },
  { term: "बिजुली मर्मत", categories: ["electrical"] },
  { term: "बिजुलीको काम", categories: ["electrical"] },
  { term: "लाइनम्यान", categories: ["electrical"] },
  { term: "तारको काम", categories: ["electrical"] },
  { term: "bijuli", categories: ["electrical"] },

  // --- home cleaning -----------------------------------------------------
  { term: "cleaner", categories: ["home-cleaning"] },
  { term: "cleaning", categories: ["home-cleaning"] },
  { term: "housekeeping", categories: ["home-cleaning"] },
  { term: "सरसफाइ", categories: ["home-cleaning"] },
  { term: "सफाइ", categories: ["home-cleaning", "water-tank-cleaning"] },
  { term: "बढारकुँडार", categories: ["home-cleaning"] },
  { term: "safai", categories: ["home-cleaning"] },

  // --- appliance repair --------------------------------------------------
  { term: "appliance", categories: ["appliance-repair"] },
  { term: "technician", categories: ["appliance-repair", "electrical"] },
  { term: "उपकरण मर्मत", categories: ["appliance-repair"] },
  { term: "फ्रिज मर्मत", categories: ["appliance-repair"] },
  { term: "सामान बनाउने", categories: ["appliance-repair"] },

  // --- carpentry ---------------------------------------------------------
  { term: "carpenter", categories: ["carpentry"] },
  { term: "carpentry", categories: ["carpentry"] },
  { term: "सिकर्मी", categories: ["carpentry"] },
  { term: "बढई", categories: ["carpentry"] },
  { term: "फर्निचर", categories: ["carpentry"] },
  { term: "फर्निचर मर्मत", categories: ["carpentry"] },
  { term: "काठको काम", categories: ["carpentry"] },
  { term: "sikarmi", categories: ["carpentry"] },

  // --- pest control ------------------------------------------------------
  { term: "pest control", categories: ["pest-control"] },
  { term: "pest", categories: ["pest-control"] },
  { term: "exterminator", categories: ["pest-control"] },
  { term: "पेस्ट कन्ट्रोल", categories: ["pest-control"] },
  { term: "कीट नियन्त्रण", categories: ["pest-control"] },
  { term: "किरा मार्ने", categories: ["pest-control"] },
  { term: "औषधि छर्ने", categories: ["pest-control"] },

  // --- painting ----------------------------------------------------------
  { term: "painter", categories: ["painting"] },
  { term: "painting", categories: ["painting"] },
  { term: "रङरोगन", categories: ["painting"] },
  { term: "रङ लगाउने", categories: ["painting"] },
  { term: "पुताई", categories: ["painting"] },
  { term: "डिस्टेम्पर", categories: ["painting"] },
  { term: "पेन्टर", categories: ["painting"] },

  // --- AC ----------------------------------------------------------------
  { term: "ac servicing", categories: ["ac-servicing"] },
  { term: "aircon", categories: ["ac-servicing"] },
  { term: "एसी मर्मत", categories: ["ac-servicing"] },
  { term: "एसी सर्भिसिङ", categories: ["ac-servicing"] },

  // --- water tank --------------------------------------------------------
  { term: "tank cleaning", categories: ["water-tank-cleaning"] },
  { term: "ट्यांकी सफाइ", categories: ["water-tank-cleaning"] },
  { term: "पानी ट्यांकी", categories: ["water-tank-cleaning"] },

  // --- movers ------------------------------------------------------------
  { term: "movers", categories: ["movers-packers"] },
  { term: "packers", categories: ["movers-packers"] },
  { term: "shifting", categories: ["movers-packers"] },
  { term: "सामान सार्ने", categories: ["movers-packers"] },
  { term: "ढुवानी", categories: ["movers-packers"] },
  { term: "घर सर्ने", categories: ["movers-packers"] },
];

/**
 * Categories a typed query points at, most relevant first.
 *
 * Longest match wins, the same rule the keyword matcher uses: "फर्निचर मर्मत"
 * has to beat the bare "मर्मत" it contains, or every furniture search lands on
 * appliance repair.
 */
export function matchCategories(query: string): string[] {
  const text = query.toLowerCase().trim();
  if (!text) return [];

  const hits = CATEGORY_ALIASES.filter((alias) =>
    text.includes(alias.term.toLowerCase()),
  ).sort((a, b) => b.term.length - a.term.length);

  const ordered: string[] = [];
  for (const hit of hits) {
    for (const slug of hit.categories) {
      if (!ordered.includes(slug)) ordered.push(slug);
    }
  }
  return ordered;
}
