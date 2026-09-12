"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import { getSessionProfile } from "@/lib/auth/session";
import {
  addReference,
  recordConsent,
  saveStep,
  startApplication,
  type StepPatch,
} from "@/lib/data/applications";
import { uploadProviderDocument } from "@/lib/data/provider-documents";
import { sealApplication } from "@/lib/data/verification";
import { checkRateLimit } from "@/lib/server/rate-limit";

/**
 * Everything the application form posts to.
 *
 * SERVER ACTIONS, and every one of them re-reads the session rather than
 * taking an id from the form. A hidden `applicationId` field is a value the
 * browser controls; the ownership check happens in the data layer against the
 * session's own profile, so a forged id reaches somebody else's row and is
 * refused there.
 *
 * PLAIN FORMS WHERE POSSIBLE. Next wires a `<form action={…}>` to these
 * without JavaScript having finished loading, which is the right default for a
 * tradesperson on a cheap phone on a slow connection. Only the camera step
 * needs a client component, because reading pixels needs a canvas.
 */

export type ApplyResult =
  | { ok: true; step?: number }
  | { ok: false; error: string };

/**
 * Each upload rejection, said in a way somebody can act on.
 *
 * The split that matters is "the photograph" versus "us": a person whose
 * picture is too big can retake it and succeed, and telling them to "try
 * again" wastes their data doing the same thing. A person who hit a storage
 * failure cannot fix it however many times they try.
 */
const UPLOAD_ERRORS: Record<string, string> = {
  consentFirst: "consentFirst",
  notYours: "notYours",
  locked: "locked",
  tooLarge: "photoTooLarge",
  notAnImage: "photoNotAnImage",
  unsupportedFormat: "photoWrongFormat",
  tooManyPixels: "photoTooLarge",
  corrupt: "photoCorrupt",
  uploadFailed: "generic",
};

async function actor(): Promise<string | null> {
  const profile = await getSessionProfile();
  return profile?.id ?? null;
}

function refresh() {
  revalidatePath("/[locale]/(app)/providers/apply", "page");
}

/**
 * Begin, or pick up the one already open. Idempotent on a double tap.
 *
 * Returns nothing, because it is bound to a plain `<form action={…}>` in a
 * Server Component — the shape Next wires up before JavaScript has finished
 * loading, which is the point for this audience. There is nothing to report:
 * either a draft now exists and the page re-renders onto step one, or it does
 * not and the same intro screen comes back.
 */
export async function startAction(): Promise<void> {
  const actorId = await actor();
  if (!actorId) return;

  const locale = await getLocale();
  await startApplication(actorId, locale);
  refresh();
}

/** Record consent before a single document is asked for. */
export async function consentAction(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "notYours" };

  if (formData.get("agree") !== "on") {
    return { ok: false, error: "mustAgree" };
  }

  const applicationId = String(formData.get("applicationId") ?? "");
  const ok = await recordConsent({ applicationId, actorId });
  if (!ok) return { ok: false, error: "generic" };

  await saveStep({ applicationId, actorId, step: 2, patch: {} });
  refresh();
  return { ok: true, step: 2 };
}

/**
 * Save one step.
 *
 * The step number comes from the form because the form knows which one it is;
 * `saveStep` clamps it and never decrements, so a replayed or edited value
 * cannot move somebody backwards or past the end.
 */
export async function saveStepAction(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "notYours" };

  const value = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw.trim() : "";
  };
  const many = (key: string) =>
    formData.getAll(key).map(String).filter(Boolean);

  const applicationId = value("applicationId");
  const step = Number(value("step")) || 1;

  /*
   * A STEP THAT ASKS A REQUIRED QUESTION MUST NOT LET YOU PAST IT.
   *
   * The trades step ticked nothing by default and advanced regardless, so an
   * applicant could walk the whole form and only discover on the review screen
   * that a step they thought they had finished was empty. Worse, the trade is
   * what decides which documents are asked for — `documentsFor` reads it — so
   * an empty answer produced a shorter document list and an application that
   * looked complete while missing the competence evidence for the work.
   *
   * Enforced here rather than with `required` on the checkboxes, because a
   * `required` checkbox in a group only forces *that* box, and because the
   * server is where a value has to be true regardless of what the browser did.
   *
   * `serviceAreas` is the same shape of question and gets the same rule: a
   * professional who serves nowhere cannot be dispatched to anything.
   */
  const REQUIRED_ON_STEP: Record<number, { field: string; error: string }> = {
    3: { field: "trades", error: "pickATrade" },
    4: { field: "serviceAreas", error: "pickAnArea" },
  };

  const required = REQUIRED_ON_STEP[step];
  if (required && many(required.field).length === 0) {
    return { ok: false, error: required.error };
  }

  const patch: StepPatch = {};
  if (value("fullName")) patch.fullName = value("fullName");
  if (value("fullNameNe")) patch.fullNameNe = value("fullNameNe");
  if (value("dateOfBirth")) patch.dateOfBirth = value("dateOfBirth");
  if (value("citizenshipNumber")) {
    patch.citizenshipNumber = value("citizenshipNumber");
  }
  if (value("panNumber")) patch.panNumber = value("panNumber");
  if (many("trades").length > 0) patch.trades = many("trades");
  if (value("yearsExperience")) {
    patch.yearsExperience = Number(value("yearsExperience"));
  }
  if (many("serviceAreas").length > 0) patch.serviceAreas = many("serviceAreas");
  if (value("payoutMethod")) patch.payoutMethod = value("payoutMethod");
  if (value("payoutAccount")) patch.payoutAccount = value("payoutAccount");
  if (value("payoutBankName")) patch.payoutBankName = value("payoutBankName");
  if (value("deviceFingerprint")) {
    patch.deviceFingerprint = value("deviceFingerprint");
  }

  const result = await saveStep({
    applicationId,
    actorId,
    step: step + 1,
    patch,
  });

  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, step: result.step };
}

export async function addReferenceAction(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "notYours" };

  const ok = await addReference({
    applicationId: String(formData.get("applicationId") ?? ""),
    actorId,
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    relationship: String(formData.get("relationship") ?? "other"),
  });

  if (!ok) return { ok: false, error: "generic" };
  refresh();
  return { ok: true };
}

/**
 * Take one photographed document.
 *
 * RATE LIMITED, because this is the one authenticated path in the product that
 * accepts megabytes. The ceiling is per person and generous — somebody
 * retaking a blurry citizenship certificate five times is normal — and it is
 * there to stop a script rather than a person.
 */
export async function uploadDocumentAction(input: {
  applicationId: string;
  kind: string;
  base64: string;
  captureQuality?: number;
  expiresOn?: string | null;
}): Promise<ApplyResult> {
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "notYours" };

  const limit = await checkRateLimit("document:upload", actorId);
  if (!limit.ok) return { ok: false, error: "tooManyRequests" };

  const result = await uploadProviderDocument({ ...input, actorId });
  if (!result.ok) {
    /*
     * THE REASON IS PASSED THROUGH, NOT FLATTENED TO "generic".
     *
     * Eight distinct rejections all rendered as "That did not save. Try
     * again." — a sentence that is true of every one of them and useful for
     * none. An applicant whose photograph was simply too big was told the same
     * thing as one hitting a bug, and both were told to do the one thing that
     * could not help: try again.
     *
     * It also cost real debugging time on the outage that prompted this: the
     * screen could not say whether the file was rejected, the storage write
     * failed, or the row insert did, so the answer had to come from reading
     * the database instead.
     *
     * Anything not in the catalogue still falls back to `generic`, because an
     * untranslated key renders as its own dotted path.
     */
    return { ok: false, error: UPLOAD_ERRORS[result.reason] ?? "generic" };
  }

  refresh();
  return { ok: true };
}

/**
 * Submit.
 *
 * This is where the match keys are computed and written, so it is the moment
 * the application becomes comparable against every prior one — including the
 * rejected and removed. `sealApplication` re-reads ownership and flips the
 * status itself; nothing about that is the browser's to decide.
 */
export async function submitAction(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "notYours" };

  const forwarded = headers().get("x-forwarded-for");
  const limit = await checkRateLimit(
    "join",
    forwarded?.split(",")[0]?.trim() || actorId,
  );
  if (!limit.ok) return { ok: false, error: "tooManyRequests" };

  const result = await sealApplication({
    applicationId: String(formData.get("applicationId") ?? ""),
    actorId,
  });

  if (!result.ok) return { ok: false, error: "generic" };
  refresh();
  return { ok: true };
}
