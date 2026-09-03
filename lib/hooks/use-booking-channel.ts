"use client";

import * as React from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isBookingStatus, type BookingStatus } from "@/lib/booking";
import type { Database } from "@/types/supabase";

/**
 * Watch one booking's status, live.
 *
 * THE CONNECTION IS ASSUMED TO DROP. This is mobile data in Kathmandu: the
 * socket will die in a lift, on a bus, when the phone sleeps in a pocket. So
 * the design is not "subscribe and listen" — it is "subscribe, and re-read
 * whenever we might have missed something". Every path that could have a gap
 * behind it ends in a catch-up fetch:
 *
 *   - on first subscribe, because the page's server render may already be
 *     seconds old;
 *   - on every re-subscribe, because whatever happened while the socket was
 *     down was never delivered;
 *   - when the tab becomes visible again, because a backgrounded phone gets
 *     its socket reaped without telling anybody;
 *   - when the browser reports the network is back.
 *
 * A missed transition is the failure that matters. Somebody watching for
 * "your professional is on the way" and never seeing it will phone support —
 * or worse, assume nobody is coming.
 *
 * THE SUPABASE CLIENT IS LOADED DYNAMICALLY, and that is a bundle decision as
 * much as a network one: supabase-js is ~70 kB, which would have put this
 * route over its budget. Importing it inside the effect keeps it out of the
 * first load entirely, so the page paints, reads and works on a connection
 * that never finishes fetching it. Live updates are an enhancement; the status
 * on the page is already correct without them.
 */

export type ConnectionState =
  | "connecting"
  /** Subscribed and receiving. */
  | "live"
  /** Dropped, retrying. The page is still correct as of the last catch-up. */
  | "offline"
  /** No realtime at all — no Supabase config, or the client failed to load. */
  | "unavailable";

export type BookingChannel = {
  status: BookingStatus;
  connection: ConnectionState;
  /** Bumped on every arriving change, so callers can animate a progression. */
  version: number;
};

export function useBookingChannel(
  bookingId: string,
  initialStatus: BookingStatus,
  /** Called when the status actually changes, to refresh the server-rendered half. */
  onChange?: () => void,
): BookingChannel {
  const [status, setStatus] = React.useState<BookingStatus>(initialStatus);
  const [connection, setConnection] =
    React.useState<ConnectionState>("connecting");
  const [version, setVersion] = React.useState(0);

  // Kept in a ref so the effect below never re-runs when the status changes —
  // re-running would tear down and rebuild the socket on every transition.
  const statusRef = React.useRef(initialStatus);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const apply = React.useCallback((next: string | null | undefined) => {
    if (!next || !isBookingStatus(next)) return;
    if (next === statusRef.current) return;
    statusRef.current = next;
    setStatus(next);
    setVersion((n) => n + 1);
    onChangeRef.current?.();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      let client: SupabaseClient<Database>;
      try {
        const { createClient } = await import("@/lib/supabase/client");
        client = createClient();
      } catch {
        // No config, or the chunk never arrived. The page is still correct;
        // it just will not move on its own.
        if (!cancelled) setConnection("unavailable");
        return;
      }
      if (cancelled) return;

      /** Re-read the row. The answer to every kind of gap. */
      const catchUp = async () => {
        try {
          const { data } = await client
            .from("bookings")
            .select("status")
            .eq("id", bookingId)
            .maybeSingle();
          if (!cancelled) apply(data?.status as string | undefined);
        } catch {
          // A failed catch-up is not worth surfacing: the next one will run,
          // and the status on screen is the last one we were sure of.
        }
      };

      const channel = client
        .channel(`booking:${bookingId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "bookings",
            filter: `id=eq.${bookingId}`,
          },
          (payload) => {
            apply(
              (payload.new as { status?: string } | null)?.status,
            );
          },
        )
        .subscribe((state) => {
          if (cancelled) return;
          if (state === "SUBSCRIBED") {
            setConnection("live");
            // Anything that happened before this moment was never delivered.
            void catchUp();
            return;
          }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
            setConnection("offline");
            return;
          }
          if (state === "CLOSED") setConnection("offline");
        });

      // A backgrounded phone loses its socket without an event. Coming back is
      // the only reliable signal that we may have missed something.
      const onVisible = () => {
        if (document.visibilityState === "visible") void catchUp();
      };
      const onOnline = () => void catchUp();

      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", onOnline);
      window.addEventListener("focus", onOnline);

      cleanup = () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("focus", onOnline);
        void client.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [bookingId, apply]);

  return { status, connection, version };
}
