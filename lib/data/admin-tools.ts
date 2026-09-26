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
  key: "lookup" | "signals" | "triageAccuracy" | "audit";
  /** Unprefixed; the caller's `Link` adds the locale. */
  href: string;
};

export const ADMIN_TOOLS: AdminTool[] = [
  { key: "lookup", href: "/admin/lookup" },
  { key: "signals", href: "/admin/signals" },
  /*
   * Beside signals rather than in the queues, for the same reason as the rest
   * of this group: it has no list that drains and no number that is a call to
   * action. It answers "is the AI right", which is a standing question.
   */
  { key: "triageAccuracy", href: "/admin/triage-accuracy" },
  { key: "audit", href: "/admin/audit" },
];
