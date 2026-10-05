import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";

import {
  judgeDuplicate,
  DUPLICATE_FLAG_AT,
  DUPLICATE_REJECT_AT,
} from "@/lib/photos/duplicate";
import { hammingDistance, perceptualHash } from "@/lib/photos/hash";

/**
 * Catching a photograph that has been used before.
 *
 * THE IMAGES ARE REALLY ENCODED, NOT HAND-WRITTEN HASHES. A test that compares two strings
 * I chose proves the band arithmetic and nothing about whether the hash survives a JPEG
 * round trip — which is the entire question, because every photograph reaching this is one
 * a phone compressed and a browser re-compressed. So each case builds pixels, encodes them
 * at a real quality, and hashes the bytes that come out.
 *
 * THE CONSEQUENCE OF BEING WRONG IS ASYMMETRIC, and the cases are weighted for it: a missed
 * duplicate costs us a re-used photograph, a false one refuses an honest person with no
 * appeal inside the flow. So the cases that matter most are the ones asserting two DIFFERENT
 * photographs stay far apart.
 */

/** A deterministic image: a gradient with a block in it, so hashing has something to bite. */
function image(seed: number, width = 160, height = 120) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const block = x > width / 3 && x < (2 * width) / 3 && y > height / 3 && y < (2 * height) / 3;
      const value = block ? (seed * 53) % 200 : (x * 2 + y * 3 + seed * 11) % 256;
      data[i] = value;
      data[i + 1] = (value + seed * 29) % 256;
      data[i + 2] = (value + seed * 71) % 256;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * The SAME picture at another size, by nearest-neighbour scaling.
 *
 * The first version of this helper generated a fresh image at the new dimensions, and the
 * resize case failed — correctly. `image()` keys each pixel to its absolute coordinates, so
 * generating at 320x240 produces a DIFFERENT picture rather than a bigger one, and the hash
 * was right to say so. The fixture was wrong, not the code, which is the direction a test
 * failure is worth checking in first.
 */
function scale(
  source: { data: Uint8Array; width: number; height: number },
  width: number,
  height: number,
) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      const sy = Math.min(source.height - 1, Math.floor((y * source.height) / height));
      const from = (sy * source.width + sx) * 4;
      const to = (y * width + x) * 4;
      data.set(source.data.subarray(from, from + 4), to);
    }
  }
  return { data, width, height };
}

const encode = (seed: number, quality = 80, size?: [number, number]) =>
  new Uint8Array(
    jpeg.encode(size ? scale(image(seed), size[0], size[1]) : image(seed), quality).data,
  );

describe("the perceptual hash", () => {
  it("gives sixteen hex characters for a real JPEG", () => {
    const hash = perceptualHash(encode(1));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  /*
   * THE CASE THE HARD REJECT RESTS ON. Re-compressing a photograph is what happens when
   * somebody saves it and sends it again, and if the hash moved under that, the reject band
   * would catch nothing and the flag band would fill with noise.
   */
  it("barely moves when the same photograph is re-compressed", () => {
    const distance = hammingDistance(
      perceptualHash(encode(7, 90)),
      perceptualHash(encode(7, 45)),
    );
    expect(distance).not.toBeNull();
    expect(distance!).toBeLessThanOrEqual(DUPLICATE_REJECT_AT);
  });

  /*
   * A RESIZE MOVES THE HASH FURTHER THAN A RE-COMPRESSION, AND PAST THE REJECT BAND. This
   * case was written expecting it to stay inside 4 and it measured 5 — which is a finding
   * about the threshold rather than a test to loosen. At the chosen reject distance a
   * photograph that has been SCALED and re-sent is flagged for a person rather than
   * refused, and only a re-compressed or re-saved copy is refused outright.
   *
   * That is the cost of drawing the hard reject conservatively, and it is the right side of
   * the trade: a missed duplicate costs a re-used photograph, a false one refuses an honest
   * person with no appeal inside the flow. Measured on synthetic images, whose fine diagonal
   * detail is harsher under scaling than a photograph of a door — so this is the pessimistic
   * end, not the typical one.
   */
  it("keeps a resized copy inside the flag band, though outside the reject band", () => {
    const distance = hammingDistance(
      perceptualHash(encode(7, 80)),
      perceptualHash(encode(7, 80, [320, 240])),
    );
    expect(distance).not.toBeNull();
    expect(distance!).toBeGreaterThan(DUPLICATE_REJECT_AT);
    expect(distance!).toBeLessThanOrEqual(DUPLICATE_FLAG_AT);
  });

  /*
   * AND THE ONE THAT PROTECTS AN HONEST PERSON. Two different photographs must sit well
   * outside the reject band — a false reject turns somebody away with no appeal.
   */
  it("keeps two different photographs far apart", () => {
    const a = perceptualHash(encode(3));
    const distances = [11, 19, 27, 41].map((seed) =>
      hammingDistance(a, perceptualHash(encode(seed))),
    );
    for (const distance of distances) {
      expect(distance).not.toBeNull();
      expect(distance!).toBeGreaterThan(DUPLICATE_REJECT_AT);
    }
  });

  /* Rule 6: a hash that could not be computed is not evidence that a photograph is new. */
  it("returns null rather than a hash for bytes it cannot read", () => {
    expect(perceptualHash(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(hammingDistance(null, "0123456789abcdef")).toBeNull();
    expect(hammingDistance("short", "0123456789abcdef")).toBeNull();
  });
});

describe("what to do about a photograph seen before", () => {
  const prior = (hash: string, bookingId: string, accountId: string | null = "acc-1") => ({
    hash,
    bookingId,
    accountId,
  });
  const HASH = "ffffffffffffffff";

  it("refuses an all-but-identical photograph from another booking", () => {
    const verdict = judgeDuplicate({
      hash: HASH,
      bookingId: "booking-2",
      accountId: "acc-2",
      priors: [prior(HASH, "booking-1")],
    });
    expect(verdict.kind).toBe("reject");
  });

  /*
   * THE CLAUSE THAT KEEPS AN HONEST PERSON OUT OF IT. The same photograph twice on the SAME
   * booking is a retry on a weak signal — the arrival panel queues a failed call and drains
   * it later — and refusing that would turn somebody away for re-sending what they already
   * sent, standing in a street.
   */
  it("treats the same photograph on the same booking as a retry", () => {
    const verdict = judgeDuplicate({
      hash: HASH,
      bookingId: "booking-1",
      accountId: "acc-1",
      priors: [prior(HASH, "booking-1")],
    });
    expect(verdict.kind).toBe("retry");
  });

  it("flags the middle band and refuses nothing there", () => {
    // Seven bits apart: inside the flag band, outside the reject band.
    const verdict = judgeDuplicate({
      hash: "ffffffffffffff80",
      bookingId: "booking-2",
      accountId: "acc-2",
      priors: [prior(HASH, "booking-1")],
    });
    expect(verdict.kind).toBe("flag");
  });

  it("says nothing about a photograph it could not hash", () => {
    const verdict = judgeDuplicate({
      hash: null,
      bookingId: "booking-2",
      accountId: "acc-2",
      priors: [prior(HASH, "booking-1")],
    });
    // Not "unseen" — nothing was compared, and the two must not look alike.
    expect(verdict.kind).toBe("not-compared");
  });

  it("is unseen when nothing is close", () => {
    const verdict = judgeDuplicate({
      hash: "0000000000000000",
      bookingId: "booking-2",
      accountId: "acc-2",
      priors: [prior(HASH, "booking-1")],
    });
    expect(verdict.kind).toBe("unseen");
  });
});
