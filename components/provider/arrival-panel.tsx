"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CloudOff, Loader2, MapPin, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MIN_WAIT_MINUTES } from "@/lib/abuse";
import { cn } from "@/lib/utils";

/**
 * "I've arrived", and then "nobody is here".
 *
 * WHO IS PRESSING THIS. Somebody standing in a street, quite possibly in rain,
 * on a phone with a cracked screen and one bar, already annoyed because they
 * rode across town and the gate is locked. Every decision below follows from
 * that and from nothing else.
 *
 *   BIG TARGETS. The buttons are full width and 56px tall — comfortably past
 *   the 44px minimum — because a wet thumb is not a mouse pointer.
 *
 *   HARD TO MISFIRE. "Nobody is here" is a claim about another human being
 *   that costs them money, so it is never one tap. It opens a separate confirm
 *   with its own distinct button, physically apart from the first, and the
 *   confirm is the only control on screen at that moment. A hold-to-press was
 *   considered and rejected: it is precise, and precision is the thing this
 *   person does not have right now.
 *
 *   HARD TO MISS. The arrival button is the loudest thing on the card once
 *   they are en route, and the wait timer counts up on its own so nobody has
 *   to remember when they got there.
 *
 *   IT SURVIVES A BAD CONNECTION. A failed request is QUEUED, not lost. The
 *   claim goes into localStorage and is retried on reconnect and on the next
 *   page load, and the screen says so plainly rather than showing an error
 *   that makes somebody tap again. Losing a no-show claim to a dead network is
 *   losing the professional their Rs 350 and losing us the evidence — it is
 *   exactly the failure this whole feature exists to prevent.
 *
 * LOCATION NEVER BLOCKS. It is asked for once, with a short timeout, and the
 * claim proceeds without it if the phone refuses. A claim with no location
 * goes to a person rather than being auto-upheld, which is the right cost —
 * far better than telling somebody standing in the rain that they cannot
 * report what just happened to them.
 */

const QUEUE_KEY = "sk:arrival-queue";

type QueuedAction =
  | { kind: "arrived"; bookingId: string; lat?: number; lng?: number }
  | {
      kind: "noShow";
      bookingId: string;
      waitedMinutes: number;
      contactAttempts: number;
    };

/** Everything about the queue in one place, and it never throws. */
const queue = {
  read(): QueuedAction[] {
    try {
      const raw = window.localStorage.getItem(QUEUE_KEY);
      return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
    } catch {
      // Private windows, cleared storage, a browser set to block it. A queue
      // that cannot be read is an empty queue, never a crash.
      return [];
    }
  },
  add(action: QueuedAction) {
    try {
      const next = [
        ...queue.read().filter(
          (item) =>
            !(item.kind === action.kind && item.bookingId === action.bookingId),
        ),
        action,
      ];
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    } catch {
      /* Nothing useful to do, and telling them about it would not help. */
    }
  },
  remove(action: QueuedAction) {
    try {
      const next = queue
        .read()
        .filter(
          (item) =>
            !(item.kind === action.kind && item.bookingId === action.bookingId),
        );
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    } catch {
      /* As above. */
    }
  },
};

export type ArrivalPanelProps = {
  bookingId: string;
  customerPhone: string | null;
  /** ISO instant, when an arrival has already been recorded. */
  arrivedAt: string | null;
  /** True once a claim exists, so the panel stops offering to make one. */
  claimed: boolean;
  recordArrival: (input: {
    bookingId: string;
    lat?: number;
    lng?: number;
  }) => Promise<{ ok: boolean }>;
  claimNoShow: (input: {
    bookingId: string;
    waitedMinutes: number;
    contactAttempts: number;
  }) => Promise<{ ok: boolean; reason?: string }>;
};

/** Ask once, briefly, and carry on regardless. */
function coarsePosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      () => resolve(null),
      // Low accuracy on purpose: we round to a kilometre anyway, and asking
      // for high accuracy costs battery and time on a cheap phone.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function ArrivalPanel(props: ArrivalPanelProps) {
  const t = useTranslations("provider.arrival");

  const [arrivedAt, setArrivedAt] = React.useState<string | null>(
    props.arrivedAt,
  );
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [claimed, setClaimed] = React.useState(props.claimed);
  const [contactAttempts, setContactAttempts] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  // The timer counts up on its own so nobody has to remember when they got
  // there — and so the wait is measured rather than estimated afterwards.
  React.useEffect(() => {
    if (!arrivedAt || claimed) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [arrivedAt, claimed]);

  const waitedMinutes = arrivedAt
    ? Math.floor((now - new Date(arrivedAt).getTime()) / 60_000)
    : 0;
  const canClaim = waitedMinutes >= MIN_WAIT_MINUTES;

  /** Try to drain the queue. Called on mount and whenever we come back online. */
  const drain = React.useCallback(async () => {
    const pending = queue.read().filter(
      (item) => item.bookingId === props.bookingId,
    );
    if (pending.length === 0) {
      setQueued(false);
      return;
    }
    for (const action of pending) {
      try {
        const result =
          action.kind === "arrived"
            ? await props.recordArrival({
                bookingId: action.bookingId,
                lat: action.lat,
                lng: action.lng,
              })
            : await props.claimNoShow({
                bookingId: action.bookingId,
                waitedMinutes: action.waitedMinutes,
                contactAttempts: action.contactAttempts,
              });
        if (result.ok) {
          queue.remove(action);
          if (action.kind === "noShow") setClaimed(true);
        }
      } catch {
        // Still offline. Leave it queued and try again next time.
        return;
      }
    }
    setQueued(queue.read().some((item) => item.bookingId === props.bookingId));
  }, [props]);

  React.useEffect(() => {
    void drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
  }, [drain]);

  async function markArrived() {
    if (busy) return;
    setBusy(true);
    // Optimistic: the timer starts now whatever the network does. The wait is
    // a real fact about the world and should not depend on a request.
    const stamped = new Date().toISOString();
    setArrivedAt(stamped);

    const position = await coarsePosition();
    const action: QueuedAction = {
      kind: "arrived",
      bookingId: props.bookingId,
      lat: position?.lat,
      lng: position?.lng,
    };

    try {
      const result = await props.recordArrival({
        bookingId: props.bookingId,
        lat: position?.lat,
        lng: position?.lng,
      });
      if (!result.ok) throw new Error("refused");
    } catch {
      queue.add(action);
      setQueued(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmNoShow() {
    if (busy) return;
    setBusy(true);
    setConfirming(false);

    const action: QueuedAction = {
      kind: "noShow",
      bookingId: props.bookingId,
      waitedMinutes,
      contactAttempts,
    };

    try {
      const result = await props.claimNoShow({
        bookingId: props.bookingId,
        waitedMinutes,
        contactAttempts,
      });
      if (!result.ok) throw new Error(result.reason ?? "refused");
      setClaimed(true);
    } catch {
      // The claim is never lost to a dead network. That failure would cost
      // this person Rs 350 and cost us the evidence.
      queue.add(action);
      setQueued(true);
      setClaimed(true);
    } finally {
      setBusy(false);
    }
  }

  if (claimed) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-body-md">{t("claimed")}</p>
        {queued ? <Queued label={t("queued")} /> : null}
      </div>
    );
  }

  /* ---- Not there yet: one very large button. ---- */
  if (!arrivedAt) {
    return (
      <div className="mt-4">
        <Button
          type="button"
          onClick={() => void markArrived()}
          disabled={busy}
          className="btn-tactile h-14 w-full text-body-lg"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <MapPin aria-hidden="true" />
          )}
          {t("iHaveArrived")}
        </Button>
        <p className="mt-2 text-caption text-muted-foreground">
          {t("arrivedHint")}
        </p>
      </div>
    );
  }

  /* ---- Waiting. ---- */
  return (
    <div className="mt-4 animate-rise rounded-lg border border-border p-4">
      <p className="text-body-md font-medium">
        {t("waiting", { minutes: String(Math.max(0, waitedMinutes)) })}
      </p>

      {queued ? <Queued label={t("queued")} /> : null}

      {props.customerPhone ? (
        <Button
          variant="outline"
          className="btn-tactile mt-3 h-12 w-full"
          asChild
          onClick={() => setContactAttempts((count) => count + 1)}
        >
          <a href={`tel:${props.customerPhone}`}>
            <Phone aria-hidden="true" />
            {t("callCustomer")}
          </a>
        </Button>
      ) : null}

      {!canClaim ? (
        <p className="mt-3 text-body-sm text-muted-foreground">
          {t("waitLonger", {
            minutes: String(Math.max(0, MIN_WAIT_MINUTES - waitedMinutes)),
          })}
        </p>
      ) : !confirming ? (
        <Button
          type="button"
          variant="outline"
          className="btn-tactile mt-3 h-14 w-full text-body-lg"
          onClick={() => setConfirming(true)}
        >
          {t("nobodyHere")}
        </Button>
      ) : (
        /*
         * THE CONFIRM STEP, and it is deliberately the only control here.
         *
         * This is a claim about another person that costs them money. It is
         * never one tap, the confirm sits well below where the first button
         * was so a double-tap cannot reach it, and the wording repeats what is
         * actually being said rather than asking "are you sure?".
         */
        <div className="mt-3 animate-rise rounded-md border border-warning/40 bg-warning/5 p-4">
          <p className="text-body-md">
            {t("confirmBody", {
              minutes: String(waitedMinutes),
              calls: String(contactAttempts),
            })}
          </p>
          <Button
            type="button"
            onClick={() => void confirmNoShow()}
            disabled={busy}
            className={cn("btn-tactile mt-4 h-14 w-full text-body-lg")}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {t("confirmNoShow")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="btn-tactile mt-2 h-12 w-full"
            onClick={() => setConfirming(false)}
          >
            {t("stillWaiting")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Said plainly, and never as an error: nothing was lost. */
function Queued({ label }: { label: string }) {
  return (
    <p
      className="mt-3 flex items-start gap-1.5 text-body-sm text-muted-foreground"
      role="status"
    >
      <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {label}
    </p>
  );
}
