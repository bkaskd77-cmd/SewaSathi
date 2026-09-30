import "server-only";

import { recordDestinationAccess } from "@/lib/audit";
import { REAUTH_WINDOW_MINUTES } from "@/lib/config/payout-policy";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import {
  destinationReadiness,
  destinationUsableFrom,
  maskAccountRef,
  type DestinationReadiness,
} from "@/lib/payments";
import { openSecret, sealSecret } from "@/lib/security/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where a professional's money goes — the only code that reads or writes it.
 *
 * SERVICE ROLE, AND THE SAME STANDING AS `lib/data/payments.ts`. `anon` and
 * `authenticated` are revoked outright on `payout_destinations`, so there is no
 * policy to lean on and no second path: a read that does not come through this
 * file does not happen. Treat an edit here the way you would treat shared code.
 *
 * THE ACTOR COMES FROM THE SESSION. `changeDestination` takes a `profileId` and
 * resolves the listing itself; it never accepts a `providerId`. Three
 * authorization holes have been found in this product and all three were the
 * same shape — an id arrived from a browser and nothing asked whose it was. The
 * id that would arrive here names the account somebody's earnings are paid into.
 *
 * NOTHING HERE RETURNS PLAINTEXT EXCEPT `revealDestination`, which writes an
 * audit row before it opens the envelope. Everything else masks. That is not
 * defence in depth for its own sake: the professional already knows their own
 * account number, so showing it to them in full adds nothing and puts it in a
 * response, a cache, a screenshot and a log.
 */

export type MaskedDestination = {
  id: string;
  kind: "bank" | "esewa" | "khalti";
  /** `••••4821`. `maskAccountRef` is the only thing that decides how much shows. */
  accountMasked: string;
  accountName: string;
  bankName: string | null;
  createdAt: Date;
  usableFrom: Date;
  firstPayoutConfirmedAt: Date | null;
  /** Asked once here so no surface forms a second opinion about it. */
  readiness: DestinationReadiness;
};

/**
 * A read of the one live destination.
 *
 * THREE STATES, AND THE MIDDLE ONE IS WHY THIS IS NOT A NULLABLE RETURN. "The
 * read failed" and "they have not set one up" lead to opposite sentences —
 * "we can't load this right now, this is us not you" against "tell us where to
 * pay you" — and collapsing them means a database blip asks a professional to
 * re-enter their bank account. Rule 6 in the shape it takes for a screen, the
 * same reasoning as `Readable<T>` in `lib/data/readable.ts`.
 *
 * Not `Readable<T>` itself, deliberately: that carries `rows[]`, and
 * `payout_destinations_one_live_idx` guarantees there is at most one live row.
 * An array here would invite a caller to wonder which of them the money follows.
 */
export type DestinationRead =
  | { ok: true; destination: MaskedDestination | null }
  | { ok: false; destination: null };

function toMasked(row: {
  id: string;
  kind: "bank" | "esewa" | "khalti";
  account_ref: string;
  account_name: string;
  bank_name: string | null;
  created_at: string;
  usable_from: string;
  first_payout_confirmed_at: string | null;
  retired_at: string | null;
}): MaskedDestination {
  const usableFrom = new Date(row.usable_from);
  const retiredAt = row.retired_at ? new Date(row.retired_at) : null;
  const firstPayoutConfirmedAt = row.first_payout_confirmed_at
    ? new Date(row.first_payout_confirmed_at)
    : null;

  return {
    id: row.id,
    kind: row.kind,
    /*
     * MASKED FROM THE PLAINTEXT, WHICH MEANS OPENING THE ENVELOPE TO DO IT.
     * Masking the envelope itself would print four characters of base64 — a
     * stable-looking string that is not the account and changes every time the
     * row is rewritten. So the seal is opened and discarded here, inside a
     * function that returns no plaintext, and `revealDestination` stays the only
     * path that hands digits to a caller.
     */
    accountMasked: maskAccountRef(openSecret(row.account_ref)),
    accountName: row.account_name,
    bankName: row.bank_name,
    createdAt: new Date(row.created_at),
    usableFrom,
    firstPayoutConfirmedAt,
    readiness: destinationReadiness({
      retiredAt,
      usableFrom,
      firstPayoutConfirmedAt,
    }),
  };
}

const LIVE_COLUMNS =
  "id, kind, account_ref, account_name, bank_name, created_at, usable_from, first_payout_confirmed_at, retired_at";

/** The live destination for one listing, masked, with its readiness. */
export async function currentDestination(
  providerId: string,
): Promise<DestinationRead> {
  if (!hasSupabaseConfig()) return { ok: false, destination: null };

  try {
    const { data, error } = await createAdminClient()
      .from("payout_destinations")
      .select(LIVE_COLUMNS)
      .eq("provider_id", providerId)
      .is("retired_at", null)
      .maybeSingle();

    if (error) {
      console.error(
        `[payout-destinations] read failed — ${describeError(error)}`,
      );
      return { ok: false, destination: null };
    }

    return { ok: true, destination: data ? toMasked(data) : null };
  } catch (thrown) {
    console.error(`[payout-destinations] read threw — ${describeError(thrown)}`);
    return { ok: false, destination: null };
  }
}

export type ChangeResult =
  | { ok: true; destination: MaskedDestination }
  /** Their session has not proved who they are recently enough. */
  | { ok: false; reason: "reauthRequired" }
  /** No listing belongs to this account. */
  | { ok: false; reason: "noListing" }
  /** The key is missing or wrong, so nothing was written. See below. */
  | { ok: false; reason: "cannotSeal" }
  /**
   * The old destination is retired and the replacement did not save.
   *
   * ITS OWN REASON RATHER THAN A GENERIC FAILURE, because the state it names is
   * one a professional has to act on: they have no live destination, no payout
   * can go anywhere, and re-submitting the form fixes it. See the ordering note
   * in `changeDestination`.
   */
  | { ok: false; reason: "retiredButNotReplaced" }
  | { ok: false; reason: "generic" };

/**
 * Replace where this professional is paid.
 *
 * FOUR CONTROLS, AND THEY GUARD DIFFERENT THINGS. An account takeover's first
 * move is to redirect the money, so no single one of these is the answer:
 *
 *   re-auth        raises the price of the theft above a stolen session
 *   cooldown       `usable_from`, stamped on the row: time to object
 *   the notice     tells somebody it happened
 *   confirmation   a person looks before the first payout to a new address
 *
 * SEALING HAPPENS FIRST, BEFORE ANY WRITE. `sealSecret` throws when the key is
 * absent or the wrong length, and doing it up front means a key problem leaves
 * the existing destination live and untouched. The alternative ordering retires
 * the old row and then discovers it cannot write the new one.
 *
 * THE ORDER AFTER THAT IS RETIRE, THEN INSERT, AND IT CANNOT BE REVERSED.
 * `payout_destinations_one_live_idx` refuses a second live row, so the insert
 * only has room once the old row is retired. supabase-js has no transaction, so
 * there is a window: if the insert fails the professional is left with no live
 * destination. That is the direction worth failing in — money pausing beats
 * money following a stale address — and it is recoverable, because re-submitting
 * inserts into the space the retire made. `retiredButNotReplaced` exists so the
 * screen says that rather than "something went wrong". If this ever actually
 * bites, the fix is a `security definer` function doing both statements in one
 * transaction, not a rollback in TypeScript.
 *
 * THE NOTICE IS SENT AFTER THE WRITE and cannot roll it back — `notify` never
 * throws, for the reason stated in `lib/notify`: the event has already happened.
 * Its recipient is the professional's own profile; see the comment on
 * `payout.destinationChanged` for what an SMS channel must do differently here.
 */
export async function changeDestination(input: {
  profileId: string;
  /** When this session last proved who it is. Null is treated as never. */
  reauthenticatedAt: Date | null;
  kind: "bank" | "esewa" | "khalti";
  /** The account or wallet number, as given. Sealed before it is stored. */
  accountRef: string;
  accountName: string;
  bankName?: string | null;
  now?: Date;
}): Promise<ChangeResult> {
  const now = input.now ?? new Date();

  /*
   * REFUSED BEFORE ANYTHING IS READ, let alone written. A missing stamp is
   * expired rather than unknown — `stepUpFor`'s rule for an absent `amr`
   * timestamp, and the consequence of guessing wrong here is somebody's
   * earnings.
   */
  if (!isFresh(input.reauthenticatedAt, now)) {
    return { ok: false, reason: "reauthRequired" };
  }

  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };

  let sealed: string;
  try {
    sealed = sealSecret(input.accountRef.trim());
  } catch (thrown) {
    // The key, not the input. Named separately because it is a deployment
    // problem somebody has to fix, not something the professional typed.
    console.error(
      `[payout-destinations] cannot seal — ${describeError(thrown)}`,
    );
    return { ok: false, reason: "cannotSeal" };
  }

  try {
    const admin = createAdminClient();

    const { data: provider } = await admin
      .from("providers")
      .select("id, profile_id")
      .eq("profile_id", input.profileId)
      .maybeSingle();

    if (!provider) return { ok: false, reason: "noListing" };
    const providerId = provider.id as string;

    const { error: retireError } = await admin
      .from("payout_destinations")
      .update({ retired_at: now.toISOString() })
      .eq("provider_id", providerId)
      .is("retired_at", null);

    if (retireError) {
      console.error(
        `[payout-destinations] retire failed — ${describeError(retireError)}`,
      );
      return { ok: false, reason: "generic" };
    }

    const { data: inserted, error: insertError } = await admin
      .from("payout_destinations")
      .insert({
        provider_id: providerId,
        kind: input.kind,
        account_ref: sealed,
        account_name: input.accountName.trim(),
        bank_name: input.bankName?.trim() || null,
        usable_from: destinationUsableFrom(now).toISOString(),
      })
      .select(LIVE_COLUMNS)
      .single();

    if (insertError || !inserted) {
      console.error(
        `[payout-destinations] insert failed — ${describeError(insertError)}`,
      );
      return { ok: false, reason: "retiredButNotReplaced" };
    }

    const destination = toMasked(inserted);

    await notify({
      recipientId: input.profileId,
      kind: "payout.destinationChanged",
      params: {
        /*
         * MASKED, AND ONLY THE NEW ONE.
         *
         * A notice warning somebody their account was changed must not be the
         * place an account number is printed, so what appears is
         * `maskAccountRef`'s four digits — enough for the reader to say "that is
         * not mine", which is the only judgement this message asks for.
         *
         * THE OLD DESTINATION IS DELIBERATELY NOT HERE. It was, and reading it
         * back created a state the sentence could not express: the read of the
         * previous row can fail, and a failed read rendering as an empty string
         * is indistinguishable from there having been nothing to replace — a
         * first setup and a lost fact reading identically, which is rule 6 one
         * level down from a column. Naming three cases in a warning about
         * somebody's money is worse than naming one, and the retired row is
         * itself the record of what it used to be.
         */
        to: destination.accountMasked,
        usableFrom: destination.usableFrom.toISOString(),
      },
      bookingId: null,
    });

    return { ok: true, destination };
  } catch (thrown) {
    console.error(
      `[payout-destinations] change threw — ${describeError(thrown)}`,
    );
    return { ok: false, reason: "generic" };
  }
}

/**
 * Is this session's proof of identity recent enough to move somebody's money?
 *
 * Exported so the screen that decides whether to ask for a code reads the same
 * rule the write enforces. A gate that the form and the data layer each judge
 * separately is a gate with two answers.
 */
export function isFresh(
  reauthenticatedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!reauthenticatedAt) return false;
  const age = now.getTime() - reauthenticatedAt.getTime();
  if (!Number.isFinite(age) || age < 0) return false;
  return age <= REAUTH_WINDOW_MINUTES * 60 * 1000;
}

export type RevealResult =
  | { ok: true; accountRef: string; accountName: string }
  | { ok: false; reason: "notFound" | "generic" };

/**
 * The account number itself, for the one person who needs it and never silently.
 *
 * THE ONLY PATH IN THE PRODUCT THAT OPENS AN ACCOUNT ENVELOPE AND HANDS BACK
 * THE DIGITS. There is exactly one legitimate reason — somebody is sending the
 * money, or answering a professional whose transfer failed — and until a
 * remittance adapter exists that somebody is a person typing into a bank's own
 * screen.
 *
 * THE AUDIT ROW IS WRITTEN BEFORE THE ENVELOPE IS OPENED, not after. Ordering
 * rather than error handling: `recordSecurityEvent` never throws, so nothing
 * could be conditional on its success anyway, and writing first means a reveal
 * that dies mid-call still left the record that somebody asked. The test counts
 * `security_events` either side of this call, and it goes red if the recorder
 * is removed.
 *
 * `reason` IS REQUIRED and is not decoration — it is the only thing that tells
 * a later reader whether a read was the payout run or curiosity.
 */
export async function revealDestination(input: {
  destinationId: string;
  adminId: string;
  reason: string;
}): Promise<RevealResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };

  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("payout_destinations")
      .select("id, provider_id, account_ref, account_name")
      .eq("id", input.destinationId)
      .maybeSingle();

    if (error) {
      console.error(
        `[payout-destinations] reveal read failed — ${describeError(error)}`,
      );
      return { ok: false, reason: "generic" };
    }
    if (!data) return { ok: false, reason: "notFound" };

    await recordDestinationAccess({
      adminId: input.adminId,
      providerId: data.provider_id as string,
      destinationId: data.id as string,
      reason: input.reason,
    });

    return {
      ok: true,
      accountRef: openSecret(data.account_ref as string),
      accountName: data.account_name as string,
    };
  } catch (thrown) {
    console.error(
      `[payout-destinations] reveal threw — ${describeError(thrown)}`,
    );
    return { ok: false, reason: "generic" };
  }
}

export type ConfirmResult =
  | { ok: true }
  /** The trigger refused it: somebody already confirmed this destination. */
  | { ok: false; reason: "alreadyConfirmed" | "notFound" | "generic" };

/**
 * A person looked at the first payout to this destination and said yes.
 *
 * WHY A HUMAN STEP AT ALL, given the cooldown. The cooldown assumes the real
 * person reads a notice; somebody on a job for three days might not. This is the
 * second chance, and it is cheap because it happens once per destination ever —
 * not once per payout.
 *
 * THE TRIGGER, NOT THIS FUNCTION, IS WHAT MAKES IT RECORD ONE NAME. A second
 * confirmation is refused in SQL, so the row keeps the first person's id and
 * moment. Checking here first and then writing is the gap two admins opening the
 * same screen walk through.
 */
export async function confirmFirstPayout(input: {
  destinationId: string;
  adminId: string;
}): Promise<ConfirmResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "generic" };

  try {
    const { data, error } = await createAdminClient()
      .from("payout_destinations")
      .update({
        first_payout_confirmed_at: new Date().toISOString(),
        first_payout_confirmed_by: input.adminId,
      })
      .eq("id", input.destinationId)
      .select("id")
      .maybeSingle();

    if (error) {
      if (/already recorded/i.test(error.message)) {
        return { ok: false, reason: "alreadyConfirmed" };
      }
      console.error(
        `[payout-destinations] confirm failed — ${describeError(error)}`,
      );
      return { ok: false, reason: "generic" };
    }

    if (!data) return { ok: false, reason: "notFound" };
    return { ok: true };
  } catch (thrown) {
    console.error(
      `[payout-destinations] confirm threw — ${describeError(thrown)}`,
    );
    return { ok: false, reason: "generic" };
  }
}
