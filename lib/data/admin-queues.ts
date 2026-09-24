import "server-only";

import {
  REFUND_DECIDABLE_CAP,
  REFUND_QUEUE_CAP,
  refundQueueCounts,
} from "@/lib/data/claims";
import {
  APPEAL_QUEUE_CAP,
  openCommissionAppealsCount,
} from "@/lib/data/payments";
import type { AdminQueueCount } from "@/lib/data/queue";
import { NO_SHOW_QUEUE_CAP, openNoShowClaimsCount } from "@/lib/data/review";
import {
  SURVEY_FEE_QUEUE_CAP,
  pendingSurveyFeesCount,
} from "@/lib/data/survey";
import { REVIEW_QUEUE_CAP, reviewQueueCount } from "@/lib/data/verification";

/**
 * The six numbers the admin index exists to show, and nothing else.
 *
 * WHY THE INDEX NEEDED BUILDING AT ALL. There were five admin screens and no
 * way to reach them: `/admin` itself did not exist, so an admin typing it got
 * the catch-all 404, and nothing in the product linked to any of the five. You
 * had to already know the URLs. Work sat in queues nobody opened because
 * nothing told anybody they had filled up.
 *
 * COUNTS, NOT ROWS. Each of these is `head: true` — the count comes back and
 * no row does. Calling the six queue functions instead would fetch up to 550
 * rows and every join behind them to print six integers, several waves deep,
 * on the one screen that should open instantly. The filters are defined beside
 * their own queue function and shared with it, so a count and its list cannot
 * come to disagree.
 *
 * ONE WAVE. None of the six depends on another, so they go in one
 * `Promise.all` — the standing latency rule, and the difference between one
 * round trip to Singapore and seven.
 *
 * NULL IS NOT ZERO, EVERYWHERE HERE. A count that failed is null and the
 * screen says it could not be read. An admin index that prints "0 waiting"
 * because a query broke is worse than one that prints nothing: it is the
 * failure that tells you to go home.
 */

export async function adminQueueCounts(): Promise<AdminQueueCount[]> {
  const [applications, claims, refunds, surveyFees, appeals] =
    await Promise.all([
      reviewQueueCount(),
      openNoShowClaimsCount(),
      refundQueueCounts(),
      pendingSurveyFeesCount(),
      openCommissionAppealsCount(),
    ]);

  return [
    {
      key: "applications",
      href: "/admin/applications",
      total: applications,
      cap: REVIEW_QUEUE_CAP,
    },
    {
      key: "claims",
      href: "/admin/claims",
      total: claims,
      cap: NO_SHOW_QUEUE_CAP,
    },
    {
      key: "refunds",
      href: "/admin/guarantee-claims",
      total: refunds.awaitingPayment,
      cap: REFUND_QUEUE_CAP,
    },
    {
      key: "verdicts",
      href: "/admin/guarantee-claims",
      total: refunds.decidable,
      cap: REFUND_DECIDABLE_CAP,
    },
    {
      key: "surveyFees",
      href: "/admin/survey-fees",
      total: surveyFees,
      cap: SURVEY_FEE_QUEUE_CAP,
    },
    {
      key: "appeals",
      href: "/admin/appeals",
      total: appeals,
      cap: APPEAL_QUEUE_CAP,
    },
  ];
}
