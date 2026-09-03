import "server-only";

import { inApp } from "./in-app";
import type { Notification, NotificationChannel } from "./channel";

/**
 * The notify module's public surface.
 *
 * One list. Adding SMS in Phase 13 is a file implementing `NotificationChannel`
 * and a line here — nothing that decides *what* to notify about changes, which
 * is the whole point of the split.
 */
const CHANNELS: NotificationChannel[] = [inApp];

/**
 * Send on every configured channel, and never throw.
 *
 * A notification is a report of something that already happened. The booking is
 * committed, the payment is settled, the row is in the database — so a channel
 * failing must not roll any of that back or surface as an error to the person
 * who did the thing. Failures are logged and swallowed on purpose.
 *
 * Channels run in parallel: a slow SMS gateway should not hold up the in-app
 * row, which is the one that always works.
 */
export async function notify(notification: Notification): Promise<void> {
  const live = CHANNELS.filter((channel) => channel.isConfigured());

  const results = await Promise.all(
    live.map((channel) => channel.send(notification)),
  );

  for (const result of results) {
    if (!result.ok) {
      console.error(
        `[notify] ${result.channel} failed for ${notification.kind}: ${result.reason}`,
      );
    }
  }
}

/** Several people, same event. Used when a status change touches both sides. */
export async function notifyAll(
  notifications: Notification[],
): Promise<void> {
  await Promise.all(notifications.map(notify));
}

export type {
  DeliveryResult,
  Notification,
  NotificationChannel,
  NotificationKind,
} from "./channel";
