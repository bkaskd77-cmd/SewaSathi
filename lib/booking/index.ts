/**
 * The booking module's public surface.
 *
 * Everything outside `lib/booking/` imports from here, enforced by
 * `no-restricted-imports` in .eslintrc.json. That is the containment: the
 * status table can be restructured, the draft can move off sessionStorage, the
 * slot maths can grow a timezone library — and nothing outside this folder has
 * to change, because nothing outside was ever allowed to reach in.
 *
 * Adding an export here is a deliberate widening of that surface. Prefer
 * keeping a helper internal until a second caller genuinely needs it.
 */
export {
  BOOKING_PROGRESS,
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  canTransition,
  customerCanCancel,
  isBookingStatus,
  isTerminal,
  progressIndex,
  type BookingStatus,
} from "./status";

export {
  bookableDays,
  formatSlotInstant,
  isValidSlot,
  slotLabel,
  slotsForDay,
  WORKING_HOURS,
  type Slot,
} from "./schedule";

export {
  clearDraft,
  emptyAddress,
  firstIncompleteStep,
  FLOW_STEPS,
  initialState,
  loadDraft,
  saveDraft,
  STORAGE_KEY,
  stepComplete,
  type FlowState,
  type FlowStep,
  type NewAddressDraft,
  type Timing,
} from "./flow-state";
