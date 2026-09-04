/**
 * When work can be booked for.
 *
 * Working hours are one constant. Every screen that offers a time, and the
 * server-side check that rejects one, read it from here — a slot list and a
 * validator that disagree is how a customer gets to pick a time that is then
 * refused.
 *
 * Nepal Time is UTC+05:45. The offset is fixed — Nepal has no daylight saving
 * — which is why this can be arithmetic rather than a timezone library. That
 * assumption is stated because it is the kind of thing that quietly becomes
 * wrong: if this product ever serves a second timezone, this file is where it
 * breaks and where it should be fixed.
 */

/** Minutes east of UTC. Nepal Time, fixed year-round. */
export const NPT_OFFSET_MINUTES = 5 * 60 + 45;

export const WORKING_HOURS = {
  /** First window starts at 07:00 NPT. */
  startHour: 7,
  /** Last window *starts* at 19:00, so work ends by 21:00. */
  lastStartHour: 19,
  /** Slots are two hours wide. */
  slotHours: 2,
  /** How far ahead a customer may book. */
  horizonDays: 14,
  /**
   * A scheduled slot has to be far enough out that somebody can actually get
   * there. Anything sooner is what "emergency" and "today" are for.
   */
  leadMinutes: 90,
} as const;

export type Slot = {
  /** ISO instant of the window's start. */
  start: string;
  /** ISO instant of the window's end. */
  end: string;
  /** 0-23, in Nepal Time. */
  startHour: number;
  endHour: number;
};

/** The wall-clock date in Nepal, for an instant. */
function nptParts(date: Date): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
} {
  const shifted = new Date(date.getTime() + NPT_OFFSET_MINUTES * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    // Minutes matter for an instant, never for a slot — slots start on the
    // hour by construction.
    min: shifted.getUTCMinutes(),
  };
}

/** The instant at which a given Nepal wall-clock hour occurs. */
function nptInstant(y: number, m: number, d: number, hour: number): Date {
  return new Date(
    Date.UTC(y, m, d, hour, 0, 0, 0) - NPT_OFFSET_MINUTES * 60_000,
  );
}

/** Midnight-to-midnight Nepal days, starting today. */
export function bookableDays(now: Date = new Date()): Array<{
  /** "2026-09-02", the Nepal date — what a <select> carries. */
  value: string;
  /** Days from today: 0 is today. */
  offset: number;
}> {
  const today = nptParts(now);
  const days = [];
  for (let offset = 0; offset < WORKING_HOURS.horizonDays; offset += 1) {
    const day = new Date(Date.UTC(today.y, today.m, today.d + offset));
    days.push({
      value: `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`,
      offset,
    });
  }
  return days;
}

/**
 * The windows still bookable on a given Nepal date.
 *
 * Returns an empty list rather than throwing for a day in the past or beyond
 * the horizon: the caller is rendering a list, and an empty list renders as
 * "nothing left today", which is the truth.
 */
export function slotsForDay(day: string, now: Date = new Date()): Slot[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return [];

  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);

  const earliest = now.getTime() + WORKING_HOURS.leadMinutes * 60_000;
  const latest =
    now.getTime() + WORKING_HOURS.horizonDays * 24 * 60 * 60_000;

  const slots: Slot[] = [];
  for (
    let hour = WORKING_HOURS.startHour;
    hour <= WORKING_HOURS.lastStartHour;
    hour += WORKING_HOURS.slotHours
  ) {
    const start = nptInstant(y, m, d, hour);
    if (start.getTime() < earliest) continue;
    if (start.getTime() > latest) continue;

    const end = new Date(
      start.getTime() + WORKING_HOURS.slotHours * 60 * 60_000,
    );
    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      startHour: hour,
      endHour: hour + WORKING_HOURS.slotHours,
    });
  }
  return slots;
}

/**
 * Is this instant a slot we would have offered?
 *
 * The server-side half of the same rule. It re-derives the day's slots rather
 * than checking the hour in isolation, so "inside working hours" and "not in
 * the past" cannot drift apart.
 */
export function isValidSlot(iso: string, now: Date = new Date()): boolean {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return false;

  const parts = nptParts(when);
  const day = `${parts.y}-${String(parts.m + 1).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;

  return slotsForDay(day, now).some((slot) => slot.start === when.toISOString());
}

/** "07:00 – 09:00". Latin digits in both locales, as the number rule says. */
export function slotLabel(slot: Slot): string {
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${pad(slot.startHour)} – ${pad(slot.endHour)}`;
}

/**
 * "2026-09-02 · 11:00 – 13:00", in Nepal Time.
 *
 * A stored instant is UTC. Rendering it with `toISOString()` shows a reader in
 * Kathmandu a time 5h45m earlier than the one they booked, which is the kind
 * of bug that looks like a typo and costs somebody a morning.
 */
export function formatSlotInstant(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;

  const parts = nptParts(when);
  const end = (parts.h + WORKING_HOURS.slotHours) % 24;
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${parts.y}-${pad(parts.m + 1)}-${pad(parts.d)} · ${pad(parts.h)}:00 – ${pad(end)}:00`;
}

/** Month names, both languages. Short enough not to need a formatter. */
const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ne: ["जनवरी", "फेब्रुअरी", "मार्च", "अप्रिल", "मे", "जुन", "जुलाई", "अगस्ट", "सेप्टेम्बर", "अक्टोबर", "नोभेम्बर", "डिसेम्बर"],
} as const;

/**
 * "4 Sep 2026, 4:32 pm" — a moment, not a window.
 *
 * `formatSlotInstant` renders a booking *slot*, so it prints a two-hour range
 * and an ISO-shaped date. Passing a settlement time through it produced
 * "Paid on 2026-09-04 · 16:00 – 18:00", which states an hour the payment did
 * not happen and a range that means nothing for an event. A payment has a
 * moment; this is that.
 *
 * Nepal Time, like everything else here. Latin digits in both languages: the
 * reader may need to match this against a bank statement or a gateway's own
 * receipt, and neither of those is in Devanagari.
 */
export function formatInstant(iso: string, locale: "en" | "ne" = "en"): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;

  const parts = nptParts(when);
  const hour12 = parts.h % 12 === 0 ? 12 : parts.h % 12;
  const suffix = parts.h < 12 ? "am" : "pm";
  const minute = String(parts.min).padStart(2, "0");
  const month = MONTHS[locale][parts.m];

  return `${parts.d} ${month} ${parts.y}, ${hour12}:${minute} ${suffix}`;
}
