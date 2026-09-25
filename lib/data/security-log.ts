import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { decodeCursor, encodeCursor } from "@/lib/data/log-cursor";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The log of who looked at what, read back.
 *
 * NOTHING HAS EVER READ THIS TABLE. `security_events` has been written to since
 * Phase 10 — every admin document view, every contact read, every settlement —
 * and there was no way to look at any of it short of the Supabase dashboard,
 * which is itself an untraceable read. A log nobody can read is a log that
 * proves nothing, which is most of the way to not having one.
 *
 * IT IS NOT A QUEUE AND THIS FILE SAYS SO ON PURPOSE. `lib/data/queue.ts`
 * argues against paging, and that argument is exactly right for a queue: "an
 * item LEAVES it when somebody decides it", so a second page invites working
 * the wrong end. An append-only log has no such item and no such end — nothing
 * is ever decided, nothing ever leaves, and the thing somebody wants is
 * usually not on the first page. So this pages, and it is deliberately NOT in
 * `AdminQueueKey`: a count here would make `queuesState()` report "waiting"
 * for ever and permanently kill the admin index's "nothing is waiting".
 *
 * KEYSET, NOT OFFSET. `security_events_at_idx` is `(at desc)` and `id` is a
 * monotonic identity, so `(at, id) < (lastAt, lastId)` walks backwards in
 * index order at constant cost. Offset paging re-counts everything it skips,
 * and on a table that only grows the last page gets slower for ever. `id`
 * breaks ties because several events are written inside one transaction and
 * share an `at` to the microsecond.
 *
 * WHAT THE TYPES PROMISE AND THE DATABASE DOES NOT. `kind` is free `text` with
 * no check constraint, and at least one insert comes from plpgsql
 * (`20260910000004_provisioned_accounts.sql`), so the TypeScript union is a
 * writer-side contract rather than a guarantee about what is in the table.
 * `subject_type` is likewise narrower in TS than in the column. Everything
 * here reads them as strings and renders whatever is there.
 */

export type LogEntry = {
  id: string;
  at: string;
  kind: string;
  actorId: string | null;
  actorRole: string;
  subjectType: string | null;
  subjectId: string | null;
  detail: Record<string, unknown>;
};

export type LogPage = {
  entries: LogEntry[];
  /** Null when the read failed — never an empty page, which means "nothing". */
  ok: boolean;
  /** Pass back as `before` to get the next page. Null when this is the last. */
  next: string | null;
};

export const LOG_PAGE_SIZE = 50;

export type LogFilter = {
  /** One actor's trail: what did this admin do? Indexed. */
  actorId?: string | null;
  /** One record's trail: who touched this booking? Indexed. */
  subjectId?: string | null;
  /** Opaque `${at}|${id}` from the previous page. */
  before?: string | null;
};

export async function readSecurityLog(filter: LogFilter): Promise<LogPage> {
  const empty: LogPage = { entries: [], ok: false, next: null };
  if (!hasSupabaseConfig()) return empty;

  try {
    let query = createAdminClient()
      .from("security_events")
      .select("id, at, kind, actor_id, actor_role, subject_type, subject_id, detail")
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      // One more than the page, so "is there another page" is answered by the
      // same read rather than by a second count over a growing table.
      .limit(LOG_PAGE_SIZE + 1);

    if (filter.actorId) query = query.eq("actor_id", filter.actorId);
    if (filter.subjectId) query = query.eq("subject_id", filter.subjectId);

    if (filter.before) {
      const cursor = decodeCursor(filter.before);
      if (cursor) {
        /*
         * The keyset predicate, spelled out because PostgREST has no row
         * comparison: everything strictly older, plus the ties at the same
         * instant with a smaller id.
         */
        query = query.or(
          `at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id})`,
        );
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[audit] log read failed — ${describeError(error)}`);
      return empty;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const entries: LogEntry[] = rows.slice(0, LOG_PAGE_SIZE).map((row) => ({
      id: String(row.id),
      at: row.at as string,
      kind: String(row.kind ?? ""),
      actorId: (row.actor_id as string | null) ?? null,
      actorRole: String(row.actor_role ?? "system"),
      subjectType: (row.subject_type as string | null) ?? null,
      subjectId: (row.subject_id as string | null) ?? null,
      detail: (row.detail as Record<string, unknown>) ?? {},
    }));

    const next =
      rows.length > LOG_PAGE_SIZE && entries.length > 0
        ? encodeCursor(entries[entries.length - 1])
        : null;

    return { entries, ok: true, next };
  } catch (thrown) {
    console.error(`[audit] log read threw — ${describeError(thrown)}`);
    return empty;
  }
}

/**
 * Reading the log is itself logged. Once, and never recursively.
 *
 * WHY AT ALL. This table records who read whose identity documents, whose phone
 * numbers and whose risk history. Opening it shows one admin what another
 * admin has been doing — which is the single most sensitive read in the
 * product, and the one an insider with admin rights would make. A log that
 * recorded everything except its own readers would be missing the entry that
 * mattered.
 *
 * WHY NOT RECURSIVE. `audit.viewed` is written by this function and by nothing
 * else, and this function is called only when a person opens the screen.
 * Reading an `audit.viewed` row writes nothing, so there is no regress.
 *
 * THE FILTER IS EVIDENCE, AND IT IS IDS ONLY. "An admin opened the log" is
 * almost worthless; "an admin pulled this customer's entire trail" is the thing
 * somebody would want to know afterwards. But the filter values are stored as
 * the ids they already are — never a name, never a phone, never the text of a
 * search — because a detail blob that copied those would turn the audit log
 * into a second, searchable copy of exactly what it exists to protect.
 */
export async function recordLogAccess(input: {
  adminId: string;
  filter: LogFilter;
}): Promise<void> {
  await recordSecurityEvent({
    kind: "audit.viewed",
    actorId: input.adminId,
    actorRole: "admin",
    subjectType: input.filter.subjectId ? "booking" : undefined,
    subjectId: input.filter.subjectId ?? null,
    detail: {
      // Present-or-not plus the id, which is already an id. The cursor is
      // deliberately left out: it is a position, not a question anybody asked.
      ofActor: input.filter.actorId ?? null,
      ofSubject: input.filter.subjectId ?? null,
      paged: Boolean(input.filter.before),
    },
  });
}
