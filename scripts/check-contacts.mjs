#!/usr/bin/env node
/**
 * No invented phone number or email address may reach a customer.
 *
 * WHY THIS IS A BUILD CHECK AND NOT A NOTE. `+977 9800 000 000` sat on five
 * screens for weeks and read as a real support line. On the day the SMS
 * gateway refused every code, the login screen fell back to "call us and we'll
 * take your booking over the phone" and printed it. A customer met a dead door
 * and a dead escape hatch as one wall — and the escape hatch is the half that
 * reads as contempt, because the product did not merely fail, it offered help
 * that was not there.
 *
 * Nobody wrote that number intending it to ship. It arrived as a plausible
 * placeholder in a first draft and then became invisible, which is what
 * placeholders do. A comment saying MOCK protects the next developer; it does
 * not protect the person reading the page. Only a failing build does.
 *
 * WHAT IT SCANS: everything a user can read — both message catalogues, the
 * static legal and information pages, the brand constants, and the JSX. Source
 * comments are stripped first, because the reasoning above has to be allowed
 * to name the number it is banning.
 *
 * WHAT COUNTS AS A PLACEHOLDER is deliberately about *shape*, not a blocklist
 * of the ones already found: a run of repeated digits, an obvious counting
 * sequence, the 555 convention, or a reserved example domain. A real Nepali
 * mobile never looks like any of them, so the rule can be strict without
 * being in anybody's way.
 *
 * PROVED BY BREAKING IT, not by passing once. `npm run check:contacts -- --self-test`
 * feeds it the exact strings that shipped and fails if any is judged clean.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Files a customer's eyes can reach, one way or another. */
const SCAN = [
  "messages",
  "lib/content",
  "lib/config",
  "components",
  "app",
];

const EXTENSIONS = new Set([".ts", ".tsx", ".json", ".mdx"]);

/**
 * Nepali emergency numbers are three digits and genuinely real — 100, 101,
 * 102 appear on the contact page on purpose and must never be flagged. Every
 * rule below needs at least seven digits, which is what keeps them clear.
 */
const RULES = [
  {
    id: "repeated-digits",
    // Seven or more of the same digit in a row, ignoring spaces and dashes:
    // 9800 000 000, 98-00000000, +9779800000000.
    test: (digits) => /(\d)\1{6,}/.test(digits),
    why: "a run of identical digits — nobody's real number looks like this",
  },
  {
    id: "counting-sequence",
    test: (digits) =>
      digits.includes("1234567") ||
      digits.includes("2345678") ||
      digits.includes("9876543"),
    why: "a counting sequence",
  },
  {
    id: "five-five-five",
    test: (digits) => /555\d{4}/.test(digits),
    why: "the 555 convention, which is a placeholder everywhere it appears",
  },
];

const EMAIL_PLACEHOLDER =
  /[A-Za-z0-9._%+-]+@(?:example\.(?:com|org|net)|test\.com|domain\.com|email\.com|yourcompany\.[a-z]+|localhost)/i;

/**
 * Strip comments so this file, ARCHITECTURE.md and the reasoning beside a
 * constant can all name the placeholder they are banning.
 *
 * A JSX comment is `{/* … *\/}` which is a block comment inside braces, so the
 * block rule covers it. Strings are left alone deliberately: a placeholder
 * hidden in a string is exactly what is being hunted.
 */
function stripComments(source, ext) {
  if (ext === ".json") return source;
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Every digit run long enough to be a phone number, as bare digits. */
function phoneCandidates(text) {
  const found = [];
  // A phone as written: digits with spaces, dashes, brackets and a plus.
  for (const match of text.matchAll(/\+?[\d][\d\s().-]{6,}\d/g)) {
    const raw = match[0];
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 7) found.push({ raw: raw.trim(), digits });
  }
  return found;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith("."))
      continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry))) out.push(full);
  }
  return out;
}

/** The whole rule, in one function, so the self-test exercises what ships. */
export function judge(text, ext = ".ts") {
  const body = stripComments(text, ext);
  const problems = [];

  for (const { raw, digits } of phoneCandidates(body)) {
    for (const rule of RULES) {
      if (rule.test(digits)) {
        problems.push({ kind: "phone", value: raw, why: rule.why });
        break;
      }
    }
  }

  const email = body.match(EMAIL_PLACEHOLDER);
  if (email) {
    problems.push({
      kind: "email",
      value: email[0],
      why: "a reserved example domain, which can never receive mail",
    });
  }

  return problems;
}

function selfTest() {
  const mustFail = [
    ['"+977 9800 000 000"', "the number that shipped"],
    ['"+9779800000000"', "the same number, E.164"],
    ['"Call 9841234567 for help"', "a counting sequence"],
    ['"+1 555 0100"', "the 555 convention"],
    ['"support@example.com"', "a reserved example domain"],
  ];
  const mustPass = [
    ['"+977 9843 119 897"', "a real Nepali mobile"],
    ['"For a fire call 101, ambulance 102, police 100."', "emergency numbers"],
    ['"2026-08-29"', "a date"],
    ['"Rs 1,500-4,000"', "a price range"],
    ["// the placeholder +977 9800 000 000 is banned", "a comment"],
  ];

  let bad = 0;
  for (const [sample, label] of mustFail) {
    if (judge(sample).length === 0) {
      console.error(`  self-test FAILED — judged clean but should not: ${label}`);
      bad += 1;
    }
  }
  for (const [sample, label] of mustPass) {
    const problems = judge(sample);
    if (problems.length > 0) {
      console.error(
        `  self-test FAILED — flagged but is legitimate: ${label} (${problems[0].value})`,
      );
      bad += 1;
    }
  }

  if (bad > 0) {
    console.error(`\nContact check: ${bad} self-test failures.\n`);
    process.exit(1);
  }
  console.log(
    `  self-test passed — ${mustFail.length} placeholders caught, ${mustPass.length} real values left alone.`,
  );
}

function main() {
  console.log("\nContact check");

  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  selfTest();

  const files = SCAN.flatMap((dir) => {
    const full = path.join(ROOT, dir);
    try {
      return walk(full);
    } catch {
      return [];
    }
  });

  let failures = 0;
  for (const file of files) {
    const problems = judge(
      readFileSync(file, "utf8"),
      path.extname(file),
    );
    for (const problem of problems) {
      failures += 1;
      console.error(
        `  FAIL  ${path.relative(ROOT, file)} — ${problem.kind} "${problem.value}": ${problem.why}`,
      );
    }
  }

  console.log(`  ${files.length} files scanned`);

  if (failures > 0) {
    console.error(
      `\n  ${failures} placeholder contact detail${failures === 1 ? "" : "s"} reachable by a customer.\n` +
        `  A number nobody answers is worse than no number: somebody already stuck\n` +
        `  is sent to a dead end and told it is help. Remove it, or set\n` +
        `  NEXT_PUBLIC_SUPPORT_PHONE to a line that rings and let the screens read it.\n`,
    );
    process.exit(1);
  }

  console.log("  No placeholder phone numbers or email addresses.\n");
}

main();
