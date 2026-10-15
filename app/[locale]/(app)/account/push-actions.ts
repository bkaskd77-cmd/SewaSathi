"use server";

import { getSessionProfile } from "@/lib/auth/session";
import { removePushSubscription, savePushSubscription } from "@/lib/data/push";

/**
 * Opting a browser in and out of push.
 *
 * THE ACTOR COMES FROM THE SESSION AND NEVER FROM THE FORM, which matters more
 * here than almost anywhere else in this product. A `profile_id` the browser
 * chose would let anybody subscribe their own phone to somebody else's account
 * and receive that person's booking progress, their arrival notices, and the
 * warning that their payout destination has been changed. There is no id to
 * forge because none is accepted.
 *
 * WHAT THE BROWSER DOES SEND is its own endpoint and the two keys its own push
 * manager generated. Those are not credentials of ours and grant nothing but
 * the ability to send that browser a notification — but they are personal data,
 * and the row they go into is admin-read only.
 *
 * NO `revalidatePath`. Nothing on any screen renders from these rows: the
 * browser already knows its own subscription state and asks its own push
 * manager, which is both faster and the only answer that cannot be stale.
 */

export type PushOptInResult = { ok: boolean };

export async function subscribeToPushAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: "en" | "ne";
}): Promise<PushOptInResult> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false };

  /*
   * Shape-checked before it reaches the database. A push endpoint is a URL on
   * somebody else's origin and the keys are base64url; none of it is trusted
   * because it arrived from a signed-in session.
   */
  if (
    !input.endpoint ||
    !input.endpoint.startsWith("https://") ||
    input.endpoint.length > 2000 ||
    !input.p256dh ||
    !input.auth ||
    (input.locale !== "en" && input.locale !== "ne")
  ) {
    return { ok: false };
  }

  return savePushSubscription({
    actorId: profile.id,
    subscription: {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      locale: input.locale,
    },
  });
}

export async function unsubscribeFromPushAction(input: {
  endpoint: string;
}): Promise<PushOptInResult> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false };
  if (!input.endpoint) return { ok: false };

  /*
   * SCOPED TO THE ACTOR AS WELL AS THE ENDPOINT, in the data layer. The
   * endpoint alone would let any signed-in caller holding somebody else's
   * endpoint unsubscribe them — a quiet way to stop a person receiving the one
   * notification that says their money is being redirected.
   */
  return removePushSubscription({
    actorId: profile.id,
    endpoint: input.endpoint,
  });
}
