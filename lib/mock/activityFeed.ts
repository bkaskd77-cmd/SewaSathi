/**
 * MOCK DATA — replaced in Phase 8 by a Supabase realtime subscription on the
 * bookings table, filtered to the viewer's city and stripped of surnames.
 * The shape below is what that subscription should map to, so the ticker
 * component does not have to change.
 *
 * Names and wards are invented. Nothing here is a real booking.
 *
 * The sentence is not built here. English puts the verb last-but-one and
 * Nepali puts it last, so "{name} in {area} booked X" has no shape that can be
 * assembled from parts in both — the whole line lives in the `activity`
 * namespace and this file supplies only the values that go into it. When the
 * realtime subscription replaces this, it maps a booking to an `actionKey` the
 * same way.
 */
export type ActivityEntry = {
  id: string;
  /** First name only — we never surface a full customer name publicly. */
  name: string;
  nameNe: string;
  /** Ward or neighbourhood, the way people actually give directions here. */
  area: string;
  areaNe: string;
  /** Key into the `activity` message namespace. */
  actionKey: string;
  minutesAgo: number;
};

export const ACTIVITY_FEED: ActivityEntry[] = [
  {
    id: "a1",
    name: "Priya",
    nameNe: "प्रिया",
    area: "Baneshwor",
    areaNe: "बानेश्वर",
    actionKey: "cleaning",
    minutesAgo: 3,
  },
  {
    id: "a2",
    name: "Suresh",
    nameNe: "सुरेश",
    area: "Patan",
    areaNe: "पाटन",
    actionKey: "plumberArrived",
    minutesAgo: 12,
  },
  {
    id: "a3",
    name: "Anita",
    nameNe: "अनिता",
    area: "Bhaktapur",
    areaNe: "भक्तपुर",
    actionKey: "electrician",
    minutesAgo: 18,
  },
  {
    id: "a4",
    name: "Bikash",
    nameNe: "विकास",
    area: "Chabahil",
    areaNe: "चाबहिल",
    actionKey: "acDone",
    minutesAgo: 26,
  },
  {
    id: "a5",
    name: "Sunita",
    nameNe: "सुनिता",
    area: "Kirtipur",
    areaNe: "कीर्तिपुर",
    actionKey: "pestControl",
    minutesAgo: 34,
  },
  {
    id: "a6",
    name: "Rajesh",
    nameNe: "राजेश",
    area: "Jhamsikhel",
    areaNe: "झम्सिखेल",
    actionKey: "ratedCarpenter",
    minutesAgo: 41,
  },
];
