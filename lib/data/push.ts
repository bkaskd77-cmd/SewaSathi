import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/env";

/**
 * Reading and writing push subscriptions.
 *
 * THE SERVICE ROLE, AND NO BROWSER WRITE POLICY AT ALL. A subscription arrives
 * from a browser, so the obvious design is an insert policy for
 * `authenticated` — and that is a row whose `profile_id` the browser chooses.
 * Subscribing somebody else's account to your own endpoint would deliver their
 * booking progress, their arrival notices and their payout-destination warning
 * to your phone. So the actor comes from the session and the data layer names
 * it, which is the rule `lib/data/payments.ts` already follows and the shape
 * every hole this product has found was missing.
 */

/** A browser we can send to. */
export type PushTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Null is "not recorded" — the caller falls back to the profile. */
  locale: "en" | "ne" | null;
};

/** What a browser hands us when somebody opts in. */
export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: "en" | "ne";
};

/**
 * Remember this browser for this person.
 *
 * ON CONFLICT ON THE ENDPOINT, because a browser that re-subscribes — after a
 * key rotation, a reinstall, or simply time — presents the same endpoint and
 * must replace its row. A second row means every notification arrives twice on
 * one phone, which reads as a broken product rather than a database detail.
 *
 * `gone_at` IS CLEARED ON THE WAY IN. An endpoint that the push service
 * refused and that the browser has now offered again is alive; leaving the
 * stamp would keep it filtered out for ever and the person would wonder why
 * opting in did nothing.
 */
export async function savePushSubscription(input: {
  actorId: string;
  subscription: PushSubscriptionInput;
}): Promise<{ ok: boolean }> {
  if (!hasSupabaseConfig()) return { ok: false };
  try {
    const { error } = await createAdminClient()
      .from("push_subscriptions")
      .upsert(
        {
          profile_id: input.actorId,
          endpoint: input.subscription.endpoint,
          p256dh: input.subscription.p256dh,
          auth: input.subscription.auth,
          locale: input.subscription.locale,
          gone_at: null,
        },
        { onConflict: "endpoint" },
      );
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Forget this browser.
 *
 * BY ENDPOINT AND BY ACTOR TOGETHER. The endpoint alone would let any signed-in
 * caller unsubscribe anybody whose endpoint they had — a quiet way to stop
 * somebody receiving the warning that their payout destination changed.
 */
export async function removePushSubscription(input: {
  actorId: string;
  endpoint: string;
}): Promise<{ ok: boolean }> {
  if (!hasSupabaseConfig()) return { ok: false };
  try {
    const { error } = await createAdminClient()
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", input.endpoint)
      .eq("profile_id", input.actorId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Every live browser for this person.
 *
 * NULL IS "WE COULD NOT LOOK", NEVER "NOBODY IS SUBSCRIBED" — rule 6, and here
 * it decides whether we pay for an SMS. A failed read returning `[]` would be
 * read by the channel as "push is not available", which is exactly the
 * condition that sends a message we are billed for. The caller must be able to
 * tell a person with no phone from a database we could not reach.
 */
export async function pushTargetsFor(profileId: string): Promise<PushTarget[] | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data, error } = await createAdminClient()
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, locale")
      .eq("profile_id", profileId)
      .is("gone_at", null);

    if (error) return null;
    return (data ?? []) as PushTarget[];
  } catch {
    return null;
  }
}

/**
 * The push service says this endpoint is gone for good (404 or 410).
 *
 * STAMPED, NOT DELETED. A sweep that deletes on the first refusal cannot tell
 * "this browser is gone" from "the push service had a bad minute", and a
 * deleted row is a person who silently stops being notified with nothing left
 * to explain why. The row stays and stops being selected.
 */
export async function markPushGone(endpoint: string): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await createAdminClient()
      .from("push_subscriptions")
      .update({ gone_at: new Date().toISOString() })
      .eq("endpoint", endpoint);
  } catch {
    /* A notification must never fail because of its own bookkeeping. */
  }
}

/** It was accepted. Recorded so a stale subscription can be told from a quiet one. */
export async function markPushSent(ids: string[]): Promise<void> {
  if (!hasSupabaseConfig() || ids.length === 0) return;
  try {
    await createAdminClient()
      .from("push_subscriptions")
      .update({ last_sent_at: new Date().toISOString() })
      .in("id", ids);
  } catch {
    /* As above. */
  }
}

/**
 * The phone number to send a fallback SMS to.
 *
 * THREE ANSWERS, NOT TWO. `null` is "we could not look" — rule 6, and here it
 * decides whether we pay for a message; `""` is "we looked and there is no
 * number"; a string is a number. A failed read collapsing to `""` would be read
 * as "this person is unreachable", which is a different fact and leads nowhere
 * useful; collapsing to a number we do not have is worse.
 *
 * `profiles.phone`, AND THE COLUMN GRANT IS WHY THAT IS SAFE TO READ AT SEND
 * TIME. `20260927000005` revoked table-wide UPDATE on `profiles` and granted
 * back exactly three columns — `full_name`, `preferred_language`,
 * `hide_from_activity` — so a browser cannot write `phone` at all; it comes
 * from the verified OTP. That is what makes this read honest for every kind
 * EXCEPT `payout.destinationChanged`, which is push-only and never reaches
 * here; see `lib/notify/urgency.ts` for why.
 */
export async function readRecipientPhone(notification: {
  recipientId: string;
  kind: string;
}): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;

  /*
   * A BELT-AND-BRACES REFUSAL, not the real guard. `WORTH_AN_SMS` is what
   * keeps this kind off the SMS path, and this is here so that a future caller
   * reaching the data layer directly cannot reintroduce the trap by accident.
   * Two refusals for one rule is correct where the failure is a warning
   * delivered to an attacker.
   */
  if (notification.kind === "payout.destinationChanged") return "";

  try {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("phone")
      .eq("id", notification.recipientId)
      .maybeSingle();

    if (error) return null;
    if (!data) return "";
    return data.phone ?? "";
  } catch {
    return null;
  }
}
