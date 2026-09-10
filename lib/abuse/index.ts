/**
 * The abuse module's public surface.
 *
 * Isomorphic. The booking screen has to be able to say why a deposit is being
 * asked for before somebody reaches the payment step, and a rule that only
 * exists on the server can only ever say no after the fact.
 */

export {
  SMS_BUDGET,
  judgeSmsSend,
  smsBudgetAlert,
  type SmsAlert,
  type SmsSendVerdict,
} from "./sms-budget";

export {
  BOOKING_LIMITS,
  CUSTOMER_LADDER,
  concurrentBookingCap,
  gateBooking,
  judgeBookingRisk,
  judgeCustomerLadder,
  type BookingGate,
  type BookingRiskVerdict,
  type BookingSignals,
  type CustomerHistory,
  type LadderStep,
  type LadderVerdict,
} from "./customer";
