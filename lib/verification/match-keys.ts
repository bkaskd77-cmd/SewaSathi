/**
 * Turning what somebody wrote on a form into something two applications can be
 * compared on.
 *
 * WHY THIS FILE IS THE FIRST THING PHASE 10 BUILDS. The initial check is not
 * what keeps a dangerous person out of somebody's home. A removed provider
 * coming back under a new phone number is the actual attack, and a phone
 * number is the one identifier they can change for a hundred rupees. Removal
 * has to be enforced by things that are expensive to change — a citizenship
 * number, a bank account, a face, a name — and those only work as a barrier if
 * the comparison survives how differently the same person writes them twice.
 *
 * THE SAME PERSON IS THREE DIFFERENT STRINGS. Shyam, Syam and श्याम are one
 * man across three documents. Bishnu and Vishnu are one woman. A citizenship
 * number is written 12-01-70-01234 on one form and १२०१७००१२३४ on the next. A
 * comparison on the raw text catches none of it, and a platform that only
 * compares raw text has a re-registration policy in name only.
 *
 * THE INTELLIGENCE GOES IN THE NORMALISER, NOT IN THE COMPARISON. Everything
 * here reduces a written value to a key, and matching is then plain equality
 * on that key. That is a deliberate trade against the more obvious design of
 * storing the raw values and running edit-distance at review time:
 *
 *   1. Equality survives hashing, and edit-distance does not. The stored keys
 *      are hashed before they are written (`lib/data/verification.ts`), so the
 *      match table is not a second copy of every applicant's citizenship
 *      number sitting next to their address. A table whose leak is
 *      catastrophic is worth this much inconvenience.
 *   2. Computed at submission, not at review. The user asked for this and it
 *      is right: a key computed when the row is written is a key that can be
 *      indexed, and a comparison that runs at review time silently stops
 *      running the day somebody adds a second review path.
 *
 * WHAT IT COSTS: a genuine typo that survives the fold is missed, and two
 * unrelated people can collide. Both are acceptable because A HIT NEVER
 * REJECTS ANYBODY. It surfaces the prior record to a human reviewer, who
 * looks. A false positive costs a minute of that person's time; a false
 * negative puts a removed provider back in a customer's kitchen.
 *
 * Pure, isomorphic and dependency-free, so the browser can warn about a
 * duplicate before submission and the server can decide with the same code.
 */

/* ------------------------------------------------------------------ *
 * Digits
 * ------------------------------------------------------------------ */

/** Devanagari ०–९ in code-point order, so the index is the value. */
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/**
 * Any numeral, written in either script, as Latin digits.
 *
 * A form filled in Nepali gives Devanagari numerals and the same person on a
 * different day gives Latin ones. Without this the two never compare, which
 * would make the whole document-number key useless for exactly the applicants
 * most likely to fill the form in Nepali.
 */
export function normaliseDigits(value: string): string {
  let out = "";
  for (const char of value) {
    const devanagari = DEVANAGARI_DIGITS.indexOf(char);
    out += devanagari >= 0 ? String(devanagari) : char;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Document numbers
 * ------------------------------------------------------------------ */

/**
 * A citizenship, National ID, PAN or licence number as a comparable key.
 *
 * Nepali citizenship numbers are written with any of `-`, `/`, `.` and spaces
 * between the district, the ward, the year and the serial, and which
 * separators appear is a matter of which clerk wrote the certificate. So every
 * separator goes, the numerals are folded to Latin, and letters are uppercased
 * — a PAN carries none but a licence can.
 *
 * Returns "" for anything with no alphanumeric content at all, and the caller
 * must treat "" as "no key" rather than as a value: otherwise every applicant
 * who left the field blank matches every other one.
 */
export function documentKey(value: string): string {
  return normaliseDigits(value)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/**
 * A bank account or eSewa number as a comparable key.
 *
 * Digits only. An eSewa account IS a phone number, so this deliberately
 * collapses to the same shape as one: somebody who re-registers with a new SIM
 * but keeps the wallet their money already arrives in is caught here, and that
 * is a common case rather than a clever one — the wallet is where the money
 * is, and people do not abandon money.
 *
 * A leading country code is stripped so +9779801234567 and 9801234567 are one
 * account. Ten digits is a Nepali mobile number; anything longer is a bank
 * account and is left whole.
 */
export function accountKey(value: string): string {
  const digits = normaliseDigits(value).replace(/[^0-9]/g, "");
  if (digits.length > 10 && digits.startsWith("977")) {
    const withoutCountry = digits.slice(3);
    if (withoutCountry.length === 10) return withoutCountry;
  }
  return digits;
}

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

/**
 * Devanagari to the folded Latin letter directly, skipping transliteration.
 *
 * Transliterating to "sha" and then folding "sh" to S is two steps that can
 * disagree; mapping श straight to S cannot. The map is lossy in exactly the
 * places Nepali transliteration is inconsistent — the aspirated and
 * unaspirated pairs, the three sibilants, the retroflex and dental rows — and
 * that loss IS the feature: it is what makes थापा and "Thapa" and "Tapa" one
 * key.
 */
const DEVANAGARI_LETTERS: Record<string, string> = {
  // Independent vowels.
  अ: "A", आ: "A", इ: "I", ई: "I", उ: "U", ऊ: "U",
  ए: "E", ऐ: "E", ओ: "O", औ: "O", ऋ: "RI",

  // Velar, palatal, retroflex, dental, labial rows — aspiration folded away,
  // because whether somebody writes Thapa or Tapa is a spelling habit.
  क: "K", ख: "K", ग: "G", घ: "G", ङ: "N",
  च: "C", छ: "C", ज: "J", झ: "J", ञ: "N",
  ट: "T", ठ: "T", ड: "D", ढ: "D", ण: "N",
  त: "T", थ: "T", द: "D", ध: "D", न: "N",
  प: "P", फ: "P", ब: "B", भ: "B", म: "M",

  // व folds to B with the labials: Bishnu and Vishnu are one name, and this
  // single line is what makes that true.
  य: "Y", र: "R", ल: "L", व: "B",
  श: "S", ष: "S", स: "S", ह: "H",

  // Nukta forms, which appear in loanwords and in names on older documents.
  "क़": "K", "ख़": "K", "ग़": "G", "ज़": "J",
  "ड़": "D", "ढ़": "D", "फ़": "P", "ऱ": "R",
};

/** Vowel signs. Same folding as the independent vowels above. */
const DEVANAGARI_MATRAS: Record<string, string> = {
  "ा": "A", "ि": "I", "ी": "I", "ु": "U", "ू": "U",
  "े": "E", "ै": "E", "ो": "O", "ौ": "O", "ृ": "RI",
};

/** Anusvara and chandrabindu are both an N; visarga is an H. */
const DEVANAGARI_SIGNS: Record<string, string> = { "ं": "N", "ँ": "N", "ः": "H" };

const HALANT = "्";

/**
 * Devanagari to folded Latin, supplying the inherent vowel.
 *
 * A bare consonant in Devanagari carries an implicit "a" — बहादुर is Bahadur,
 * not Bhdur — and dropping it would make the Devanagari and Latin spellings of
 * the same name disagree on where the first vowel is, which is the one vowel
 * this fold keeps.
 */
function foldDevanagari(input: string): string {
  const chars = Array.from(input);
  let out = "";

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];

    if (DEVANAGARI_SIGNS[char]) {
      out += DEVANAGARI_SIGNS[char];
      continue;
    }
    if (DEVANAGARI_MATRAS[char] || char === HALANT) continue; // handled below

    const letter = DEVANAGARI_LETTERS[char];
    if (!letter) {
      out += char;
      continue;
    }

    out += letter;

    // Independent vowels carry their own sound; only consonants take the
    // inherent "a", and only when nothing following cancels it.
    const isConsonant = !"AEIOU".includes(letter[0]) || letter === "RI";
    if (!isConsonant) continue;

    const next = chars[i + 1];
    if (next === HALANT) continue;
    if (next && DEVANAGARI_MATRAS[next]) {
      out += DEVANAGARI_MATRAS[next];
      continue;
    }
    out += "A";
  }

  return out;
}

/**
 * Latin digraphs, longest first so "chh" is read before "ch" before "c".
 *
 * Every pair here is one that a Nepali name is genuinely written both ways:
 * Prakash/Prakas, Shrestha/Sreshtha, Bikash/Vikash, Phul/Ful, Gyan/Gnan.
 */
const LATIN_FOLDS: Array<[RegExp, string]> = [
  [/KSH|KSC|X/g, "KS"],
  [/CHH|CH/g, "C"],
  [/SHH|SH|SS/g, "S"],
  [/GY|GN|JN/g, "G"],
  [/KH/g, "K"],
  [/GH/g, "G"],
  [/TH/g, "T"],
  [/DH/g, "D"],
  [/BH/g, "B"],
  [/PH|F/g, "P"],
  [/JH|Z/g, "J"],
  [/[VW]/g, "B"],
  [/Q/g, "K"],
  /*
   * A doubled vowel is a LONG vowel, not a different one. "Reeta" is Rita and
   * "Phool" is Phul — the doubling is how a long ī or ū gets written in Latin
   * script, and reading it as an "e" or an "o" splits one woman into two
   * applicants. Found by the test rather than by writing the map: Rita and
   * Reeta came out RIT and RET.
   */
  [/EE/g, "I"],
  [/OO/g, "U"],
];

const VOWEL_CLASS: Record<string, string> = {
  A: "A", I: "I", E: "E", O: "O", U: "U",
};

/**
 * One written name to its phonetic skeleton.
 *
 * Consonants in order, plus THE FIRST VOWEL ONLY. Keeping every vowel would
 * make Rita and Reeta different people; dropping every vowel would make Ram
 * and Rima the same one. The first vowel is the compromise that survives
 * transliteration — nobody disagrees about whether a name starts Ri- or Ra- —
 * while later vowels are exactly where the spellings diverge.
 */
function phoneticToken(token: string): string {
  let folded = foldDevanagari(token)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  for (const [pattern, replacement] of LATIN_FOLDS) {
    folded = folded.replace(pattern, replacement);
  }

  let out = "";
  let seenVowel = false;
  let previous = "";

  for (const char of folded) {
    const vowel = VOWEL_CLASS[char];
    if (vowel) {
      if (seenVowel) continue;
      seenVowel = true;
      out += vowel;
      previous = vowel;
      continue;
    }
    // Y between consonants is carried (Shyam keeps its Y); a doubled letter
    // collapses, because doubling is a spelling habit and not a sound.
    if (char === previous) continue;
    out += char;
    previous = char;
  }

  return out;
}

/**
 * Every key a name should be compared on, most specific first.
 *
 * TWO KEYS, NOT ONE, and the reason is the middle name. "Shyam Kumar
 * Shrestha" and "Shyam Shrestha" are the same man on two forms, and a single
 * whole-name key would call them strangers — middle names get dropped, added,
 * and abbreviated constantly. So a full key and a first-and-last key are both
 * produced and a hit on EITHER is a hit.
 *
 * Tokens are sorted, because the order a Nepali name is written in is not
 * fixed across a bank form and a citizenship certificate.
 *
 * Returns [] for a name with no letters in it. As with `documentKey`, the
 * caller must treat that as "no key" rather than matching on emptiness.
 */
export function nameKeys(fullName: string): string[] {
  const tokens = fullName
    .split(/\s+/)
    .map(phoneticToken)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return [];

  const keys: string[] = [];
  const sorted = [...tokens].sort();
  keys.push(sorted.join("-"));

  // First and last only, for the dropped-middle-name case. Skipped when there
  // is no middle name to drop, so the two keys do not duplicate.
  if (tokens.length > 2) {
    const ends = [tokens[0], tokens[tokens.length - 1]].sort();
    keys.push(ends.join("-"));
  }

  return keys;
}

/* ------------------------------------------------------------------ *
 * Everything, as one set
 * ------------------------------------------------------------------ */

/**
 * The kinds of key an application is matched on.
 *
 * Ordered by how expensive the identifier is for a bad actor to change, which
 * is the only ranking that matters here. A phone number costs a SIM. A
 * citizenship number costs a forgery. A face costs surgery.
 */
export type MatchKeyKind =
  | "document"
  | "account"
  | "name"
  | "area"
  | "device"
  | "face"
  | "reference";

export type MatchKey = { kind: MatchKeyKind; value: string };

export type MatchKeyInput = {
  /** Citizenship, National ID, PAN — every number they gave us. */
  documentNumbers?: string[];
  /** Bank accounts and eSewa numbers. */
  accounts?: string[];
  fullName?: string;
  /** Ward key from `lib/config/areas`, already canonical. */
  areaKeys?: string[];
  /** Browser or device fingerprint, when the client offered one. */
  deviceFingerprint?: string;
  /** Opaque descriptor from the face adapter, when one is enabled. */
  faceSignature?: string;
  /**
   * The people who vouched for them.
   *
   * References are the only human check on competence here, so the way to
   * defeat that check is not forgery — it is one friend vouching for six
   * applicants. Stored on the application and compared against nothing, that
   * was invisible.
   */
  referencePhones?: string[];
};

/**
 * Every key for one application, deduplicated and ready to be hashed.
 *
 * Empty values are dropped rather than stored, because a stored empty key
 * matches every other applicant who left the same field blank — which is the
 * bug that turns a duplicate check into a machine for flagging honest people.
 */
export function matchKeysFor(input: MatchKeyInput): MatchKey[] {
  const keys: MatchKey[] = [];
  const push = (kind: MatchKeyKind, value: string) => {
    if (value.length > 0) keys.push({ kind, value });
  };

  for (const number of input.documentNumbers ?? []) {
    push("document", documentKey(number));
  }
  for (const account of input.accounts ?? []) {
    push("account", accountKey(account));
  }
  for (const key of nameKeys(input.fullName ?? "")) {
    push("name", key);
  }
  for (const area of input.areaKeys ?? []) {
    push("area", area.trim().toLowerCase());
  }
  if (input.deviceFingerprint) {
    push("device", input.deviceFingerprint.trim());
  }
  if (input.faceSignature) {
    push("face", input.faceSignature.trim());
  }
  for (const phone of input.referencePhones ?? []) {
    // `accountKey` because a referee's number is a phone number like any
    // other, and it must fold the country code the same way or the same
    // person written two ways becomes two people.
    push("reference", accountKey(phone));
  }

  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = `${key.kind}:${key.value}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * How much a hit on one kind of key should worry a reviewer.
 *
 * NOT A REJECTION THRESHOLD — there is no threshold, because nothing here
 * rejects anybody. It is a sort order for a queue and a weight in
 * `lib/verification/risk.ts`, so the reviewer reads the strongest evidence
 * first.
 *
 * A shared ward is barely evidence at all: Kathmandu wards hold tens of
 * thousands of people and plumbers cluster where the work is. It is included
 * because it CORROBORATES — a name match in the same ward is a different thing
 * from a name match across the country — and it is weighted so it can never
 * carry a flag on its own.
 */
export const MATCH_WEIGHTS: Record<MatchKeyKind, number> = {
  document: 100,
  face: 90,
  account: 70,
  name: 25,
  device: 20,
  /*
   * LOW ON PURPOSE. A foreman vouching for his whole crew is the ordinary case
   * and exactly the supply this platform wants, so two applicants sharing a
   * referee must not read as suspicious. Six of them is a pattern — and a
   * pattern is for a reviewer to see, not for a rule to decide. The value here
   * is that the hit appears at all.
   */
  reference: 12,
  area: 5,
};
