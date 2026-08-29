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

/** The named ICU placeholders in a message, ignoring plural branch keywords. */
function placeholders(message) {
  if (typeof message !== "string") return new Set();
  const found = new Set();
  for (const match of message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)) {
    found.add(match[1]);
  }
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
console.log(`  ${NEPALI_TRAPS.length} Nepali spelling traps checked.\n`);
