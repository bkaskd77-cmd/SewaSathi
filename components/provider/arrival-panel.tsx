"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Camera, CloudOff, Loader2, MapPin } from "lucide-react";

import {
  ContactButtons,
  type ContactChannel,
} from "@/components/provider/contact-buttons";
import { Button } from "@/components/ui/button";
import { MIN_WAIT_MINUTES } from "@/lib/abuse";
import { cn } from "@/lib/utils";
import { readOriginalPhoto } from "@/lib/photos/original";
import {
  discardPhoto,
  queuePhoto,
  takeQueuedPhoto,
} from "@/lib/pwa/photo-queue";

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

/**
 * THE PHOTOGRAPH IS QUEUED NOW, AND IT IS QUEUED SOMEWHERE ELSE.
 *
 * This used to say the picture was dropped on a failed arrival, and the reason was
 * sound: a queued action goes into `localStorage`, which is a handful of megabytes
 * shared with everything else this origin stores, and an uncompressed phone photo is
 * two of them — so queueing one risked a quota error that lost the CLAIM as well,
 * which is the failure this queue exists to prevent. The limitation was written down
 * rather than hidden, and it was the right trade against the only store available.
 *
 * `lib/pwa/photo-queue.ts` is the store that was missing. IndexedDB holds hundreds of
 * megabytes and keeps a `Blob` as a `Blob` rather than as a base64 string a third
 * larger than the bytes, so the picture no longer competes with the claim for room.
 * The two queues stay SEPARATE on purpose: this one is small, synchronous and must
 * never fail, and a photograph that cannot be stored must not take an arrival down
 * with it. `QueuedAction` is therefore unchanged, and the photograph is looked up
 * beside it by booking id.
 *
 * WHAT IS STORED IS THE FILE AS THE CAMERA WROTE IT. Compressing on the way in would
 * destroy the EXIF, and `lib/photos/evidence.ts` REFUSES a photograph with no camera
 * clock — so a helpful re-encode would queue something our own gate then rejects,
 * which is worse than dropping it: the professional would believe they had sent
 * evidence.
 */
type QueuedAction =
  | { kind: "arrived"; bookingId: string; lat?: number; lng?: number }
  | { kind: "noShow"; bookingId: string; waitedMinutes: number };

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
    photoBase64?: string;
  }) => Promise<{ ok: boolean }>;
  claimNoShow: (input: {
    bookingId: string;
    waitedMinutes: number;
  }) => Promise<{ ok: boolean; reason?: string }>;
  /** Built on the server from `site.supportWhatsapp`'s sibling — the customer's own. */
  whatsappHref: string | null;
  /** The customer's name, or a fallback label. */
  customerLabel: string;
  /** Fired on each tap. Unawaited by design — see `ContactButtons`. */
  onContact: (channel: ContactChannel) => void;
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
  /*
   * WHETHER THE PICTURE IS HELD TOO, SAID SEPARATELY.
   *
   * `queued` already produced "Saved on your phone. It will send itself when
   * you have signal" — and until this phase that sentence was false about the
   * photograph, which was dropped. The copy promised more than the code did,
   * on the screen where the thing being promised is evidence in an argument
   * about Rs 350. Now that both are held, the two cases are still different
   * facts and a professional who attached a picture should be told it is one
   * of the things waiting, not left to infer it.
   */
  const [photoQueued, setPhotoQueued] = React.useState(false);
  const [claimed, setClaimed] = React.useState(props.claimed);
  /*
   * The photograph is held in state until the arrival tap rather than uploaded on
   * selection, so one tap does one thing: the person is standing in a street and a
   * two-step upload is a second chance to lose their connection.
   */
  const [photo, setPhoto] = React.useState<string | null>(null);
  /*
   * THE FILE ITSELF, KEPT BESIDE THE ENCODED COPY. The base64 is what a server
   * action takes; the blob is what IndexedDB stores without inflating it by a
   * third. Encoding once on selection and keeping both is cheaper than encoding
   * again on a phone that has just failed to reach the network.
   */
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoTooBig, setPhotoTooBig] = React.useState(false);
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
      setPhotoQueued(false);
      return;
    }
    // Said from the store rather than from this render's memory: a reload
    // between the tap and the reconnect must not forget the picture is there.
    setPhotoQueued((await takeQueuedPhoto(props.bookingId)) !== null);
    for (const action of pending) {
      try {
        /*
         * THE HELD PHOTOGRAPH RIDES THE RETRY, which is the whole point of
         * storing it. It is read as the original blob and encoded here rather
         * than at capture, so the EXIF the server reads is the camera's own —
         * `lib/photos/evidence.ts` refuses a file with no camera clock, and a
         * re-encode anywhere in this path would produce exactly that.
         *
         * A FAILED READ SENDS THE ARRIVAL ANYWAY. An arrival with no
         * photograph is an ordinary arrival; an arrival that never lands
         * because its picture could not be read is the failure this queue
         * exists to prevent.
         */
        let queuedPhoto: string | undefined;
        if (action.kind === "arrived") {
          const blob = await takeQueuedPhoto(action.bookingId);
          if (blob) {
            queuedPhoto =
              (await readOriginalPhoto(
                new File([blob], "arrival.jpg", { type: blob.type || "image/jpeg" }),
              )) ?? undefined;
          }
        }

        const result =
          action.kind === "arrived"
            ? await props.recordArrival({
                bookingId: action.bookingId,
                lat: action.lat,
                lng: action.lng,
                photoBase64: queuedPhoto,
              })
            : await props.claimNoShow({
                bookingId: action.bookingId,
                waitedMinutes: action.waitedMinutes,
              });
        if (result.ok) {
          queue.remove(action);
          /*
           * DISCARDED ONLY ON A CONFIRMED SUCCESS, and only for an arrival.
           * Clearing it beside the action would drop the picture on a retry
           * that then failed — the one case it was stored for.
           */
          if (action.kind === "arrived") void discardPhoto(action.bookingId);
          if (action.kind === "noShow") setClaimed(true);
        }
      } catch {
        // Still offline. Leave it queued and try again next time.
        return;
      }
    }
    const stillQueued = queue
      .read()
      .some((item) => item.bookingId === props.bookingId);
    setQueued(stillQueued);
    if (!stillQueued) setPhotoQueued(false);
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
        photoBase64: photo ?? undefined,
      });
      if (!result.ok) throw new Error("refused");
      /*
       * IT REACHED THE SERVER, so nothing stale is left behind — including a
       * picture queued on an earlier attempt that this successful one carried.
       */
      void discardPhoto(props.bookingId);
    } catch {
      queue.add(action);
      /*
       * THE PICTURE IS STORED SEPARATELY AND AFTERWARDS, never as part of the
       * action. If IndexedDB is blocked or full this resolves false and the
       * arrival is still queued — which is the old behaviour, reached as a
       * fallback rather than as the design.
       */
      if (photoFile) {
        void queuePhoto(props.bookingId, photoFile).then(setPhotoQueued);
      }
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
    };

    try {
      const result = await props.claimNoShow({
        bookingId: props.bookingId,
        waitedMinutes,
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
        {queued ? (
          <Queued label={photoQueued ? t("queuedWithPhoto") : t("queued")} />
        ) : null}
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

        {/*
          THE PHOTOGRAPH, OFFERED AND NEVER REQUIRED. We fund wasted trips now, and a
          picture of a locked gate is the strongest thing a professional can show —
          but requiring one would mean somebody whose camera will not open, or whose
          hands are full, cannot report what happened to them. So it is a second,
          quieter control beside the arrival button, and the claim is unaffected by
          whether it was used.

          `capture="environment"` opens the rear camera straight away on a phone,
          which is the difference between one tap and a trip through a gallery while
          standing in the rain. On a desktop it is an ordinary file picker.
        */}
        <label className="mt-3 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-body-sm transition-colors hover:border-primary/40 hover:bg-muted/40">
          <Camera aria-hidden="true" className="size-4 shrink-0" />
          {photo ? t("photoAttached") : t("addPhoto")}
          <input
            type="file"
            /*
              JPEG ONLY, AND IT IS A TRIAL RATHER THAN A SETTLED CHOICE. iPhones shoot HEIC,
              `jpeg-js` cannot read it, and an unreadable photograph gets no hash and skips
              the duplicate check. A restricted accept list that excludes HEIC is what makes
              iOS transcode — `image/*` does not count as restricted, which is what this was
              before.

              WHAT IS UNVERIFIED IS WHETHER THE CAPTURE TIME SURVIVES THE TRANSCODE. No
              source covers iOS Safari's own conversion, and it cannot be measured from a
              sandbox. If it does not, this swaps a working freshness check for a working
              duplicate check on the same photographs — so the test is one iPhone, one
              arrival, and `/admin/claims`: a capture time there means keep this; none means
              revert to `image/jpeg,image/*`. Taken now because no real professional has
              used this screen yet, so nothing is at risk while it is answered.
            */
            accept="image/jpeg"
            capture="environment"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const encoded = await readOriginalPhoto(file);
              setPhoto(encoded);
              setPhotoFile(encoded === null ? null : file);
              // Said plainly rather than silently dropped: somebody who thinks they
              // attached a photograph and did not has weaker evidence and no idea.
              setPhotoTooBig(encoded === null);
            }}
          />
        </label>
        {photoTooBig ? (
          <p className="mt-1.5 text-caption text-warning-ink">{t("photoTooBig")}</p>
        ) : null}
      </div>
    );
  }

  /* ---- Waiting. ---- */
  return (
    <div className="mt-4 animate-rise rounded-lg border border-border p-4">
      <p className="text-body-md font-medium">
        {t("waiting", { minutes: String(Math.max(0, waitedMinutes)) })}
      </p>

      {queued ? (
          <Queued label={photoQueued ? t("queuedWithPhoto") : t("queued")} />
        ) : null}

      <ContactButtons
        phone={props.customerPhone}
        whatsappHref={props.whatsappHref}
        label={props.customerLabel}
        layout="buttons"
        onAttempt={props.onContact}
      />

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
          {/*
            THE SENTENCE NO LONGER QUOTES A CALL COUNT. It used to read "waited 20
            minutes, rang 3 times" off a counter this component kept — and that counter
            was also the evidence on the claim. The count is server-side now (one row
            per tap), so repeating a browser's idea of it here would be stating a number
            that is not the one a reviewer will see.
          */}
          <p className="text-body-md">
            {t("confirmBody", { minutes: String(waitedMinutes) })}
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
