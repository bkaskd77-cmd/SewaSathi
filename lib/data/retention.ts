import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import {
  cutoffFor,
  RETENTION,
  retentionIsArmed,
  type RetentionKey,
} from "@/lib/retention/policy";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Applying the retention policy, or reporting what it would do.
 *
 * DRY RUN IS THE DEFAULT AND THE ARMED PATH NEEDS AN ENVIRONMENT VARIABLE.
 * Every number in `lib/retention/policy.ts` is a proposal until somebody has
 * read it, and a deletion job that starts working the moment it merges is a
 * data loss incident with a changelog entry. Unarmed, this counts rows and
 * changes nothing — which is also the only way to find out whether a number is
 * sensible before it takes effect.
 *
 * REDACTION, NOT DELETION, WHERE A RECORD HAS TO SURVIVE. An address is
 * referenced by bookings and a booking is a financial record: deleting the row
 * would take that with it. The tole, the landmark and the directions are what
 * get somebody to a door, so those are emptied and the ward is kept.
 *
 * WHAT THIS DELIBERATELY CANNOT DO: touch `security_events`. That table is
 * append-only and its trigger refuses DELETE for every caller including this
 * one. Expiring it is a deliberate migration that drops the trigger, says why
 * in the file, and puts it back — which is exactly the friction an audit log
 * should have.
 */

export type SweepLine = {
  rule: RetentionKey;
  action: "delete" | "redact" | "reported";
  /** How many rows are past their date. */
  due: number;
  /** How many were actually changed. Zero on a dry run. */
  changed: number;
  note?: string;
};

export type SweepReport = {
  armed: boolean;
  at: string;
  lines: SweepLine[];
};

export async function sweepRetention(
  options: { now?: Date } = {},
): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const armed = retentionIsArmed();
  const lines: SweepLine[] = [];

  if (!hasSupabaseConfig()) {
    return { armed, at: now.toISOString(), lines };
  }

  const db = createAdminClient();

  /** Count first, then act. The count is the report even when armed. */
  const due = async (
    table: string,
    column: string,
    key: RetentionKey,
  ): Promise<number> => {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .lt(column, cutoffFor(key, now).toISOString());
    if (error) {
      console.error(`[retention] counting ${table} — ${describeError(error)}`);
      return 0;
    }
    return count ?? 0;
  };

  // ---- Notifications. Nobody reads a four-month-old status change.
  {
    const count = await due("notifications", "created_at", "notifications");
    let changed = 0;
    if (armed && count > 0) {
      const { error } = await db
        .from("notifications")
        .delete()
        .lt("created_at", cutoffFor("notifications", now).toISOString());
      if (!error) changed = count;
    }
    lines.push({ rule: "notifications", action: "delete", due: count, changed });
  }

  // ---- Provider leads nobody onboarded. A pipeline, not an archive.
  {
    const count = await due("provider_leads", "created_at", "providerLeads");
    let changed = 0;
    if (armed && count > 0) {
      const { error } = await db
        .from("provider_leads")
        .delete()
        .lt("created_at", cutoffFor("providerLeads", now).toISOString())
        .neq("status", "onboarded");
      if (!error) changed = count;
    }
    lines.push({
      rule: "providerLeads",
      action: "delete",
      due: count,
      changed,
      note: "Leads that were onboarded are kept — they became professionals.",
    });
  }

  // ---- The words somebody typed about their problem.
  //      The category, urgency and latency stay for ever: that is the pricing
  //      signal and it says nothing about a person. The sentence goes.
  {
    const count = await due("triage_logs", "created_at", "triageText");
    let changed = 0;
    if (armed && count > 0) {
      const { error } = await db
        .from("triage_logs")
        .update({ input_text: null })
        .lt("created_at", cutoffFor("triageText", now).toISOString())
        .not("input_text", "is", null);
      if (!error) changed = count;
    }
    lines.push({
      rule: "triageText",
      action: "redact",
      due: count,
      changed,
      note: "Category, urgency and latency are kept; only the free text is cleared.",
    });
  }

  // ---- Addresses whose last booking is long past. Redacted, never deleted.
  {
    const cutoff = cutoffFor("addresses", now).toISOString();
    const { data: stale } = await db
      .from("addresses")
      .select("id, created_at, bookings:bookings(created_at)")
      .lt("created_at", cutoff)
      .limit(500);

    const ids = ((stale ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        const bookings = (row.bookings ?? []) as Array<{ created_at: string }>;
        // The clock is the LAST booking, not the address's own age: an address
        // used last week is in use, however old the row is.
        const last = bookings
          .map((b) => new Date(b.created_at).getTime())
          .sort((a, b) => b - a)[0];
        return last === undefined || last < new Date(cutoff).getTime();
      })
      .map((row) => row.id as string);

    let changed = 0;
    if (armed && ids.length > 0) {
      const { error } = await db
        .from("addresses")
        .update({
          tole: "[redacted]",
          landmark: "[redacted]",
          directions_note: null,
          lat: null,
          lng: null,
        })
        .in("id", ids);
      if (!error) changed = ids.length;
    }
    lines.push({
      rule: "addresses",
      action: "redact",
      due: ids.length,
      changed,
      note: "The ward stays so bookings still reconcile; the doorstep goes.",
    });
  }

  // ---- Reported only, and each for its own reason.
  lines.push({
    rule: "securityEvents",
    action: "reported",
    due: 0,
    changed: 0,
    note: "Append-only: the trigger refuses DELETE for every caller including this one. Expiring it is a deliberate migration.",
  });
  lines.push({
    rule: "verifiedDocuments",
    action: "reported",
    due: 0,
    changed: 0,
    note: "No documents exist yet. Wired in Phase 10 alongside the upload.",
  });

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "system",
    detail: {
      action: "retention.sweep",
      armed,
      lines: lines.map((line) => ({ rule: line.rule, due: line.due, changed: line.changed })),
    },
  });

  return { armed, at: now.toISOString(), lines };
}

/** The policy as it stands, for the report. */
export function retentionPolicy() {
  return RETENTION;
}
