"use server";

import { adminActor } from "@/lib/auth/admin-gate";
import { stringHistory } from "@/lib/data/content";

/**
 * What this key used to say.
 *
 * ITS OWN MODULE because `actions.ts` is what the editor's forms post to, and a read
 * that returns rows is a different thing from a write that changes them — keeping them
 * apart means the gate on each is obvious at a glance rather than inferred from which
 * function you are looking at.
 *
 * GUARDED LIKE EVERY OTHER ACTION. This returns who changed what and when, which is
 * about people, and `content_string_revisions` is admin-read in RLS as well — but a
 * server action reaches the database through the service role, so the policy is not
 * what protects this. The check here is.
 *
 * NULL IS "COULD NOT READ", never "nothing has changed". The screen says so, because
 * only one of those two means it is safe to edit without looking.
 */
export async function stringHistoryAction(messageKey: string) {
  const profile = await adminActor();
  if (!profile) return null;
  return stringHistory(messageKey);
}
