import { NEPAL_UTC_OFFSET_MINUTES } from "@/lib/photos/freshness";

/**
 * A SENTENCE WE CAN PUT IN FRONT OF EVERYBODY, AND THE RULE THAT DECIDES WHICH.
 *
 * Pure, and in `lib/config/` rather than inside the `server-only` read, which
 * is the mistake this repository records four times — `heldReasonFor`,
 * `isFresh`, `destinationReadiness` and `statedBandRefusal` were each written
 * inside a module no unit test could reach. The banner, the admin screen and
 * the tests all call these, so none of them forms a second opinion.
 */

/**
 * Who a banner is for.
 *
 * AUDIENCE IS A STORED FACT, which is `notificationPath`'s lesson one surface
 * over: "payouts are a day late" is for professionals and "we are closed for
 * Dashain" is for customers, and a banner shown to the wrong half is either
 * noise or a disclosure — a customer does not need to read that we are behind
 * on paying people. `everyone` is the third value rather than the default, so
 * the question is answered rather than skipped.
 *
 * ONE LIST WRITTEN TWICE with `announcements`' own check constraint, so
 * `tests/db/announcements.test.ts` reads `pg_constraint` and compares the two.
 * A value offered by the form that the column refuses would lose the banner in
 * the same statement that wrote it.
 */
export const ANNOUNCEMENT_AUDIENCES = [
  "customer",
  "provider",
  "everyone",
] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/**
 * How loud it is.
 *
 * TWO LEVELS AND DELIBERATELY NOT FOUR. `notice` is ordinary information and
 * `urgent` is a thing somebody must know today. A four-level scale invites a
 * middle nobody can define, and every level beyond the first that renders in a
 * warning colour makes the real one quieter — `/admin/signals`' reasoning
 * about grading, applied to a colour instead of a number.
 */
export const ANNOUNCEMENT_TONES = ["notice", "urgent"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

/**
 * Who is reading. Not the same type as the audience: a READER is one of two
 * halves of the product, and `everyone` is a thing a banner can be rather than
 * a person who can be looking at one.
 */
export type AnnouncementViewer = "customer" | "provider";

/**
 * How long a banner may be.
 *
 * ONE SENTENCE, AND THE BOUND IS PRINTED ABOVE THE BOX rather than found by
 * tripping it — `statedBandRefusal`'s rule, and `/providers/standards`'
 * argument that deterrence nobody can read is not deterrence. A banner sits
 * above every page on a phone; three paragraphs there pushes the product off
 * the screen, and the answer to "there is more to say" is a page with a link
 * to it, not a longer banner.
 *
 * ENFORCED IN THE WRITER AND DELIBERATELY NOT BY A CHECK CONSTRAINT, which is
 * the one place this file departs from "one list written twice, and a test
 * compares them". The column refuses a BLANK body because both languages or
 * nothing is an integrity rule — rule 5, and a one-sided banner is a bug
 * whatever the design does. A length is a layout judgement: it moves when the
 * banner is restyled, and freezing it into the database would mean a migration
 * to let a slightly longer sentence through.
 */
export const ANNOUNCEMENT_BODY_MAX = 240;

export type Announcement = {
  id: string;
  bodyEn: string;
  bodyNe: string;
  audience: AnnouncementAudience;
  tone: AnnouncementTone;
  /** ISO. The window it was MEANT to show in. */
  startsAt: string;
  /** ISO, or null — "until somebody takes it down". */
  endsAt: string | null;
  /** The kill switch, separate from the window. See `showingNow`. */
  enabled: boolean;
};

/**
 * Is this banner showing, to this reader, right now?
 *
 * THE WINDOW AND THE SWITCH ARE DIFFERENT FACTS, deliberately, where
 * `categories` needed `is_active` and `retired_at` tied by a constraint. There
 * the pair was one fact in two columns; here they are two: the window is when
 * somebody MEANT it to show, and `enabled` is somebody taking it down now. A
 * banner switched off inside its window is a real state — the outage ended
 * early, or the sentence was wrong — and collapsing them would lose which of
 * the two happened. Both have to be true to render.
 *
 * `endsAt` NULL IS "UNTIL SOMEBODY TAKES IT DOWN", never "for ever by
 * accident", and `/admin/announcements` prints that in those words: a banner
 * with an end date stops by itself and one without needs somebody to remember.
 * A threshold people can only find by tripping it is the trap
 * `offTopicConsequence` refuses, and so is a banner nobody can tell will never
 * stop.
 *
 * THE END IS EXCLUSIVE AND THE START IS INCLUSIVE, which is the same half-open
 * interval `isPayoutRunDay` and `freeze_booking_band` use, and it is what makes
 * two banners handed over at the same instant not both show.
 */
export function showingNow(
  announcement: Announcement,
  at: { now: Date; viewer: AnnouncementViewer },
): boolean {
  if (!announcement.enabled) return false;

  const start = Date.parse(announcement.startsAt);
  /*
   * AN UNREADABLE STAMP SHOWS NOTHING, which is the `ACKNOWLEDGED_FAILURES`
   * lesson: every comparison with NaN is false, so a bad date silently read as
   * "well inside the window" there and forgave every acknowledgement at once.
   * Here the safe direction is the other way — a banner is something we chose
   * to say, so a row we cannot date is a row we cannot place in time, and the
   * honest answer is not to put it in front of anybody.
   */
  if (Number.isNaN(start)) return false;
  if (start > at.now.getTime()) return false;

  if (announcement.endsAt !== null) {
    const end = Date.parse(announcement.endsAt);
    if (Number.isNaN(end)) return false;
    if (end <= at.now.getTime()) return false;
  }

  return (
    announcement.audience === "everyone" ||
    announcement.audience === at.viewer
  );
}

/**
 * The ONE banner this reader sees, or null.
 *
 * ONE SCREEN SAYS ONE THING. Two banners stacked above a page is two things
 * nobody reads, and the product already settled this argument twice —
 * `attentionFor` returns one call to action per booking because a card with
 * two has none, and `instead` picks a single replacement for the triage card
 * in a stated order. This is that rule for the top of every page.
 *
 * THE ORDER IS STATED RATHER THAN LEFT TO THE QUERY: `urgent` before `notice`,
 * then the most recently started. Tone first because an urgent banner is the
 * one somebody must act on and an ordinary one can wait for the next page;
 * recency second because the newer sentence is the one that knows about the
 * older situation. A tie on both is settled by id, so the answer does not
 * depend on the row order a database happened to return — the same reason
 * `proposalSuppressedBy` compares a pair rather than trusting a sort.
 *
 * NULL IS THE COMMON CASE, and the banner renders nothing for it. There is no
 * "no announcements" state: a sentence saying we have nothing to tell you
 * would be furniture on every page of the product.
 */
export function bannerFor(
  announcements: readonly Announcement[],
  at: { now: Date; viewer: AnnouncementViewer },
): Announcement | null {
  const showing = announcements.filter((one) => showingNow(one, at));
  if (showing.length === 0) return null;

  return showing.reduce((best, one) => {
    if (one.tone !== best.tone) return one.tone === "urgent" ? one : best;

    const a = Date.parse(one.startsAt);
    const b = Date.parse(best.startsAt);
    if (a !== b) return a > b ? one : best;

    return one.id > best.id ? one : best;
  });
}

/**
 * The body in the reader's own language.
 *
 * BOTH COLUMNS ARE NOT NULL, so this never picks between a sentence and a
 * blank — rule 5, and the one place a missing translation is invisible,
 * because a Nepali reader meeting an English banner assumes it was meant that
 * way rather than that somebody forgot. `addArea`'s refusal of a ward with an
 * English name and no Nepali one is the same rule on data; the form and the
 * database both refuse a one-sided banner.
 */
export function announcementBody(
  announcement: Announcement,
  locale: string,
): string {
  return locale === "ne" ? announcement.bodyNe : announcement.bodyEn;
}

/**
 * Is this banner still going to be there tomorrow, and for how long?
 *
 * THREE ANSWERS, because `/admin/announcements` has to tell them apart in
 * words: `showing` is up now, `scheduled` has not started, `over` has either
 * ended or been taken down. The screen reads this rather than re-deriving the
 * window — one rule, so the list cannot disagree with what a visitor sees.
 *
 * IT ASKS `showingNow` FOR BOTH VIEWERS, because the admin list is asking
 * whether the banner is live at all and not whether it is live for the admin
 * reading it. A provider banner is showing even though nobody on this screen
 * can see one.
 */
export function announcementStanding(
  announcement: Announcement,
  now: Date,
): "showing" | "scheduled" | "over" {
  if (
    showingNow(announcement, { now, viewer: "customer" }) ||
    showingNow(announcement, { now, viewer: "provider" })
  ) {
    return "showing";
  }

  const start = Date.parse(announcement.startsAt);
  if (announcement.enabled && !Number.isNaN(start) && start > now.getTime()) {
    return "scheduled";
  }

  return "over";
}

/**
 * `2026-10-25T09:00` from a `datetime-local` box → the ISO instant it means.
 *
 * THE BOX SENDS NO TIMEZONE AND THE SERVER IS UTC, which is a trap worth
 * naming because it is silent and off by exactly the amount nobody would
 * notice until the banner was late. `<input type="datetime-local">` submits a
 * zone-less string; `Date.parse` reads one of those as the RUNTIME's local
 * time, and Vercel runs with `TZ` unset, so an admin in Kathmandu typing 09:00
 * would have published a banner that appeared at 14:45 their own time. Parsing
 * it as Nepal time explicitly is the fix, and the label says "Nepal time" so
 * the assumption is on the screen rather than only in here.
 *
 * `NEPAL_UTC_OFFSET_MINUTES` IS THE SHARED CONSTANT, not a second copy: it is
 * `lib/photos/freshness.ts`'s, which `lib/config/ai-limits.ts` already reads
 * for the same reason — one fixed offset since 1986, used to correct a clock
 * rather than to render a date.
 *
 * THREE ANSWERS, like `stamp` and `categoryQuote`: `null` is an empty box (now,
 * or "until somebody takes it down"), a string is the instant, and `false` is
 * something that is not a date at all. A coerced date is the one outcome
 * refused — `new Date("tomorrow")` is Invalid Date, and a row nobody can place
 * in time is a banner no screen can explain.
 */
export function nepalStampToIso(local: string): string | null | false {
  const value = local.trim();
  if (value.length === 0) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match) return false;

  const [, y, mo, d, h, mi, se] = match;
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se ?? "0"),
  );
  if (Number.isNaN(utc)) return false;

  const at = new Date(utc - NEPAL_UTC_OFFSET_MINUTES * 60_000);
  /*
   * ROUND-TRIPPED RATHER THAN TRUSTED. `Date.UTC` happily accepts month 13 and
   * day 32 and rolls them over, so "2026-13-40T00:00" would become a real
   * instant in 2027 — a date somebody did not type. Comparing the result back
   * against the input is what refuses it, and it is the same shape as
   * `addAreaAction` parsing a ward number rather than rounding it.
   */
  if (isoToNepalStamp(at.toISOString()).slice(0, 16) !== value.slice(0, 16)) {
    return false;
  }
  return at.toISOString();
}

/**
 * The inverse, for putting a stored instant back into a `datetime-local` box.
 *
 * ONE PAIR, AND THE TEST ASSERTS THE ROUND TRIP rather than either half's
 * arithmetic — `prose-text`'s rule. An edit form that rendered the UTC instant
 * into the box would show an admin a time 5h45 earlier than the one they
 * published, and saving it unchanged would move the banner.
 */
export function isoToNepalStamp(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return new Date(at + NEPAL_UTC_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 16);
}
