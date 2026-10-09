/**
 * What a photograph sent with a guarantee claim is allowed to be, and what it is
 * allowed to do.
 *
 * WHY THIS IS STRICTER THAN EVERY OTHER PHOTOGRAPH IN THE PRODUCT. A triage photograph
 * is looked at and discarded. A booking photograph helps somebody bring the right
 * parts, and a misleading one is corrected by the person standing in the room — which
 * is why both are flag-only and refuse nothing. This one is evidence in an argument
 * about money: the ladder ends in a cash refund capped at what the job settled at,
 * funded from a professional's future earnings. The cheapest fabrication available in
 * this product is a photograph of somebody else's leak, and the second cheapest is last
 * month's photograph of your own.
 *
 * THREE REFUSALS AND THREE DOUBTS, AND THE LINE BETWEEN THEM IS WHETHER AN HONEST
 * PERSON CAN LAND THERE.
 *
 *   A refusal is a fact about the file that no honest claim needs: it carries no camera
 *   clock at all, we have had the same picture on another job, or its clock says it was
 *   taken before the work finished. None of those can be a photograph of this job
 *   failing, so none of them is stored — `guarantee_claim_photos` will not hold them.
 *   The customer is told which one it was and can send another; nothing is lost but the
 *   file.
 *
 *   A doubt is something an honest person reaches often enough that refusing it would
 *   refuse real claims: a phone clock set wrongly by a week, a picture close to one we
 *   already hold, a picture close to the one they sent with the booking. Those are
 *   stored with their evidence, shown to the person deciding, and they move the claim to
 *   the route the guarantee was always meant to take — somebody goes and looks.
 *
 * NOTHING HERE SCORES ANYBODY. There is no total, no threshold and no grade. Each answer
 * is a named judgement with its own sentence, which is what lets a reviewer disagree
 * with it. `maxFailedChecksPerPeriod` is the one number that could become a rule and it
 * is null — see its own note.
 *
 * Pure and dependency-free, the same posture as `lib/payments/pricing.ts` and
 * `lib/config/guarantee.ts`: it decides money, so it has to be readable in one screen
 * and testable without a database.
 */

import type { ClaimVerdict } from "@/lib/config/guarantee";
import type { DuplicateVerdict } from "@/lib/photos/duplicate";
import type { FreshnessVerdict } from "@/lib/photos/freshness";

/**
 * How long a claim photograph's own clock may put it before the claim.
 *
 * SEVEN DAYS, AND IT IS THE CUSTOMER'S ANSWER TO ITS OWN QUESTION. A fault noticed on
 * Monday and reported on Friday is ordinary; a photograph from five weeks ago attached
 * to a claim filed today is a different thing, whether the fault is real or not —
 * because the window it has to sit inside is the job's guarantee window, and a
 * photograph older than the claim cannot tell us when the fault appeared.
 *
 * GENEROUS RATHER THAN TIGHT, for the same reason the arrival window is: the cost of
 * being wrong is a claim going to a person to look at instead of being decided on
 * paperwork, which is the route the guarantee was always meant to take anyway.
 */
export const CLAIM_FRESHNESS_WINDOW_DAYS = 7;

/** The same number in the unit `judgeFreshness` takes. */
export const CLAIM_FRESHNESS_WINDOW_MINUTES = CLAIM_FRESHNESS_WINDOW_DAYS * 24 * 60;

/** How many photographs one claim may carry. The slot key in SQL is what enforces it. */
export const MAX_CLAIM_PHOTOS = 3;

/**
 * How many refused photographs from one account, in a period, would mean something.
 *
 * NULL AND UNARMED, the `maxPaidClaimsPerPeriod` and `arrearsPauseRupees` shape. Two
 * claims exist in the whole history of this product and no photograph has ever been
 * refused, so any number here would be a guess frozen into the codebase as a standard —
 * and guessing low means a customer whose phone clock is wrong gets treated as a
 * fraudster. The count is kept and shown; nothing acts on it until somebody sets this.
 */
export const maxFailedChecksPerPeriod: number | null = null;

/** The window the count above would be read over, once there is a number to read. */
export const FAILED_CHECK_PERIOD_DAYS = 30;

/** A fact about the file that no honest claim needs. The photograph is not stored. */
export type EvidenceRefusal =
  /** We have had this same picture on another job or another account. */
  | "alreadySent"
  /** Its clock puts it before the work finished, so it cannot show that work failing. */
  | "beforeTheJob"
  /** No camera clock at all: a screenshot, a download, or a file an app re-encoded. */
  | "noCameraTime"
  /** We could not establish the order of the two events. Not checked is not clean. */
  | "notChecked";

/** Something an honest person reaches often enough that refusing it would refuse them. */
export type EvidenceDoubt =
  /** The camera clock puts it outside the claim window. */
  | "stale"
  /** Close to a photograph we already hold, without being the same one. */
  | "nearDuplicate"
  /** Close to a photograph sent with the original booking. */
  | "sameAsBooking";

/** What `booking_photo_match` holds. Only `same-picture` is a doubt. */
export type BookingPhotoMatch =
  | "same-picture"
  | "different-picture"
  /** The booking carried no photographs. Our gap, not theirs — never a doubt. */
  | "no-reference"
  | "not-compared";

export type EvidenceJudgement =
  | { kind: "refused"; reason: EvidenceRefusal }
  | {
      kind: "accepted";
      doubts: EvidenceDoubt[];
      /** Exactly what goes in the row, so no caller re-derives a column. */
      row: {
        duplicateVerdict: "unseen" | "retry" | "flag" | "not-compared";
        duplicateDistance: number | null;
        freshnessVerdict: "fresh" | "stale";
        bookingPhotoMatch: BookingPhotoMatch;
      };
    };

/**
 * Judge one photograph offered as claim evidence.
 *
 * THE ORDER IS BY HOW SPECIFIC THE FINDING IS, not by how bad it is. "We have had this
 * photograph before" names something we can point at; "there is no camera data in this
 * file" is the one an honest person hits by accident and is the most useful sentence to
 * end on, because it is the one they can fix by opening the camera. A photograph that
 * trips two refusals is reported by the first, and the others are not evidence of
 * anything extra.
 *
 * `notChecked` IS A REFUSAL AND THAT IS RULE 6 POINTING THE ONLY WAY IT CAN POINT HERE.
 * If the capture time is present but the job's completion is not on record, we have not
 * established that this photograph could show the work failing — and a column saying we
 * had would be manufactured. It is our failure rather than theirs, so the sentence says
 * so and says to try again; it is not counted against anybody.
 */
export function judgeClaimEvidence(input: {
  duplicate: DuplicateVerdict;
  freshness: FreshnessVerdict;
  /** `takenBeforeCompletion`'s answer. Null is "could not be established". */
  takenBeforeCompletion: boolean | null;
  bookingPhotoMatch: BookingPhotoMatch;
}): EvidenceJudgement {
  if (input.duplicate.kind === "reject") {
    return { kind: "refused", reason: "alreadySent" };
  }
  if (input.takenBeforeCompletion === true) {
    return { kind: "refused", reason: "beforeTheJob" };
  }
  if (
    input.freshness === "no-capture-time" ||
    input.freshness === "not-checked"
  ) {
    return { kind: "refused", reason: "noCameraTime" };
  }
  if (input.takenBeforeCompletion === null) {
    return { kind: "refused", reason: "notChecked" };
  }

  const doubts: EvidenceDoubt[] = [];
  if (input.freshness === "stale") doubts.push("stale");
  if (input.duplicate.kind === "flag") doubts.push("nearDuplicate");
  if (input.bookingPhotoMatch === "same-picture") doubts.push("sameAsBooking");

  return {
    kind: "accepted",
    doubts,
    row: {
      duplicateVerdict: input.duplicate.kind,
      duplicateDistance:
        "distance" in input.duplicate ? input.duplicate.distance : null,
      freshnessVerdict: input.freshness,
      bookingPhotoMatch: input.bookingPhotoMatch,
    },
  };
}

/**
 * The doubts a stored row carries, read back from the columns.
 *
 * ONE READER FOR THE ROW AND ONE JUDGE FOR THE FILE, because the two happen at
 * different times and a second opinion between them is how a screen and a trigger come
 * to disagree. `enforce_claim_refund` runs this same list in SQL, and
 * `tests/db/claim-evidence.test.ts` puts one fixture through both.
 */
export function doubtsOnRow(row: {
  duplicateVerdict: string | null;
  freshnessVerdict: string | null;
  bookingPhotoMatch: string | null;
}): EvidenceDoubt[] {
  const doubts: EvidenceDoubt[] = [];
  if (row.freshnessVerdict === "stale") doubts.push("stale");
  if (row.duplicateVerdict === "flag") doubts.push("nearDuplicate");
  if (row.bookingPhotoMatch === "same-picture") doubts.push("sameAsBooking");
  return doubts;
}

export type InspectionGate = {
  /** True when money back needs the in-person verdict before anything else. */
  required: boolean;
  /** Why, so the screen names it rather than saying no. Empty when not required. */
  doubts: EvidenceDoubt[];
};

/**
 * May a cash refund be decided on this claim yet?
 *
 * THE GATE IS NARROW ON PURPOSE AND THE BREADTH WAS THE DECISION. The tempting version
 * is "a refund always needs the in-person verdict", which is already what
 * `/admin/guarantee-claims` offers — its queue reads only `resolved` claims with a
 * `sameFault` verdict. But `issueRefund` is a server action and a public POST, and
 * neither it nor `enforce_claim_refund` checked either of those, so the queue was
 * stricter than the rule for the whole life of the feature. Putting the unconditional
 * version in the database would also foreclose a case the product may well need later —
 * nobody will attend, and support decides to pay back anyway.
 *
 * So the rule is conditional on the doubt existing, which has no legitimate exception:
 * a photograph we have reason to question cannot be what a refund rests on, and the
 * remedy is the one the guarantee already promises — somebody goes and looks. A claim
 * with no photograph is unaffected, which is how it behaved before this existed.
 *
 * AND THE ASYMMETRY IS NOT PERVERSE, though it reads that way at first: attaching
 * nothing leaves the decision where it was, attaching a questionable photograph makes it
 * harder. A doubtful photograph is positive evidence of doubt, where no photograph is
 * evidence of nothing. The three refusals are what keep the clearly-bad ones from ever
 * being attached, so nobody is penalised for a file we would have refused outright.
 */
export function inspectionRequired(input: {
  /** Every doubt across the claim's photographs. */
  doubts: EvidenceDoubt[];
  verdict: ClaimVerdict | null;
  /** The claim's own status. Only `resolved` has been through a visit. */
  status: string;
}): InspectionGate {
  if (input.doubts.length === 0) return { required: false, doubts: [] };

  const inspected = input.status === "resolved" && input.verdict === "sameFault";
  return inspected
    ? { required: false, doubts: [] }
    : { required: true, doubts: Array.from(new Set(input.doubts)) };
}
