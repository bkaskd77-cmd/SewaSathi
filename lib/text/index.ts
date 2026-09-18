/**
 * Text normalisation shared by everything that matches what a person typed.
 *
 * Its own module rather than a helper inside `lib/ai` because three callers
 * need it and they are in different places: the safety guard, the keyword
 * matcher, and the catalogue search on `/services`. A copy in each is three
 * chances for them to disagree about what a word is.
 */
export { foldNepali } from "./nepali";
