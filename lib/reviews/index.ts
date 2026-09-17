/**
 * The reviews module's public surface.
 *
 * Everything outside `lib/reviews/` imports from here, enforced by
 * `no-restricted-imports`. The rules are pure; the reads and writes are in
 * `lib/data/reviews.ts` and go nowhere near this file.
 */
export {
  CUSTOMER_FLAGS,
  REPLY_MAX_CHARS,
  REVIEW_WINDOW_DAYS,
  canEdit,
  canReply,
  countsTowardAverage,
  isCustomerFlag,
  published,
  reviewWindowFrom,
  sealed,
  type CustomerFlag,
  type ReplyRefusal,
  type ReviewPair,
  type ReviewSide,
} from "./rules";
