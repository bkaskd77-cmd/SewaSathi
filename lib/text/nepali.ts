/**
 * One spelling, so a stem written one way still matches a person who types the
 * other.
 *
 * WHAT WENT WRONG. Nepali writes a nasal before a consonant in two ways, and
 * both are ordinary: as an anusvara — `गंध`, `सिलिंडर`, `करेंट` — or as the
 * nasal consonant plus a virama — `गन्ध`, `सिलिन्डर`, `करेन्ट`. Every
 * Devanagari stem in `lib/ai/safety.ts` was authored in the second form. So a
 * person standing in a kitchen that smells of gas, who happened to type the
 * first, **was not detected at all**. Eighteen safety stems were in that state
 * and exactly one anusvara variant existed — `नांगो तार`, sitting beside
 * `नाङ्गो तार`, which is somebody having hit this once and patched that single
 * case by hand.
 *
 * Patching cases by hand does not converge. There are two spellings of every
 * one of these words and the list only ever grows.
 *
 * THIS IS NOT A WIDENING, AND THE DISTINCTION IS THE WHOLE DESIGN. It makes an
 * existing stem match the spellings that stem already means. It does not make
 * it match anything else. CLAUDE.md's rule is to match stems rather than words
 * because Nepali conjugates by suffixing; this is the same lesson one level
 * down — Nepali also *spells* one sound two ways.
 *
 * Applied to the INPUT and the STEMS alike, so neither side has to be authored
 * in a particular spelling and nobody has to remember which.
 *
 * Dependency-free and isomorphic: the catalogue search runs in a Server
 * Component, the safety guard runs on the server, and the keyword matcher runs
 * in the browser when the API key is missing.
 */

/**
 * Nasal consonant + virama, where a consonant follows.
 *
 * `ङ ञ ण न म` are the five nasals that take this form. The lookahead matters:
 * a virama at the end of a word is a half-form rather than a nasalised vowel,
 * and folding it would change what the word is rather than how it is spelt.
 * `[क-ह]` is the consonant block, U+0915 to U+0939.
 */
// `g` without `u`: the tsconfig target predates the unicode flag, and every
// codepoint here is in the Devanagari BMP block, so the two behave identically.
const NASAL_CONJUNCT = /[ङञणनम]्(?=[क-ह])/g;

/** Anusvara — the other way of writing the same sound. */
const ANUSVARA = "ं";

/**
 * Fold the spellings of one sound together.
 *
 * `ट्याङ्की` and `ट्यांकी` both become `ट्यांकी`. `गन्ध` and `गंध` both become
 * `गंध`. Latin and English text passes through untouched, so a mixed sentence
 * — which is most of them — is unaffected in its Latin half.
 *
 * WHAT IS DELIBERATELY NOT FOLDED. `श`/`ष`/`स`, `व`/`ब` and `ि`/`ी` are varied
 * just as commonly, and folding any of them collapses words that genuinely
 * differ. Widening a match is how a hazard detector starts firing on ordinary
 * complaints, and CLAUDE.md is explicit that a product which cries wolf is
 * worth nothing when it is real. One fold, for one sound, written two ways.
 */
export function foldNepali(text: string): string {
  return text.replace(NASAL_CONJUNCT, ANUSVARA);
}
