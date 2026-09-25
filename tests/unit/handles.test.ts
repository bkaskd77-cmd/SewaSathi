import { describe, expect, it } from "vitest";

import { phoneSuffix, readHandle } from "@/lib/data/handles";

/**
 * What the support lookup box forgives.
 *
 * THE TOLERANCE IS THE FEATURE. Somebody on a support call is repeating a
 * reference a customer is reading off a phone screen, and `makeReference`
 * excludes 0/O and 1/I *precisely because* those get mis-said. Excluding them
 * from the alphabet only helps if the box completes the job.
 */

describe("a booking reference", () => {
  it("takes one as generated", () => {
    expect(readHandle("SK-4F2K9")).toEqual({ kind: "reference", value: "SK-4F2K9" });
  });

  it("takes one without its prefix, which is how people say it", () => {
    expect(readHandle("4F2K9")).toEqual({ kind: "reference", value: "SK-4F2K9" });
  });

  it("upper-cases", () => {
    expect(readHandle("sk-4f2k9")).toEqual({ kind: "reference", value: "SK-4F2K9" });
  });

  /*
   * THE ALPHABET EXCLUDES ALL FOUR OF 0, O, 1 AND I — not one of each pair.
   * The first version of this rule tried to fold 0 into O and 1 into I, and
   * this test is what caught it: there is nothing to fold them to, because
   * neither survivor exists either. A typed one is a misread nobody can
   * recover, so it is named rather than guessed at.
   */
  it("names a character no reference can contain, instead of guessing", () => {
    expect(readHandle("SK-4F2KO")).toEqual({
      kind: "impossibleReference",
      offending: "O",
    });
    expect(readHandle("SK-4F2K0")).toEqual({
      kind: "impossibleReference",
      offending: "0",
    });
    expect(readHandle("SK-1F2I9")).toEqual({
      kind: "impossibleReference",
      offending: "1 I",
    });
  });

  /*
   * A phone number is full of 0s and 1s. Diagnosing it as a broken reference
   * would send somebody looking for a typo in a number that is perfectly fine.
   */
  it("does not diagnose a phone number as a broken reference", () => {
    expect(readHandle("9779800000011")).toEqual({
      kind: "phone",
      value: "9779800000011",
    });
  });

  it("ignores spaces somebody typed while reading it out", () => {
    expect(readHandle(" SK- 4F2 K9 ")).toEqual({
      kind: "reference",
      value: "SK-4F2K9",
    });
  });

  it("refuses one of the wrong length rather than guessing", () => {
    expect(readHandle("SK-4F2K")).toEqual({ kind: "none" });
    expect(readHandle("SK-4F2K99")).toEqual({ kind: "none" });
  });
});

describe("a payment reference", () => {
  /*
   * `SKP-` shares its first two letters with `SK-`. Checked first, or the
   * prefix strip would mangle it into a booking reference that matches nothing.
   */
  it("is recognised before the booking reference", () => {
    const handle = readHandle("SKP-aB3_x9Qz-1Lm");
    expect(handle).toEqual({ kind: "paymentReference", value: "SKP-aB3_x9Qz-1Lm" });
  });

  it("keeps its case, because base64url is case-significant", () => {
    const handle = readHandle("SKP-aB3");
    expect(handle.kind).toBe("paymentReference");
    if (handle.kind !== "paymentReference") return;
    expect(handle.value).toBe("SKP-aB3");
  });
});

describe("a phone number", () => {
  it("takes the digits out of however it was written", () => {
    expect(readHandle("+977 9800000011")).toEqual({
      kind: "phone",
      value: "9779800000011",
    });
    expect(readHandle("977-980-000-0011")).toEqual({
      kind: "phone",
      value: "9779800000011",
    });
  });

  /*
   * Short input is nothing, not a phone. Treating a mistyped reference as a
   * phone would scan the whole profiles table — there is no index on that
   * column — to reach the same "not found", with a sensitive read logged
   * against it for no reason at all.
   */
  it("is not a few digits somebody mistyped", () => {
    expect(readHandle("4F2")).toEqual({ kind: "none" });
  });

  /*
   * Five digits is neither a phone nor a reference. It gets the reference
   * diagnosis rather than silence, because that is the one thing we can say
   * about it that is both true and useful: whatever it was meant to be, it
   * cannot be a reference, and the digits are why.
   */
  it("says why five digits cannot be a reference", () => {
    expect(readHandle("12345")).toEqual({
      kind: "impossibleReference",
      offending: "1",
    });
  });

  it("matches on the last nine digits, so the country code is optional", () => {
    expect(phoneSuffix("9779800000011")).toBe("800000011");
    expect(phoneSuffix("9800000011")).toBe("800000011");
  });
});

describe("nothing at all", () => {
  it("is not a search", () => {
    expect(readHandle("")).toEqual({ kind: "none" });
    expect(readHandle("   ")).toEqual({ kind: "none" });
  });
});
