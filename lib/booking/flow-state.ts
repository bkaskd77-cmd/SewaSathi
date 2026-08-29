/**
 * The booking flow's state, and how it survives a bad connection.
 *
 * Somebody booking an emergency is on a phone, on mobile data, often standing
 * over the thing that is broken. A refresh, a dropped connection or a trip
 * through the login screen must not cost them four screens of input — that is
 * where a funnel dies, and it is the reason this file exists at all.
 *
 * sessionStorage rather than localStorage: the draft belongs to this tab and
 * this sitting. A half-finished booking resurfacing next week, with a time
 * that has passed, would be worse than starting again.
 */

export const FLOW_STEPS = [
  "problem",
  "address",
  "when",
  "provider",
  "review",
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number];

export type Timing = "emergency" | "today" | "scheduled";

export type NewAddressDraft = {
  label: string;
  area: string;
  tole: string;
  landmark: string;
  directionsNote: string;
  saveForNextTime: boolean;
};

export type FlowState = {
  step: FlowStep;
  category: string;
  description: string;
  /** Storage path once uploaded, not a URL. */
  photoPath: string | null;
  addressId: string | null;
  newAddress: NewAddressDraft;
  timing: Timing;
  /** "2026-09-02", Nepal date. */
  day: string;
  /** ISO instant of the chosen window's start. */
  slot: string;
  providerId: string | null;
  /** True when the customer asked us to pick. */
  autoAssign: boolean;
  paymentMethod: "cash" | "esewa" | "khalti";
  triageLogId: string | null;
};

export const STORAGE_KEY = "sajilokaam-booking-draft";

export function emptyAddress(): NewAddressDraft {
  return {
    label: "home",
    area: "",
    tole: "",
    landmark: "",
    directionsNote: "",
    saveForNextTime: true,
  };
}

export function initialState(seed: {
  category?: string | null;
  provider?: string | null;
  urgency?: string | null;
  description?: string | null;
  triageLogId?: string | null;
}): FlowState {
  return {
    step: "problem",
    category: seed.category ?? "",
    description: seed.description ?? "",
    photoPath: null,
    addressId: null,
    newAddress: emptyAddress(),
    // An emergency arriving from triage preselects the emergency timing. The
    // screen says so rather than silently choosing for them.
    timing: seed.urgency === "emergency" ? "emergency" : "today",
    day: "",
    slot: "",
    providerId: seed.provider ?? null,
    autoAssign: !seed.provider,
    paymentMethod: "cash",
    triageLogId: seed.triageLogId ?? null,
  };
}

/**
 * Read a draft back.
 *
 * Anything unreadable is discarded rather than repaired: a half-parsed draft
 * that puts somebody on step four with no address is worse than starting over,
 * and this runs on a device we cannot inspect.
 */
export function loadDraft(): FlowState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FlowState>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!FLOW_STEPS.includes(parsed.step as FlowStep)) return null;
    if (typeof parsed.category !== "string") return null;

    return {
      ...initialState({}),
      ...parsed,
      newAddress: { ...emptyAddress(), ...(parsed.newAddress ?? {}) },
    } as FlowState;
  } catch {
    return null;
  }
}

export function saveDraft(state: FlowState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode, or a full quota. The flow still works for as long as the
    // tab stays open, which is the common case; losing persistence is not a
    // reason to stop somebody booking.
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the draft is superseded either way.
  }
}

/**
 * Whether a step is complete enough to leave.
 *
 * The same rules gate the Next button and the jump-back-to-a-step links, so a
 * customer cannot land on the review screen with a step quietly unfinished.
 * The server validates all of it again regardless.
 */
export function stepComplete(state: FlowState, step: FlowStep): boolean {
  switch (step) {
    case "problem":
      return state.category.length > 0 && state.description.trim().length >= 4;
    case "address":
      if (state.addressId) return true;
      return (
        state.newAddress.area.length > 0 &&
        state.newAddress.tole.trim().length >= 2 &&
        state.newAddress.landmark.trim().length >= 2
      );
    case "when":
      return state.timing !== "scheduled" || state.slot.length > 0;
    case "provider":
      return state.autoAssign || Boolean(state.providerId);
    case "review":
      return true;
  }
}

export function firstIncompleteStep(state: FlowState): FlowStep {
  for (const step of FLOW_STEPS) {
    if (!stepComplete(state, step)) return step;
  }
  return "review";
}
