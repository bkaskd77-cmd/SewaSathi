/**
 * Does a keyword appear in some text as a word, rather than inside one?
 *
 * SUBSTRING MATCHING IS CORRECT FOR DEVANAGARI AND WRONG FOR LATIN, and that
 * asymmetry is the whole of this module.
 *
 * Devanagari has no usable word boundary for a regex and conjugates by
 * suffixing, which is why every stem list in this product is written as stems
 * — `गन्हाउनु` arrives as गन्हायो, गन्हाउँछ, गन्हाएको. A Devanagari keyword
 * therefore keeps plain `includes` and nothing here changes for it.
 *
 * WHAT WENT WRONG ON THE LATIN SIDE. `tap` matched inside `tapai`, the Nepali
 * for "you", so "pura ghar rangnu paryo rang tapai le lyaune" — a whole-flat
 * repaint — reached a plumber. Nobody would have found that by reading the
 * keyword list; it was found by writing sentences the way somebody in a hurry
 * types them.
 *
 * SO A LATIN KEYWORD MUST START A WORD, AND MAY ONLY BE CONTINUED BY A KNOWN
 * SUFFIX. A trailing boundary on its own would be too strict, because English
 * suffixes too: `repaint` has to keep matching "repainted", `flood` has to
 * keep matching "flooding". `tapai` is `tap` + `ai`, which is not a suffix —
 * and that difference is exactly the rule.
 *
 * LATIN SCRIPT HERE CARRIES TWO LANGUAGES, and the first version of this got
 * that wrong. Allowing only English inflections broke Romanized Nepali, which
 * is written in the same alphabet and inflects nothing like English:
 * "dharama pani aayena" stopped matching `dhara` and "mistrile bhanyo" stopped
 * matching `mistri`, both of which had worked. The postpositions are a closed
 * set too — ko, ma, le, lai, bata, haru — so both lists are carried and a
 * suffix from either is accepted.
 *
 * What is NOT accepted is a suffix from neither, which is the whole of the
 * fix: `tanki` is not `tank` plus anything, it is how somebody spells ट्यांकी
 * in Latin letters. That is a word, and a word people type belongs in
 * `lib/data/synonyms.ts` where both surfaces learn it — not in a suffix list
 * that would have to admit every romanization to catch it.
 *
 * NOT USED BY `lib/ai/safety.ts`, ON PURPOSE. This narrows what matches, and
 * narrowing a hazard detector is the opposite of what that file is for. A
 * safety guard that fires on a word inside another word is a nuisance; one
 * that misses somebody who can smell gas is the failure the guard exists to
 * prevent. Routing is where a wrong match costs something, so routing is where
 * this is applied — the keyword matcher and the catalogue search.
 *
 * Dependency-free and isomorphic, like `foldNepali` beside it: the catalogue
 * search runs in a Server Component and the keyword matcher runs in the
 * browser when the API key is missing.
 */

/** Latin letters and digits. Devanagari is deliberately not here. */
function isLatinWordChar(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
}

/**
 * What may follow a keyword and still be the same word.
 *
 * The empty string is first so an exact match is tried before any suffix.
 * English inflections, then the Nepali postpositions that bind to a Latin stem
 * when somebody writes them closed up — "dharama", "mistrile", "gharbata".
 * CLAUDE.md notes that a postposition takes a space after Latin text, which is
 * how WE write them; it is not how everybody types them.
 */
const SUFFIXES = [
  "",
  // English
  "s",
  "es",
  "ed",
  "d",
  "ing",
  "er",
  "ers",
  // Romanized Nepali postpositions
  "ko",
  "ka",
  "ki",
  "ma",
  "mai",
  "le",
  "lai",
  "bata",
  "dekhi",
  "haru",
  "sanga",
];

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Both arguments are expected lower-cased and already folded by `foldNepali`.
 *
 * A keyword containing ANY Devanagari is treated as Devanagari throughout —
 * mixed terms like `एसी servicing` are rare and the conservative reading (plain
 * `includes`) is the one that cannot lose a match.
 */
export function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword) return false;
  if (DEVANAGARI.test(keyword)) return text.includes(keyword);

  let from = 0;
  for (;;) {
    const at = text.indexOf(keyword, from);
    if (at === -1) return false;
    from = at + 1;

    // Must start a word: `ac` inside `machine` is not a mention of an AC.
    if (at > 0 && isLatinWordChar(text[at - 1])) continue;

    const end = at + keyword.length;
    for (const suffix of SUFFIXES) {
      if (suffix && !text.startsWith(suffix, end)) continue;
      const after = end + suffix.length;
      if (after >= text.length || !isLatinWordChar(text[after])) return true;
    }
  }
}
