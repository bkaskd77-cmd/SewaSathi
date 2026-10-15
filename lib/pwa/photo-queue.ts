/**
 * A photograph taken with no signal, held on the device until there is one.
 *
 * THIS CLOSES A LIMITATION THE ARRIVAL PANEL ALREADY CARRIED IN WRITING. That
 * queue is `localStorage`, which is a handful of megabytes shared with
 * everything else this origin stores, and an uncompressed phone photo is two
 * of them — so queueing one risked a quota error that lost the CLAIM as well,
 * which is the failure the queue exists to prevent. The comment said so and
 * chose the claim, correctly. IndexedDB is the answer rather than a cleverer
 * `localStorage`: it is measured in hundreds of megabytes, and it stores a
 * `Blob` as a `Blob` rather than as a base64 string a third larger than the
 * bytes it carries.
 *
 * THE ORIGINAL BYTES, NEVER A RE-ENCODE, AND THAT IS THE WHOLE POINT OF THE
 * FEATURE. `lib/photos/original.ts` already records why: a canvas re-encode
 * destroys EXIF, measured in Chromium rather than assumed, and the camera's own
 * clock is half of what makes an arrival photograph evidence —
 * `lib/photos/evidence.ts` REFUSES a file with no camera time (`noCameraTime`).
 * So a queue that compressed on the way in would hold a photograph our own gate
 * then rejects, which is worse than not queueing: the professional would
 * believe they had sent evidence. The blob goes in untouched and comes out
 * untouched.
 *
 * `queuedAt` IS NOT THE CAPTURE TIME AND MUST NEVER BE READ AS ONE. The capture
 * time is inside the file, in EXIF, written by the camera, and it is what the
 * server reads. `queuedAt` is this phone's own clock at the moment somebody
 * tapped, kept so the queue can be ordered and so a stale entry can be dropped
 * — the same posture as the no-show claim's location, which `/admin/claims`
 * prints as *phone-reported, unverified* and never as proof. Two timestamps
 * where one is evidence and one is housekeeping is exactly the pair somebody
 * later conflates, so they are named apart and this paragraph is why.
 *
 * NOTHING HERE THROWS. A private window, a browser with IndexedDB blocked, a
 * phone out of storage: every failure path ends with the photograph not being
 * queued, which is the state the product was in before this existed. An
 * arrival with no photograph is an ordinary arrival.
 */

/** One photograph waiting for a connection. */
export type QueuedPhoto = {
  /** The booking it belongs to. One pending photograph per booking. */
  bookingId: string;
  /** The file exactly as the camera wrote it. EXIF intact. */
  blob: Blob;
  /**
   * This device's clock when it was queued. HOUSEKEEPING, NOT EVIDENCE — the
   * capture time lives in the blob's EXIF and is read server-side.
   */
  queuedAt: number;
};

const DB_NAME = "sajilokaam";
const STORE = "arrival-photos";

/**
 * How long a queued photograph is still worth sending.
 *
 * SEVEN DAYS, MATCHING `CLAIM_FRESHNESS_WINDOW_DAYS`. A photograph whose own
 * clock puts it more than a week before the claim is refused by
 * `lib/photos/evidence.ts` anyway, so holding one longer than that is holding
 * bytes the server will decline — and a phone that has been offline for a week
 * has a professional with a different problem. Dropping it is not a loss of
 * evidence; sending it would be.
 */
export const QUEUED_PHOTO_TTL_DAYS = 7;

const TTL_MS = QUEUED_PHOTO_TTL_DAYS * 24 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "bookingId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // A blocked upgrade (another tab holding an old version) must not hang
      // the caller for ever; the photograph simply is not queued.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = work(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/**
 * Hold a photograph for this booking.
 *
 * ONE PER BOOKING, replacing whatever was there. `keyPath: "bookingId"` is what
 * makes that structural rather than remembered: somebody who retakes the
 * picture before the connection returns means the second one, and keeping both
 * would send two photographs for one arrival.
 */
export async function queuePhoto(bookingId: string, blob: Blob): Promise<boolean> {
  const stored = await run<IDBValidKey>("readwrite", (store) =>
    store.put({ bookingId, blob, queuedAt: Date.now() } satisfies QueuedPhoto),
  );
  return stored !== null;
}

/** The photograph waiting for this booking, or null. Expired entries are dropped. */
export async function takeQueuedPhoto(
  bookingId: string,
  now: number = Date.now(),
): Promise<Blob | null> {
  const row = await run<QueuedPhoto | undefined>("readonly", (store) =>
    store.get(bookingId),
  );
  if (!row || !row.blob) return null;

  if (!freshEnough(row.queuedAt, now)) {
    await discardPhoto(bookingId);
    return null;
  }
  return row.blob;
}

/** Forget it — sent, or no longer wanted. */
export async function discardPhoto(bookingId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(bookingId));
}

/** Is anything waiting for this booking? Used only to say so on screen. */
export async function hasQueuedPhoto(bookingId: string): Promise<boolean> {
  return (await takeQueuedPhoto(bookingId)) !== null;
}

/**
 * Pure, so the window is testable without a database.
 *
 * A FUTURE STAMP IS NOT FRESH FOREVER — it is treated as now. A phone whose
 * clock is set years ahead would otherwise hold a photograph past every window,
 * which is `recencyWeight`'s clamp one module over and the same reasoning: a
 * wrong clock must not buy anything.
 */
export function freshEnough(queuedAt: number, now: number): boolean {
  if (!Number.isFinite(queuedAt)) return false;
  const age = Math.max(0, now - queuedAt);
  return age <= TTL_MS;
}
