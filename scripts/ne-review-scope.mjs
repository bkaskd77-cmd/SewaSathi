/**
 * Which Nepali strings must a native speaker read before launch.
 *
 * WHY THIS IS DERIVED AND NOT A LIST SOMEBODY MAINTAINS. Every phase adds
 * Nepali, the backlog is reviewed once before launch rather than per phase, and
 * a hand-kept list of "strings awaiting a native ear" is a list that silently
 * stops being complete the first time somebody forgets to add to it. Namespace
 * rules cannot forget: a key added under `booking.payment` tomorrow is in scope
 * the moment it exists, with nobody having to remember anything.
 *
 * NOT EVERY STRING — THE ONES WHERE BEING WRONG COSTS SOMETHING. 1,400 keys is
 * not a review, it is a week nobody has. These are the screens where a
 * translation that merely means the right thing is not good enough:
 *
 *   money      a number somebody is about to pay, or a promise about their
 *              money. `booking.payment` carries the blind cash entry and the
 *              sentence that makes it honest; `booking.guarantee` is what the
 *              guarantee covers and for how long.
 *   safety     what somebody reads when they are frightened. The hazard lines
 *              are the reason `foldNepali` exists; wrong register here reads as
 *              a product that does not understand what is happening.
 *   legal      the terms a customer agrees to at sign-in, and the enforcement
 *              ladder a professional is judged by.
 *   staff      money copy on an admin screen. Lower stakes — no customer reads
 *              it — but a reviewer settling a disputed amount in bad Nepali is
 *              still deciding somebody's money.
 *
 * Anything outside these namespaces gets read if there is time, and is not in
 * this backlog at all.
 *
 * THE TIER ALSO DECIDES WHETHER IT HOLDS A LAUNCH — see `BLOCKING_TIERS`. money,
 * safety and legal refuse a launch build; staff is counted and printed and does
 * not, because an admin misreading a queue label costs a slower queue and a
 * professional misreading the cash-fee line costs them money.
 */

/** Prefix → why it matters. Ordered most-costly first; the report prints in this order. */
export const REVIEW_SCOPE = [
  { tier: "money", prefix: "booking.payment", why: "A figure somebody is about to hand over, and the promise about their guarantee that makes blind entry honest." },
  { tier: "money", prefix: "booking.guarantee", why: "What the guarantee covers, for how long, and who pays for the return visit." },
  { tier: "money", prefix: "booking.notifications", why: "Told to somebody who is not looking at the screen — no surrounding context to repair a wrong word." },
  { tier: "safety", prefix: "safety", why: "Read while frightened. Register matters more than accuracy here." },
  { tier: "safety", prefix: "triage", why: "The first thing a stranger reads, and the path a hazard is described down." },
  { tier: "legal", prefix: "legal", why: "Labels around the terms a customer agrees to at sign-in. The prose itself is a document, not a key — see PROSE_DOCUMENTS." },
  { tier: "staff", prefix: "admin.mismatches", why: "A reviewer settling a disputed cash amount." },
  { tier: "staff", prefix: "admin.guaranteeClaims", why: "A reviewer deciding how much of a customer's money goes back, against a ceiling and a parts deduction they have to read correctly to weigh. Same room as admin.mismatches and a larger consequence: this one moves money out." },
  { tier: "money", prefix: "provider.jobs.materials", why: "A figure the professional types at settlement that later reduces what they can be asked to refund. Wrong wording here reads as 'what did the job cost', which is a different number." },
  { tier: "money", prefix: "provider.dashboard.claims.parts", why: "Their answer decides whether the parts cost comes off a refund they may fund. A mistranslated option is somebody answering the opposite of what they meant about their own money." },
  { tier: "staff", prefix: "admin.payoutDestinations", why: "A reviewer deciding whether money should go to an account that was changed, in a window where nobody else has been told it changed. The sentence that matters is the one telling them to ring before confirming — read wrongly, it reads as a formality." },
  { tier: "money", prefix: "provider.payouts", why: "Where a professional's earnings are sent, and the sentences that explain the three-day wait and the check before a first payment. The takeover warning lives here — somebody reading 'was that not you?' wrongly is somebody who does not ring us while their money is being redirected." },
  { tier: "money", prefix: "provider.money", why: "A professional's own account of what they are owed, what they owe us on cash jobs, what is held until later and why this week is waiting. Six sentences here can each be misread into a grievance: the cash-fee line reads as a deduction if the direction is lost, the holdback as money taken rather than deferred, and the refund balance as a debt we will come asking for. The wait reasons are the ones somebody reads at the moment they expected to be paid and were not." },
  { tier: "staff", prefix: "admin.payouts", why: "The screen where a person releases a week of somebody's earnings, and the only place an account number is shown. Four sentences carry a real failure mode: the four hold reasons, which a reviewer who misreads them resolves by pressing something else, and the one saying the account changed after the draft — read as a formality, it is the takeover going through." },
  { tier: "money", prefix: "booking.detail.cancel", why: "The cancellation dialogue states the policy at the moment somebody acts on it, and in this product the window IS the policy — `cancellation.ts` has no fee to soften a misreading. Somebody who reads it as 'cancelling costs you something' keeps a job they do not want; somebody who reads it as 'you can cancel any time' finds out otherwise with a professional at the door." },
  { tier: "money", prefix: "booking.account", why: "Holds the activity opt-out, which is a privacy statement rather than a setting: it decides whether somebody's first name and trade appear on the homepage. A toggle whose two labels can be read either way is consent nobody gave." },
  { tier: "money", prefix: "join.apply.payout", why: "Where a professional's earnings are sent. It was missing from this list while every other money namespace was on it — found when the payee-name field was added, which is the one string here with a real failure mode: somebody who reads it as 'your own name' writes theirs on a wallet that is not theirs, and the transfer bounces with no sign of why." },
];

/**
 * The Nepali that is NOT in the catalogue, and would have been missed.
 *
 * The enforcement ladder and the three legal pages are long-form documents in
 * `lib/content/`, written as `{ en: {...}, ne: {...} }` rather than as message
 * keys — so a scope built from `messages/ne.json` alone reports them as read
 * when nobody has looked at them at all. That is the exact failure this whole
 * mechanism exists to prevent, one directory over, and a test asserting every
 * rule matches something is what surfaced it.
 *
 * They are counted as documents rather than keys because there is nothing to
 * count: a section of prose is reviewed or it is not, and pretending it is 40
 * strings would make the backlog number meaningless in both directions.
 */
export const PROSE_DOCUMENTS = [
  {
    tier: "legal",
    path: "lib/content/pages/standards.ts",
    why: "The enforcement ladder, read by a professional deciding whether to trust us. Deterrence nobody can read is a trap rather than a deterrent.",
  },
  {
    tier: "legal",
    path: "lib/content/legal/terms.ts",
    why: "What a customer agrees to at sign-in.",
  },
  {
    tier: "legal",
    path: "lib/content/legal/privacy.ts",
    why: "What we hold about somebody and what we do with it.",
  },
  {
    tier: "legal",
    path: "lib/content/legal/refunds.ts",
    why: "The guarantee, the window, and who pays for the return visit.",
  },
];

/**
 * Which tiers refuse a launch, and which only wait.
 *
 * WHY THE BLOCKER SPLIT. One entry over the whole scope could not be satisfied
 * without reviewing admin copy, so the money and safety strings were held behind
 * the staff ones — and the thing actually at risk is not symmetric. An admin
 * misreading a queue label costs a slower queue and is noticed in the room by
 * somebody who can ask. A professional misreading the cash-fee line on
 * `provider.money` loses money and trusts us less, with nobody there to correct
 * it, and a frightened person misreading a hazard line is the failure
 * `foldNepali` exists for.
 *
 * `staff` IS DELIBERATELY OUTSIDE AND STAYS COUNTED. The number is still printed
 * by `check:messages` and still listed by `ne:review`, because a backlog that
 * stops being printed is a backlog nobody finishes — reclassifying is not the
 * same as doing. What changes is only that it cannot hold a launch.
 *
 * It is a predicate over the tier each rule already carries rather than a second
 * list of prefixes: two lists drift, and the one that drifted would be the one
 * deciding whether a launch is allowed.
 */
export const BLOCKING_TIERS = ["money", "safety", "legal"];

export function isBlockingTier(tier) {
  return BLOCKING_TIERS.includes(tier);
}

/** Every leaf path in a catalogue, dot-separated. */
export function leaves(value, prefix = "") {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * The keys in scope, each with the tier that put it there.
 *
 * `reviewed` is the hand-kept half and the only half a person edits: a key
 * moves out of the backlog when somebody has actually read it, which is not
 * something a rule can infer.
 */
export function inScope(catalogue, reviewed = []) {
  const done = new Set(reviewed);
  const out = [];
  for (const key of leaves(catalogue)) {
    const rule = REVIEW_SCOPE.find(
      (r) => key === r.prefix || key.startsWith(`${r.prefix}.`),
    );
    if (!rule) continue;
    out.push({ key, tier: rule.tier, prefix: rule.prefix, why: rule.why, reviewed: done.has(key) });
  }
  return out;
}

/**
 * The backlog, split into the half that blocks a launch and the half that does not.
 *
 * ONE READ, TWO NUMBERS, so the launch gate and the printed count cannot
 * disagree about what is blocking. `check:blockers`, `check:messages` and
 * `ne:review` all call this; the first refuses a launch on `blocking`, the other
 * two print both halves.
 *
 * A DOCUMENT IS SIGNED OFF BY ITS PATH, and until this existed there was no way
 * to sign one off at all: `ne-reviewed.json` held `keys`, a document has no key,
 * and `ne:review` listed all four unconditionally for ever. A gate on something
 * nobody can satisfy is not a gate, so `documents` is the other half of that file.
 *
 * `reviewed` MISSING READS AS NOTHING REVIEWED, which over-reports the backlog
 * rather than hiding it — the safe direction for a file whose absence would
 * otherwise mean "all clear".
 */
export function backlog(catalogue, reviewed = {}) {
  const scope = inScope(catalogue, reviewed.keys ?? []);
  const signedOff = new Set(reviewed.documents ?? []);
  const documents = PROSE_DOCUMENTS.map((doc) => ({
    ...doc,
    reviewed: signedOff.has(doc.path),
  }));

  const waiting = scope.filter((entry) => !entry.reviewed);
  const split = (blocking) => ({
    keys: waiting.filter((e) => isBlockingTier(e.tier) === blocking),
    documents: documents.filter(
      (d) => isBlockingTier(d.tier) === blocking && !d.reviewed,
    ),
    inScope: scope.filter((e) => isBlockingTier(e.tier) === blocking).length,
  });

  return { scope, documents, blocking: split(true), waiting: split(false) };
}
