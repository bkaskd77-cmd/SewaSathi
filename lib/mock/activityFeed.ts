/**
 * MOCK DATA — replaced in Phase 8 by a Supabase realtime subscription on the
 * bookings table, filtered to the viewer's city and stripped of surnames.
 * The shape below is what that subscription should map to, so the ticker
 * component does not have to change.
 *
 * Names and wards are invented. Nothing here is a real booking.
 */
export type ActivityEntry = {
  id: string;
  /** First name only — we never surface a full customer name publicly. */
  name: string;
  /** Ward or neighbourhood, the way people actually give directions here. */
  area: string;
  action: string;
  minutesAgo: number;
};

export const ACTIVITY_FEED: ActivityEntry[] = [
  {
    id: "a1",
    name: "Priya",
    area: "Baneshwor",
    action: "booked a home cleaning",
    minutesAgo: 3,
  },
  {
    id: "a2",
    name: "Suresh",
    area: "Patan",
    action: "'s plumber arrived",
    minutesAgo: 12,
  },
  {
    id: "a3",
    name: "Anita",
    area: "Bhaktapur",
    action: "booked an electrician",
    minutesAgo: 18,
  },
  {
    id: "a4",
    name: "Bikash",
    area: "Chabahil",
    action: "'s AC servicing was completed",
    minutesAgo: 26,
  },
  {
    id: "a5",
    name: "Sunita",
    area: "Kirtipur",
    action: "booked pest control",
    minutesAgo: 34,
  },
  {
    id: "a6",
    name: "Rajesh",
    area: "Jhamsikhel",
    action: "rated a carpenter 5 stars",
    minutesAgo: 41,
  },
];

export function formatActivity(entry: ActivityEntry): string {
  const connector = entry.action.startsWith("'") ? "" : " ";
  return `${entry.name} in ${entry.area}${connector}${entry.action} — ${entry.minutesAgo} min ago`;
}
