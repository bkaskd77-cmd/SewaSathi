export type { Database, Json } from "./supabase";

/**
 * Service categories Sewa[X] launches with. The union is the source of truth
 * for the UI; the database enum added in a later phase must mirror it.
 */
export const SERVICE_CATEGORIES = [
  "plumbing",
  "electrical",
  "cleaning",
  "appliance-repair",
  "carpentry",
  "pest-control",
  "painting",
  "ac-servicing",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** How soon a customer needs someone on site. Drives pricing and dispatch. */
export type Urgency = "emergency" | "same-day" | "scheduled";
