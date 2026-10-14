#!/usr/bin/env node
/**
 * The two catalogues have to hold the same keys.
 *
 * A missing key does not fail the build — next-intl renders the key path and
 * carries on, which on a Nepali page looks like `services.card.book` sitting
 * where a button label should be. That is a bug you only find by opening the
 * page, in the language you are least likely to be reading.
 *
 * It also catches the other direction: a Nepali key with no English sibling is
 * copy nobody is maintaining.
 *
 * Runs in `npm run verify` and in CI. Cheap enough to run on every commit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PROSE_DOCUMENTS, backlog } from "./ne-review-scope.mjs";

const ROOT = process.cwd();
const LOCALES = ["en", "ne"];
const REFERENCE = "en";

const read = (locale) =>
  JSON.parse(
    readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"),
  );

/** Every leaf path in the catalogue, dot-separated. */
function leaves(value, prefix = "") {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * The ICU argument types that may follow a placeholder name.
 *
 * This list is what separates an argument from ordinary text that happens to
 * sit inside braces. `{amount}` and `{count, plural, ...}` are arguments;
 * `{None, on {jobs} finished jobs}` is the CONTENT of a plural branch and
 * contains exactly one argument, `jobs`.
 */
const ICU_TYPES = new Set([
  "plural",
  "select",
  "selectordinal",
  "number",
  "date",
  "time",
]);

/** The types whose body is a list of `selector { message }` branches. */
const BRANCHING = new Set(["plural", "select", "selectordinal"]);

/**
 * The named ICU placeholders in a message.
 *
 * WHY THIS IS NOT A REGEX, WHICH IS WHAT IT USED TO BE — TWICE, AND EACH
 * VERSION FAILED ON THE NEXT BRANCH SOMEBODY WROTE.
 *
 * `\{(\w+)[,}]` read the first word of every plural branch as a placeholder,
 * so an ordinary `=0 {None, on {jobs} finished jobs}` was reported as English
 * "using {None}" and Nepali failing to — wrong in both directions, and a real
 * difference between the catalogues would have been hidden behind the noise.
 * The fix was "a name is an argument only when the brace closes straight after
 * it, or a real ICU type follows".
 *
 * AND THAT RULE IS DEFEATED BY A BRANCH WHOSE WHOLE CONTENT IS ONE WORD.
 * `=0 {today}` is literal text — in ICU those braces DELIMIT the branch, they
 * do not introduce an argument — but the brace does close straight after the
 * word, so the rule read it as an argument called `today` and demanded the
 * Nepali use it. Indistinguishable from `{city}` by anything that does not
 * know where it is in the message.
 *
 * SO IT KNOWS WHERE IT IS. A `{` is an argument when it sits in a message, and
 * a branch delimiter when it sits in the body of a `plural`, `select` or
 * `selectordinal` — those are the only two positions ICU has. One walk tracking
 * which it is in answers both of the cases above and the `{jobs}` nested inside
 * the first one, and it is not a third regex waiting for a fourth shape.
 *
 * The tempting fix both times was to reword copy until the checker went quiet,
 * which leaves the trap armed for the next person. `{today}` is still in
 * `en.json`.
 */
function placeholders(message) {
  if (typeof message !== "string") return new Set();
  const found = new Set();

  /** The index of the `}` matching the `{` at `from`. */
  const closes = (from) => {
    let depth = 0;
    for (let i = from; i < message.length; i += 1) {
      if (message[i] === "{") depth += 1;
      else if (message[i] === "}" && --depth === 0) return i;
    }
    return message.length;
  };

  const scan = (from, to, inBranchList) => {
    let i = from;
    while (i < to) {
      if (message[i] !== "{") {
        i += 1;
        continue;
      }
      const end = closes(i);

      if (inBranchList) {
        // `=0 {…}` / `other {…}`: these braces are the branch's, and its
        // content is an ordinary message that may hold arguments of its own.
        scan(i + 1, end, false);
        i = end + 1;
        continue;
      }

      const head = message.slice(i + 1, end);
      const named = head.match(/^\s*([A-Za-z0-9_]+)\s*(?:,\s*([A-Za-z]+))?/);
      const bare = /^\s*[A-Za-z0-9_]+\s*$/.test(head);

      if (named && bare) found.add(named[1]);
      else if (named && ICU_TYPES.has(named[2])) {
        found.add(named[1]);
        scan(i + 1 + named[0].length, end, BRANCHING.has(named[2]));
      } else {
        // Not a shape ICU defines as an argument. Scanned anyway rather than
        // skipped, so an argument nested inside it is still counted — losing
        // one silently is how the first regex hid a real mismatch.
        scan(i + 1, end, false);
      }

      i = end + 1;
    }
  };

  scan(0, message.length, false);
  return found;
}

function at(catalogue, key) {
  return key.split(".").reduce((node, part) => node?.[part], catalogue);
}

/**
 * Devanagari spellings and calques that have already been wrong once.
 *
 * Not a grammar checker — a list of specific mistakes, each of which shipped.
 * A translation that reads as English-run-through-a-dictionary is the failure
 * this catches: it is invisible to anyone reviewing in English, and obvious
 * and slightly insulting to the reader it was written for.
 *
 * Add an entry when a native reader flags something, so it cannot come back.
 */
const NEPALI_TRAPS = [
  {
    pattern: /(?:उपत्यका|काठमाडौँ|ललितपुर|भक्तपुर|शहर|देश)भर(?![िी])/,
    why: '"भर" should be "भरि" — उपत्यकाभरि, not उपत्यकाभर.',
  },
  {
    pattern: /लिंक/,
    why: '"लिंक" should be "लिङ्क" — Nepali writes the ङ् conjunct, not anusvara.',
  },
  {
    pattern: /कोकहाँ|कोलाई|कोसित/,
    why: '"को" takes the oblique "कस-" before a postposition: कसकहाँ, कसलाई.',
  },
  {
    pattern: /मार्गचिन्ह/,
    why: '"मार्गचिन्ह" is a word-for-word "breadcrumb" nobody uses.',
  },
  {
    pattern: /मोलमोलाइ/,
    why: 'The usual word is "मोलतोल".',
  },
  {
    pattern: /दर सीमा/,
    why: '"rate limit" calqued word-for-word; use the loanword "रेट लिमिट".',
  },
];

const catalogues = Object.fromEntries(LOCALES.map((l) => [l, read(l)]));
const reference = catalogues[REFERENCE];
const referenceKeys = leaves(reference);

const failures = [];

for (const locale of LOCALES) {
  if (locale === REFERENCE) continue;
  const keys = new Set(leaves(catalogues[locale]));

  for (const key of referenceKeys) {
    if (!keys.has(key)) {
      failures.push(`${locale}.json is missing "${key}".`);
      continue;
    }

    // A message that promises {name} in one language and {naam} in the other
    // renders the literal braces to whoever gets the mismatch.
    const expected = placeholders(at(reference, key));
    const actual = placeholders(at(catalogues[locale], key));
    for (const name of expected) {
      if (!actual.has(name)) {
        failures.push(`${locale}.json "${key}" does not use {${name}}.`);
      }
    }
    for (const name of actual) {
      if (!expected.has(name)) {
        failures.push(
          `${locale}.json "${key}" uses {${name}}, which ${REFERENCE}.json does not.`,
        );
      }
    }
  }

  for (const key of keys) {
    if (!referenceKeys.includes(key)) {
      failures.push(
        `${locale}.json has "${key}", which ${REFERENCE}.json does not.`,
      );
    }
  }
}

/**
 * "1 times" — a count interpolated in front of a plural noun.
 *
 * WHAT WENT WRONG. `/admin/guarantee-claims` shipped reading "This customer
 * has claimed 1 times on 6 finished jobs", on the screen where somebody
 * decides how much of a customer's money goes back. Copy that reads as broken
 * beside a figure makes the figure look careless too.
 *
 * IT WAS A CLASS, NOT AN INSTANCE, which is the only reason this check exists.
 * Nine strings had the same shape when it was written and six of them predated
 * the bug that prompted it — "1 jobs done" on the bookings summary, "1 years'
 * experience" on a provider card, both customer-facing and both shipped long
 * before. The idiom to avoid it was already in the catalogue and simply not
 * reached for.
 *
 * WHY IT IS ALLOWED TO BE A REGEX when `check:keys` refuses to be one. That
 * checker resolves `t()` calls in TypeScript, where a name can be rebound and
 * a binding destructured, and three regex attempts each cried wolf. This one
 * reads a JSON string for a fixed two-token shape — `{n}` then a lowercase
 * word ending in `s` — and when it was added it flagged exactly nine strings
 * with no false positives among them. A checker that cried wolf here would be
 * skimmed and would take the real entries with it.
 *
 * ENGLISH ONLY. Nepali's वर्ष, काम and पटक do not inflect for number, so the
 * same shape there is correct and a branch would invent a distinction the
 * language does not make.
 */
const PLURAL_SHAPE = /\{n\}\s+[a-z]+s\b/;

/** Strings where `{n}` before an s-word is genuinely invariant. */
const ALLOWED_INVARIANT = new Set([
  // Empty on purpose. An entry here is a claim that a count reads correctly
  // at one, so it needs the sentence written out beside it.
]);

function missingPluralBranch(message) {
  if (typeof message !== "string") return false;
  if (message.includes("plural")) return false;
  return PLURAL_SHAPE.test(message);
}

/*
 * THE CHECK PROVES ITSELF ON EVERY RUN, like check:secrets and check:contacts.
 * A scanner that has quietly stopped scanning prints the same tick as one that
 * is working, and the tick is what everybody reads.
 */
{
  const mustFlag = "{n} jobs done";
  const mustNot = [
    "{count, plural, one {{n} job} other {{n} jobs}}",
    "{n} वटा काम",
    "{amount} paid",
  ];
  if (!missingPluralBranch(mustFlag)) {
    failures.push(
      "check:messages self-test — the plural rule no longer flags \"{n} jobs done\". It is not checking anything.",
    );
  }
  for (const safe of mustNot) {
    if (missingPluralBranch(safe)) {
      failures.push(
        `check:messages self-test — the plural rule now flags ${safe}, which is correct copy. It would cry wolf.`,
      );
    }
  }
}

/*
 * AND THE PLACEHOLDER READER PROVES ITSELF TOO, which it did not before — it
 * has now been wrong twice in opposite directions (a branch's first word read
 * as an argument, then a one-word branch read as an argument), and both times
 * the run that was wrong printed the same tick as a run that was right. Each
 * case below is a shape that actually shipped.
 */
{
  const cases = [
    ["{amount} paid", ["amount"]],
    ["{name}, {city} · {trade}", ["name", "city", "trade"]],
    ["{count, plural, one {{n} job} other {{n} jobs}}", ["count", "n"]],
    // The one-word branch. `today` is text; nothing may demand a translation.
    ["{count, plural, =0 {today} other {{n} days ago}}", ["count", "n"]],
    // The branch starting with a word and a comma, with a real nested argument.
    ["{count, plural, =0 {None, on {jobs} finished jobs} other {x}}", ["count", "jobs"]],
  ];

  for (const [message, want] of cases) {
    const got = [...placeholders(message)].sort();
    const expected = [...want].sort();
    if (got.join("|") !== expected.join("|")) {
      failures.push(
        `check:messages self-test — placeholders(${JSON.stringify(message)}) read ` +
          `[${got}] and should read [${expected}]. The reader is wrong, so every ` +
          `catalogue comparison below it is.`,
      );
    }
  }
}

for (const key of referenceKeys) {
  if (ALLOWED_INVARIANT.has(key)) continue;
  if (missingPluralBranch(at(reference, key))) {
    failures.push(
      `${REFERENCE}.json "${key}": {n} sits in front of a plural noun with no plural branch, so it reads "1 times" at one. Use {count, plural, one {…} other {…}} and pass a numeric count.`,
    );
  }
}

// Nepali-specific spelling and calque traps.
for (const key of leaves(catalogues.ne)) {
  const value = at(catalogues.ne, key);
  if (typeof value !== "string") continue;
  for (const { pattern, why } of NEPALI_TRAPS) {
    if (pattern.test(value)) failures.push(`ne.json "${key}": ${why}`);
  }
}

console.log("\nMessage catalogues");
console.log(`  ${referenceKeys.length} keys in ${REFERENCE}.json`);

if (failures.length > 0) {
  console.error("\nCatalogues out of step:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(`  ${LOCALES.join(", ")} agree on every key and placeholder.`);
console.log(`  ${NEPALI_TRAPS.length} Nepali spelling traps checked.`);
console.log(
  "  plural rule and placeholder reader self-tested; no count reads as \"1 times\".",
);

/*
 * THE BACKLOG, PRINTED RATHER THAN REMEMBERED.
 *
 * The traps above catch mistakes that have already shipped once. They cannot
 * catch a line that is correct Nepali and still not what anybody would say —
 * only a native speaker can, and that happens once before launch rather than
 * per phase. So the number is printed on every run: the scope is derived from
 * namespace rules (`ne-review-scope.mjs`), which means a string added under
 * `booking.payment` tomorrow raises this count on its own and nobody has to
 * remember to write it down.
 *
 * Not a failure. `npm run check:blockers` is what refuses a launch build while
 * any of them are unread — see LAUNCH-BLOCKERS.md § nepali-native-read.
 */
let reviewed = {};
try {
  reviewed = JSON.parse(
    readFileSync(path.join(ROOT, "messages", "ne-reviewed.json"), "utf8"),
  );
} catch {
  // Missing or malformed reads as nothing reviewed, which is the safe
  // direction: it over-reports the backlog rather than hiding it.
}

/*
 * BOTH HALVES ARE PRINTED, which is the whole reason the split is safe to make.
 * `nepali-native-read` blocks a launch on the money, safety and legal tiers only
 * — reclassifying the staff strings would otherwise be a way of finishing them
 * without reading them, and a number that stops being printed is a number nobody
 * finishes. So the staff count stays on this line, every run, saying plainly that
 * it is not holding a launch.
 */
const { blocking, waiting } = backlog(catalogues.ne, reviewed);
const blockingLeft = blocking.keys.length + blocking.documents.length;
const blockingTotal = blocking.inScope + PROSE_DOCUMENTS.length;
console.log(
  blockingLeft === 0
    ? `  ${blockingTotal} money, safety and legal strings and documents, all read by a native speaker.`
    : `  ${blockingLeft} of ${blockingTotal} money, safety and legal strings await a native read — blocks a launch — npm run ne:review`,
);
console.log(
  waiting.keys.length === 0
    ? `  ${waiting.inScope} staff strings, all read.`
    : `  ${waiting.keys.length} of ${waiting.inScope} staff strings await one too — counted, does not block a launch.`,
);
console.log("");
