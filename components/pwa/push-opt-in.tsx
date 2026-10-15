"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, BellOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Turning push notifications on, and off again.
 *
 * ASKING IS A ONE-SHOT AND THAT SHAPES THE WHOLE COMPONENT. A browser lets you
 * ask for notification permission once; a refusal is permanent until somebody
 * digs through site settings, and Chrome penalises an origin that asks
 * repeatedly. So this never asks on load, never asks on a page a visitor landed
 * on by accident, and never asks for an answer it has not explained. The prompt
 * comes from a tap on a button that says what it is for, which is also the only
 * way a browser will show it: the permission request must come from a gesture.
 *
 * IT IS AN OPT-IN AND IT SAYS WHAT IT REPLACES. The sentence under the button
 * is "we will send you a text message instead" — true, and worth knowing: SMS
 * is what somebody gets if they say no, it costs us money and it carries less.
 * Framing push as the free, richer channel is honest rather than a dark
 * pattern, because it is.
 *
 * EVERY FAILURE IS SILENT AND LEAVES THE PRODUCT WORKING. No service worker, no
 * push manager, a browser that refuses, a blocked request: the component
 * renders nothing or reports the refusal plainly, and the person keeps getting
 * in-app rows and — for the kinds worth paying for — an SMS.
 */

export type PushOptInProps = {
  /** The VAPID public key, or null when push is not configured. */
  publicKey: string | null;
  subscribe: (input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    locale: "en" | "ne";
  }) => Promise<{ ok: boolean }>;
  unsubscribe: (input: { endpoint: string }) => Promise<{ ok: boolean }>;
};

/** The VAPID key travels as base64url and the push manager wants bytes. */
function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The two keys, base64url, as the server stores them. */
function keysOf(subscription: PushSubscription): { p256dh: string; auth: string } | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) return null;
  return { p256dh, auth };
}

type State = "unsupported" | "loading" | "off" | "on" | "blocked";

export function PushOptIn(props: PushOptInProps) {
  const t = useTranslations("push.optIn");
  const locale = useLocale() === "ne" ? "ne" : "en";
  const [state, setState] = React.useState<State>("loading");
  const [busy, setBusy] = React.useState(false);

  /** What the browser currently thinks, asked rather than remembered. */
  const read = React.useCallback(async () => {
    if (
      !props.publicKey ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    } catch {
      setState("unsupported");
    }
  }, [props.publicKey]);

  React.useEffect(() => {
    void read();
  }, [read]);

  /*
   * THE PUSH SERVICE ROTATED THIS BROWSER'S KEYS. The worker cannot write the
   * row — it has no session — so it posts here and the page re-subscribes
   * through the ordinary signed-in action. Without this a subscription dies
   * silently and somebody stops being notified with nothing to tell them.
   */
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-resubscribe") void turnOn();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function turnOn() {
    if (!props.publicKey || busy) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required by every browser that implements push: a subscription that
        // may be used for anything other than a visible notification is
        // refused outright.
        userVisibleOnly: true,
        applicationServerKey: toBytes(props.publicKey),
      });

      const keys = keysOf(subscription);
      if (!keys) {
        setState("off");
        return;
      }

      const result = await props.subscribe({
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        locale,
      });

      /*
       * THE BROWSER IS UNSUBSCRIBED AGAIN IF WE COULD NOT STORE IT. Otherwise
       * the browser believes it is subscribed, the server has never heard of
       * the endpoint, and the screen would say "on" about a channel that can
       * never deliver anything.
       */
      if (!result.ok) {
        await subscription.unsubscribe().catch(() => {});
        setState("off");
        return;
      }
      setState("on");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        /*
         * TOLD TO THE SERVER FIRST. If the browser unsubscribes and the write
         * fails, the row stays and every later send is a wasted encryption
         * against an endpoint that has gone — and the person is counted as
         * reachable when they are not, which is exactly the condition that
         * stops the SMS fallback firing.
         */
        await props.unsubscribe({ endpoint: subscription.endpoint });
        await subscription.unsubscribe().catch(() => {});
      }
      setState("off");
    } catch {
      /* Leave the state as it was; nothing is lost by trying again. */
    } finally {
      setBusy(false);
    }
  }

  // Not configured, or a browser with no push at all. Nothing to offer, and no
  // apology — somebody on an older phone does not need to be told what their
  // browser cannot do.
  if (state === "unsupported" || state === "loading") return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10"
        >
          {state === "on" ? (
            <Bell className="size-4 text-primary" />
          ) : (
            <BellOff className="size-4 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold">{t("title")}</p>
          <p className="mt-1 text-pretty text-caption text-muted-foreground">
            {state === "on" ? t("onBody") : t("offBody")}
          </p>

          {state === "blocked" ? (
            <p className="mt-2 text-pretty text-caption text-warning-ink">
              {t("blocked")}
            </p>
          ) : (
            <Button
              type="button"
              variant={state === "on" ? "outline" : "default"}
              size="sm"
              className="mt-3"
              disabled={busy}
              onClick={state === "on" ? turnOff : turnOn}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {state === "on" ? t("turnOff") : t("turnOn")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
