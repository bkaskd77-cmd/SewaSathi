import "server-only";

import { getTranslations } from "next-intl/server";

import { readPreferredLanguage } from "@/lib/data/profile-prefs";
import { readRecipientPhone } from "@/lib/data/push";
import { smsGateway, smsIsLive } from "@/lib/sms";

import type { DeliveryResult, Notification, NotificationChannel } from "./channel";

/**
 * SMS — the fallback, and the only channel in this product that costs money per
 * message.
 *
 * IT IS NEVER TRIED FIRST AND THAT IS ENFORCED IN `notify()`, NOT HERE. This
 * file knows how to send one; the decision about whether a message is worth
 * paying for belongs with the decision about whether push could reach them, and
 * both live in one place so they cannot disagree.
 *
 * `isConfigured` IS `smsIsLive`, NOT "A GATEWAY OBJECT EXISTS". `smsGateway()`
 * always returns something — the `log` gateway, which reports success and sends
 * nothing, so a fresh clone can walk the sign-in flow. If this channel called
 * that configured, every fallback would report `ok` and the product would
 * believe it had reached somebody it had not. That is the August sign-in
 * outage's exact shape: a dependency that looked fine and delivered nothing.
 *
 * ONE MESSAGE, NEVER A THREAD. `messageParts` charges per 160 characters (70 in
 * Devanagari, which is most of this product's traffic), so the copy is written
 * short on purpose and carries the booking reference rather than a link —
 * a URL in an SMS to a phone that may not have data is a longer message that
 * helps nobody.
 */

/** Is a real gateway armed? */
export function smsNotifyIsConfigured(): boolean {
  return smsIsLive();
}

export const sms: NotificationChannel = {
  name: "sms",

  isConfigured: smsNotifyIsConfigured,

  async send(notification: Notification): Promise<DeliveryResult> {
    const phone = await readRecipientPhone(notification);
    if (phone === null) {
      return { ok: false, channel: "sms", reason: "unreadable" };
    }
    if (phone === "") {
      return { ok: false, channel: "sms", reason: "noNumber" };
    }

    const locale =
      (await readPreferredLanguage(notification.recipientId)) ?? "en";

    let text: string;
    try {
      const t = await getTranslations({ locale, namespace: "sms" });
      if (!t.has(notification.kind)) {
        // No copy for this kind: nothing to send, and nothing an escalation
        // would fix. The in-app row is already written.
        return { ok: false, channel: "sms", reason: "noCopy" };
      }
      text = t(notification.kind, notification.params);
    } catch {
      return { ok: false, channel: "sms", reason: "noCopy" };
    }

    try {
      const result = await smsGateway().send({ to: phone, text });
      if (result.ok) return { ok: true, channel: "sms" };
      return { ok: false, channel: "sms", reason: result.failure };
    } catch (error) {
      return { ok: false, channel: "sms", reason: (error as Error).message };
    }
  },
};
