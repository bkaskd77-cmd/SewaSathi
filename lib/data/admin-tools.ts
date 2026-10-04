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
    | "signals"
    | "bands"
    | "revenue"
    | "content"
    | "triageAccuracy"
    | "audit";
  /** Unprefixed; the caller's `Link` adds the locale. */
  href: string;
};

export const ADMIN_TOOLS: AdminTool[] = [
  { key: "lookup", href: "/admin/lookup" },
  { key: "signals", href: "/admin/signals" },
  /*
   * The pair: signals says whether a band looks wrong, this is where it moves.
   * Not a queue for the reason above — a proposal is computed on demand from
   * settled jobs, so there is no list that drains and nothing to count. "Three
   * categories have a proposal" would also be the wrong call to action: a
   * proposal is evidence to weigh, not work outstanding.
   */
  { key: "bands", href: "/admin/bands" },
  /*
   * Also not a queue: there is no list and nothing drains. A count would be
   * meaningless and a figure on the index would be the one number nobody should
   * read without its sources beside it.
   */
  { key: "revenue", href: "/admin/revenue" },
  /*
   * Beside signals rather than in the queues, for the same reason as the rest
   * of this group: it has no list that drains and no number that is a call to
   * action. It answers "is the AI right", which is a standing question.
   */
  { key: "triageAccuracy", href: "/admin/triage-accuracy" },
  /*
   * Also not a queue, and the distinction matters here more than most: 1,300 editable
   * strings is a list that never drains, and a count of them would read as work
   * outstanding when it is simply how many words the product contains.
   */
  { key: "content", href: "/admin/content" },
  { key: "audit", href: "/admin/audit" },
];
