import "server-only";

import webpush from "web-push";
import { getTranslations } from "next-intl/server";

import { markPushGone, markPushSent, pushTargetsFor } from "@/lib/data/push";
import { readPreferredLanguage } from "@/lib/data/profile-prefs";
import { serverEnv } from "@/lib/env/server";
import { site } from "@/lib/config/site";

import { notificationPath } from "./path";

import type { DeliveryResult, Notification, NotificationChannel } from "./channel";

/**
 * Web push — free, and therefore the channel that goes first.
 *
 * "ACCEPTED" IS NOT "DELIVERED", AND THIS FILE REFUSES TO CONFLATE THEM. A push
 * service answers 201 when it has taken the message, not when a phone has shown
 * it: the handset may be off, out of signal for a day, or have the notification
 * switched off at the operating system. Nothing in the web push standard tells
 * a sender whether a human saw anything.
 *
 * THAT MATTERS BECAUSE THE NEXT CHANNEL COSTS MONEY. The requirement is SMS as
 * a fallback "when push isn't available or not delivered", and the honest
 * reading of the second half is the only one a sender can act on: the push
 * service REFUSED it, or there was nobody to send to. An implementation that
 * waited for a read receipt would wait for ever; one that treated every push as
 * delivered would never fall back at all. `ok: true` here means accepted by at
 * least one push service, and `DeliveryResult.reason` says which of the
 * failures it was so `notify()` can decide about the bill.
 *
 * THE SENTENCE IS RENDERED HERE, IN THE RECIPIENT'S OWN LANGUAGE, which is the
 * whole reason a notification carries a key and not a sentence. The language is
 * read at delivery from the subscription row, falling back to the profile —
 * `lib/notify/channel.ts` has the argument, and this is the first channel that
 * has to act on it.
 */

/** Is there a key pair to sign with? */
function pushIsConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Why a push did not go.
 *
 * NAMED RATHER THAN A BOOLEAN, because `notify()` spends money on the answer.
 * `noSubscription` and `refused` are the two that earn an SMS; `notConfigured`
 * does not mean the person is unreachable, it means WE have not set a key up,
 * and billing somebody's phone for our own missing configuration is the wrong
 * way round — it would also send an SMS for every notification in a fresh
 * deployment. `unreadable` is a failed database read and is rule 6: not knowing
 * whether somebody has a phone is not the same as knowing they do not.
 */
export type PushFailure =
  | "notConfigured"
  | "noSubscription"
  | "refused"
  | "unreadable";

/** The copy for one kind, in one language. */
async function render(
  kind: string,
  params: Record<string, string>,
  locale: "en" | "ne",
): Promise<{ title: string; body: string } | null> {
  try {
    const t = await getTranslations({ locale, namespace: "push" });
    /*
     * AN ALLOW-LIST IN THE CATALOGUE, read through `has`. next-intl renders a
     * missing key as its own dotted path, so a kind with no copy would push
     * `push.booking.widened.title` to somebody's lock screen — in the language
     * they are least likely to be reading. Returning null sends nothing, which
     * is the honest failure: the in-app row is already written either way.
     */
    if (!t.has(`${kind}.title`) || !t.has(`${kind}.body`)) return null;
    return {
      title: t(`${kind}.title`, params),
      body: t(`${kind}.body`, params),
    };
  } catch {
    return null;
  }
}

export const push: NotificationChannel & {
  failureFor: (notification: Notification) => Promise<PushFailure | null>;
} = {
  name: "push",

  isConfigured: pushIsConfigured,

  async send(notification: Notification): Promise<DeliveryResult> {
    const failure = await deliver(notification);
    if (failure === null) return { ok: true, channel: "push" };
    return { ok: false, channel: "push", reason: failure };
  },

  /** The same send, reporting WHY rather than only whether. `notify()` pays for this. */
  async failureFor(notification: Notification): Promise<PushFailure | null> {
    return deliver(notification);
  },
};

async function deliver(notification: Notification): Promise<PushFailure | null> {
  if (!pushIsConfigured()) return "notConfigured";

  const targets = await pushTargetsFor(notification.recipientId);
  if (targets === null) return "unreadable";
  if (targets.length === 0) return "noSubscription";

  webpush.setVapidDetails(
    /*
     * The `mailto:` a push service contacts if we misbehave. It is required by
     * the standard, and a support address is the honest one to give.
     */
    process.env.VAPID_SUBJECT || `mailto:support@${new URL(site.url).host}`,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    serverEnv.vapidPrivateKey,
  );

  /*
   * The profile's language, read ONCE and only when a subscription needs it.
   * Most rows carry their own; a row written before that column meant anything
   * carries null, and null is "not recorded" rather than English.
   */
  let profileLocale: "en" | "ne" | null = null;
  const needsProfile = targets.some((target) => target.locale === null);
  if (needsProfile) {
    profileLocale = await readPreferredLanguage(notification.recipientId);
  }

  const sent: string[] = [];
  let refused = 0;

  await Promise.all(
    targets.map(async (target) => {
      const locale = target.locale ?? profileLocale ?? "en";
      const copy = await render(notification.kind, notification.params, locale);
      if (!copy) {
        // No copy for this kind. Not a refusal by the push service, and not
        // something an SMS would fix — the sentence does not exist either.
        return;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          JSON.stringify({
            title: copy.title,
            body: copy.body,
            kind: notification.kind,
            bookingId: notification.bookingId,
            locale,
            /*
             * WHERE A TAP GOES, DECIDED HERE RATHER THAN IN THE WORKER. The
             * worker derived it from `bookingId` alone and therefore always
             * opened the customer's product — so `booking.assigned`, work being
             * offered to a professional, 404ed on a route that reads with
             * `{ customerId }`. The audience is the thing the worker cannot
             * know and the sender always does.
             */
            path: notificationPath({
              kind: notification.kind,
              audience: notification.audience,
              bookingId: notification.bookingId,
            }),
          }),
          { TTL: 60 * 60 * 12 },
        );
        sent.push(target.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        /*
         * 404 AND 410 ARE THE ONLY ONES THAT MEAN "GONE". Everything else — a
         * 429, a 500, a timeout — is the push service having a bad minute, and
         * stamping those would quietly unsubscribe somebody because a server
         * we do not own was busy.
         */
        if (status === 404 || status === 410) {
          await markPushGone(target.endpoint);
        }
        refused += 1;
      }
    }),
  );

  if (sent.length > 0) {
    await markPushSent(sent);
    return null;
  }
  /*
   * NOTHING WENT. If anything was actively refused, say so — that is a person
   * whose browsers have all gone, and the SMS is worth paying for. If nothing
   * was refused either, every target lacked copy for this kind, which an SMS
   * would not fix.
   */
  return refused > 0 ? "refused" : "noSubscription";
}
