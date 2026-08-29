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

console.log("\nMessage catalogues");
console.log(`  ${referenceKeys.length} keys in ${REFERENCE}.json`);

if (failures.length > 0) {
  console.error("\nCatalogues out of step:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(`  ${LOCALES.join(", ")} agree on every key and placeholder.\n`);
