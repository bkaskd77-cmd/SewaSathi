import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/env";

import type {
  DeliveryResult,
  Notification,
  NotificationChannel,
} from "./channel";

/**
 * The in-app channel: a row in `notifications`.
 *
 * Written with the service role because RLS grants nobody insert — the same
 * rule payments follow, and for the same reason. A notification a client could
 * write is a notification an attacker can forge, and this one is going to say
 * things like "your professional is on the way".
 *
 * Always configured: there is no key to be missing, so a booking always
 * produces a record of what happened even when every other channel is down.
 */
export const inApp: NotificationChannel = {
  name: "in-app",

  isConfigured() {
    return hasSupabaseConfig();
  },

  async send(notification: Notification): Promise<DeliveryResult> {
    try {
      const { error } = await createAdminClient()
        .from("notifications")
        .insert({
          profile_id: notification.recipientId,
          booking_id: notification.bookingId,
          kind: notification.kind,
          params: notification.params,
        });

      if (error) return { ok: false, channel: "in-app", reason: error.message };
      return { ok: true, channel: "in-app" };
    } catch (error) {
      return { ok: false, channel: "in-app", reason: (error as Error).message };
    }
  },
};
