#!/usr/bin/env node
/**
 * The Nepali strings still waiting on a native speaker, ready to hand over.
 *
 * English beside Nepali, grouped by what it would cost to get wrong, because
 * the person reading this is doing it in one sitting and needs to know where to
 * start rather than to read 1,400 lines in catalogue order.
 *
 * Read-only. It never edits a catalogue: moving a key out of the backlog means
 * adding it to `messages/ne-reviewed.json` by hand, which is the point — a
 * script cannot know whether somebody actually read something.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { REVIEW_SCOPE, backlog, isBlockingTier } from "./ne-review-scope.mjs";

const ROOT = process.cwd();
const read = (name) =>
  JSON.parse(readFileSync(path.join(ROOT, "messages", name), "utf8"));

const en = read("en.json");
const ne = read("ne.json");
const reviewed = read("ne-reviewed.json");

const at = (catalogue, key) =>
  key.split(".").reduce((node, part) => node?.[part], catalogue);

const { scope, documents, blocking, waiting: notBlocking } = backlog(ne, reviewed);
const waiting = [...blocking.keys, ...notBlocking.keys];

console.log("\nNepali — awaiting a native read\n");

if (waiting.length === 0 && documents.every((d) => d.reviewed)) {
  console.log("  Nothing waiting. Every string in scope has been read.\n");
  console.log("  Scope is derived from scripts/ne-review-scope.mjs, so this");
  console.log("  goes back above zero on its own the next time somebody adds");
  console.log("  a string under one of those namespaces.\n");
  process.exit(0);
}

for (const { tier, prefix, why } of REVIEW_SCOPE) {
  const group = waiting.filter((e) => e.prefix === prefix);
  if (group.length === 0) continue;

  console.log(
    `── ${prefix}  (${tier}, ${group.length}${isBlockingTier(tier) ? ", blocks a launch" : ""})`,
  );
  console.log(`   ${why}\n`);
  for (const { key } of group) {
    console.log(`   ${key}`);
    console.log(`     en  ${JSON.stringify(at(en, key))}`);
    console.log(`     ne  ${JSON.stringify(at(ne, key))}`);
  }
  console.log("");
}

const byTier = {};
for (const e of waiting) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;

/*
 * The documents, which have no keys to list. Printed as paths so the person
 * doing the pass knows they exist — a backlog that counted only the catalogue
 * would report the enforcement ladder and the legal pages as read.
 */
console.log("── long-form Nepali, reviewed as documents rather than strings\n");
for (const { path: file, why, tier, reviewed: done } of documents) {
  console.log(`   ${file}  (${tier}${done ? ", read" : ""})`);
  console.log(`     ${why}`);
}
console.log("");

console.log(
  `  ${waiting.length} of ${scope.length} in scope still waiting — ` +
    Object.entries(byTier)
      .map(([t, n]) => `${t} ${n}`)
      .join(", "),
);
/*
 * THE TWO HALVES SAID SEPARATELY, because they are two different jobs. The
 * blocking half has to be finished before a launch build will pass; the staff
 * half is real work that nobody should discover by being surprised later, which
 * is why it keeps its own line rather than disappearing into the total.
 */
const unreadDocuments = documents.filter((d) => !d.reviewed).length;
console.log(
  `  ${blocking.keys.length} of them block a launch (money, safety, legal), plus ${unreadDocuments} of ${documents.length} documents.`,
);
console.log(
  `  ${notBlocking.keys.length} are staff screens — counted, not a launch failure.`,
);
console.log(
  "  Sign a key off by adding it to messages/ne-reviewed.json — a document by its path.\n",
);
