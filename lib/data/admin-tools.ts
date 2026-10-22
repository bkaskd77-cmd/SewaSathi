/**
 * The admin screens that are not work waiting.
 *
 * A QUEUE EMPTIES; THESE DO NOT. Lookup answers "somebody has rung", signals
 * answer "is our pricing wrong", the audit log answers "who looked at what" —
 * none of them has a list that drains, and none of them has a number that
 * means anything on the index. Putting them in `AdminQueueKey` would have made
 * `queuesState()` report "waiting" for ever and permanently killed the
 * index's "nothing is waiting", which is the one sentence that screen exists
 * to be able to say.
 *
 * NO COUNTS, DELIBERATELY, AND THIS IS WHY IT IS A CONSTANT RATHER THAN A READ.
 * The queue group already costs one `head: true` query per queue on every load
 * of the index. A count here would be a second wave for numbers that answer no
 * question: "1,482 audit events" is not a call to action, it is furniture.
 * Links only, so this group adds nothing to the time the index takes.
 */

export type AdminTool = {
  key:
    | "lookup"
    | "enforcement"
    | "signals"
    | "areas"
    | "bands"
    | "duration"
    | "revenue"
    | "content"
    | "announcements"
    | "reviews"
    | "triageAccuracy"
    | "aiLimits"
    | "audit";
  /** Unprefixed; the caller's `Link` adds the locale. */
  href: string;
};

export const ADMIN_TOOLS: AdminTool[] = [
  { key: "lookup", href: "/admin/lookup" },
  /*
   * BESIDE LOOKUP BECAUSE THEY ARE THE TWO HALVES OF ONE QUESTION, and because
   * this screen's own header says customer suspension starts over there — the
   * pair should be adjacent or somebody reads one and not the other.
   *
   * IT WAS REACHABLE ONLY BY TYPING THE URL, for the whole life of the
   * enforcement ladder. The screen was built, `/providers/standards` publishes
   * the five steps it applies, `check:deployed` walked it and proved it
   * deploys and is guarded — and nothing anywhere linked to it, so the only
   * response to a dangerous professional was still effectively hand-written
   * SQL. `applyRedoRecovery`'s four-phase sin in the shape of a screen: every
   * link built except the one somebody uses.
   *
   * NOT A QUEUE, and the distinction is `reviews`' exactly. A count of
   * suspended professionals on the index would read as work outstanding, so
   * somebody would clear it — and the way to clear "2 suspended" is to lift
   * two suspensions, which is the opposite of a decision. Most listings are
   * under no step, so nothing drains.
   */
  { key: "enforcement", href: "/admin/enforcement" },
  { key: "signals", href: "/admin/signals" },
  /*
   * The pair: signals says whether a band looks wrong, this is where it moves.
   * Not a queue for the reason above — a proposal is computed on demand from
   * settled jobs, so there is no list that drains and nothing to count. "Three
   * categories have a proposal" would also be the wrong call to action: a
   * proposal is evidence to weigh, not work outstanding.
   */
  /*
   * Not a queue either, and for a reason worth distinguishing from the two
   * below: there is nothing to decide here at all until somebody wants to open
   * or close a ward. A count of the wards we serve would be a figure that never
   * moves, which is `ACTIVITY_FLOOR`'s reasoning — a number that is true every
   * day for a year stops being read.
   */
  { key: "areas", href: "/admin/areas" },
  { key: "bands", href: "/admin/bands" },
  /*
   * Also not a queue: there is no list and nothing drains. A count would be
   * meaningless and a figure on the index would be the one number nobody should
   * read without its sources beside it.
   */
  { key: "revenue", href: "/admin/revenue" },
  /*
   * Beside bands because they are the same shape of question one axis over —
   * what we publish about a product against what our own finished jobs say.
   * Not a queue either: the duration loop acts by itself, so there is nothing
   * waiting for a person and nothing that drains. What it has is a history,
   * which is a thing to read rather than a count to clear.
   */
  { key: "duration", href: "/admin/duration" },
  /*
   * Beside signals rather than in the queues, for the same reason as the rest
   * of this group: it has no list that drains and no number that is a call to
   * action. It answers "is the AI right", which is a standing question.
   */
  /*
   * NOT A QUEUE, AND IT IS THE ENTRY WHERE THAT DISTINCTION IS LOAD-BEARING. A
   * count of hidden reviews on the index would read as work outstanding, so
   * somebody would clear it — and the way to clear "3 hidden" is to put three
   * reviews back, which is the opposite of a decision. The screen is for
   * reading what has been hidden and why, and a moderation power that empties
   * is a moderation power with a target.
   *
   * Beside the queues rather than inside them for that reason, and next to
   * `content` because they are the same shape of question: what the product
   * says in public and who decided it.
   */
  { key: "reviews", href: "/admin/reviews" },
  { key: "triageAccuracy", href: "/admin/triage-accuracy" },
  /*
   * Beside triage accuracy because they are the two halves of one question — is the AI
   * worth what it costs — and because somebody who has just read that the matcher
   * answered four of four is one click from the budget that made it. Not a queue: there
   * is no list and nothing drains, and the number on it is today's spend rather than
   * work outstanding.
   */
  { key: "aiLimits", href: "/admin/ai-limits" },
  /*
   * Also not a queue, and the distinction matters here more than most: 1,300 editable
   * strings is a list that never drains, and a count of them would read as work
   * outstanding when it is simply how many words the product contains.
   */
  { key: "content", href: "/admin/content" },
  /*
   * BESIDE `content` BECAUSE THEY ARE THE SAME QUESTION ON TWO CLOCKS: what the
   * product says in public. The string editor changes a sentence that is part
   * of the product for ever; this one puts up a sentence with a start and an
   * end. Somebody who has just failed to find a way to say "we are closed on
   * Sunday" in the catalogue is one row away from the screen that can.
   *
   * NOT A QUEUE, and here the distinction has teeth. A count of live banners on
   * the index would read as work outstanding, and the way to clear "1 showing"
   * is to take a banner down — which is the opposite of a decision, and the
   * banner is up precisely because somebody decided it should be. Nothing
   * drains: most days there is nothing here at all.
   */
  { key: "announcements", href: "/admin/announcements" },
  { key: "audit", href: "/admin/audit" },
];
