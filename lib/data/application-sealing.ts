import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { applicationMatchKeys, hashMatchKey } from "@/lib/data/verification";
import { hasSupabaseConfig } from "@/lib/env";
import { isSealed, openSecret, sealSecret } from "@/lib/security/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchKeyKind } from "@/lib/verification";

/**
 * The one-shot that converts what was already written.
 *
 * TWO JOBS, AND THEY HAVE TO HAPPEN TOGETHER. Sealing
 * `provider_applications.payout_account` is the obvious one — two real account
 * numbers sit in this table in plaintext, and a leaked backup exposes them
 * whatever `payout_destinations` does. The second is the debt keying the digest
 * created: `application_match_keys` rows written under the old unkeyed SHA-256
 * can never match a keyed digest again, so every one of them is a dead key, and
 * a dead key is indistinguishable from a value nobody shares. Both are repaired
 * from the same plaintext in the same pass, because reading the account number
 * out is the expensive part and doing it twice invites the two halves to drift.
 *
 * IT IS A DRY RUN UNLESS ARMED, the same shape as `/api/retention/sweep` and for
 * the same reason: the only safe way to evaluate a pass over live rows is to see
 * how many it would touch before it touches any.
 *
 * IT IS IDEMPOTENT, so a second run is a no-op rather than a second conversion.
 * `isSealed` decides per row — not a flag column, not a date, not a count
 * somebody has to keep — so the question "has this been done" is answered by the
 * data itself. Re-running after a partial failure finishes the job.
 *
 * KEYS ARE WRITTEN BEFORE THE OLD ONES ARE REMOVED. Delete-then-insert leaves a
 * window where an application has no keys at all, and a failure inside that
 * window leaves it with none — worse than the dead keys it replaced. Insert
 * first, then remove whatever is not in the new set, so the row count only ever
 * goes up before it comes down.
 */

export type SealReport = {
  armed: boolean;
  /** Applications carrying a `payout_account`, and how many are still plain. */
  accounts: { withValue: number; plaintext: number; sealed: number; failed: number };
  /** Match keys recomputed under the keyed digest. */
  keys: { applications: number; written: number; removed: number; failed: number };
  /** Zero is the answer that ends this sweep's life. */
  remainingPlaintext: number;
};

type ApplicationRow = {
  id: string;
  payout_account: string | null;
  citizenship_number: string | null;
  pan_number: string | null;
  full_name: string | null;
  service_areas: string[] | null;
  device_fingerprint: string | null;
};

const EMPTY: SealReport = {
  armed: false,
  accounts: { withValue: 0, plaintext: 0, sealed: 0, failed: 0 },
  keys: { applications: 0, written: 0, removed: 0, failed: 0 },
  remainingPlaintext: 0,
};

export async function sweepApplicationSealing(
  options: { armed: boolean } = { armed: false },
): Promise<SealReport> {
  if (!hasSupabaseConfig()) return { ...EMPTY, armed: options.armed };

  const report: SealReport = {
    ...EMPTY,
    armed: options.armed,
    accounts: { withValue: 0, plaintext: 0, sealed: 0, failed: 0 },
    keys: { applications: 0, written: 0, removed: 0, failed: 0 },
  };

  const db = createAdminClient();

  const { data, error } = await db
    .from("provider_applications")
    .select(
      "id, payout_account, citizenship_number, pan_number, full_name, service_areas, device_fingerprint",
    );

  if (error || !data) {
    console.error(`[application-sealing] read failed — ${describeError(error)}`);
    return report;
  }

  const applications = data as unknown as ApplicationRow[];

  for (const application of applications) {
    /*
     * A ROW ALREADY SEALED IS STILL OPENED, and the result is thrown away.
     *
     * Not a wasted call: it is the only way to find a value that will NOT open,
     * which means the key changed without a re-seal. Sealing such a row a second
     * time would make it permanently unopenable and report success. The digest
     * does its own opening — `applicationMatchKeys` takes the stored value — so
     * nothing here needs to carry the plaintext around, and an argument somebody
     * could pass an envelope to never exists.
     *
     * An already-sealed row is not skipped, because its match keys may still be
     * the old unkeyed ones: the two repairs are independent.
     */
    const stored = application.payout_account;

    if (stored) {
      report.accounts.withValue += 1;

      if (isSealed(stored)) {
        try {
          openSecret(stored);
        } catch (thrown) {
          // A sealed value that will not open is the one failure worth shouting
          // about: it means the key changed without a re-seal.
          report.accounts.failed += 1;
          console.error(
            `[application-sealing] ${application.id} will not open — ${describeError(thrown)}`,
          );
          continue;
        }
      } else {
        report.accounts.plaintext += 1;

        if (options.armed) {
          try {
            const { error: writeError } = await db
              .from("provider_applications")
              .update({ payout_account: sealSecret(stored) })
              .eq("id", application.id);

            if (writeError) throw new Error(writeError.message);
            report.accounts.sealed += 1;
          } catch (thrown) {
            report.accounts.failed += 1;
            console.error(
              `[application-sealing] sealing ${application.id} — ${describeError(thrown)}`,
            );
            // The keys are still worth repairing, so this does not `continue`.
          }
        }
      }
    }

    await repairKeys(db, application, options.armed, report);
  }

  report.remainingPlaintext = options.armed
    ? Math.max(report.accounts.plaintext - report.accounts.sealed, 0)
    : report.accounts.plaintext;

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "system",
    detail: {
      action: "application.sealing.sweep",
      armed: options.armed,
      accounts: report.accounts,
      keys: report.keys,
      remainingPlaintext: report.remainingPlaintext,
    },
  });

  return report;
}

/**
 * Recompute one application's match keys under the keyed digest.
 *
 * The referee phones are read per application rather than joined, because this
 * runs over a handful of rows once and a join here would be the only place in
 * the product that knows this shape.
 */
async function repairKeys(
  db: ReturnType<typeof createAdminClient>,
  application: ApplicationRow,
  armed: boolean,
  report: SealReport,
): Promise<void> {
  const { data: referenceRows } = await db
    .from("application_references")
    .select("phone")
    .eq("application_id", application.id);

  const keys = applicationMatchKeys({
    citizenship_number: application.citizenship_number,
    pan_number: application.pan_number,
    /*
     * THE STORED VALUE, NOT THE PLAINTEXT. `applicationMatchKeys` opens it
     * itself, which is the point of it existing: the submission path and this
     * sweep both used to build this shape, and either forgetting to open the
     * account would have digested an envelope with a random IV — replacing dead
     * keys with different dead keys, silently. The plaintext resolved above is
     * for the sealing write; it is deliberately not passed down here, because an
     * argument somebody can pass an envelope to is the trap with extra steps.
     */
    payout_account: application.payout_account,
    full_name: application.full_name,
    service_areas: application.service_areas,
    device_fingerprint: application.device_fingerprint,
    referencePhones: (referenceRows ?? []).map((row) => row.phone as string),
  });

  if (keys.length === 0) return;
  report.keys.applications += 1;

  let rows: Array<{ application_id: string; kind: MatchKeyKind; key_hash: string }>;
  try {
    rows = keys.map((key) => ({
      application_id: application.id,
      kind: key.kind,
      key_hash: hashMatchKey(key.kind, key.value),
    }));
  } catch (thrown) {
    report.keys.failed += 1;
    console.error(
      `[application-sealing] cannot digest ${application.id} — ${describeError(thrown)}`,
    );
    return;
  }

  if (!armed) {
    report.keys.written += rows.length;
    return;
  }

  const { error: insertError } = await db
    .from("application_match_keys")
    .upsert(rows, {
      onConflict: "application_id,kind,key_hash",
      ignoreDuplicates: true,
    });

  if (insertError) {
    report.keys.failed += 1;
    console.error(
      `[application-sealing] writing keys for ${application.id} — ${describeError(insertError)}`,
    );
    return;
  }
  report.keys.written += rows.length;

  /*
   * ONLY NOW are the old ones removed, and only the ones the new set does not
   * contain. A row that survives is one the keyed digest produced again — which
   * cannot happen for an unkeyed hash, so in practice this clears exactly the
   * dead keys.
   */
  const { data: removed, error: deleteError } = await db
    .from("application_match_keys")
    .delete()
    .eq("application_id", application.id)
    .not("key_hash", "in", `(${rows.map((row) => row.key_hash).join(",")})`)
    .select("id");

  if (deleteError) {
    report.keys.failed += 1;
    console.error(
      `[application-sealing] clearing dead keys for ${application.id} — ${describeError(deleteError)}`,
    );
    return;
  }
  report.keys.removed += (removed ?? []).length;
}
