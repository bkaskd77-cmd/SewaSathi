import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import {
  LOGGABLE_REASONS,
  classifyProviderError,
  isLoggableReason,
} from "@/lib/ai/reason";

/**
 * What a failed Claude call actually was.
 *
 * WHAT WAS WRONG. The route classified every throw with
 * `/timeout|timed out|aborted/` and called everything else `provider-error`. So
 * a 401 — a key that is set and will never work until somebody rotates it — was
 * recorded as the same fact as a transient 500. Both read as "the model had a
 * blip", and one of them is a credential nobody has noticed is dead while every
 * presence check in the product reports the key as fine.
 *
 * WHY THESE ASSERT CLASS NAMES AND STATUS CODES rather than messages. The
 * message is English prose from somebody else's service and can be reworded in a
 * patch release; the class and the HTTP status are what the SDK promises.
 */

/** A real SDK error, constructed the way the SDK constructs one. */
function apiError(status: number, name: string): Error {
  const error = new Error(`${status} something went wrong`);
  error.name = name;
  (error as Error & { status: number }).status = status;
  return error;
}

describe("a key that is set and refused is not a model having a blip", () => {
  it("names a 401 as the key being rejected", () => {
    expect(classifyProviderError(apiError(401, "AuthenticationError"))).toBe(
      "auth-rejected",
    );
  });

  /*
   * 403 IS ALSO THE KEY, and it is a different sentence from 401: the key
   * exists and may not call this model. Same fix — somebody with the account
   * has to act — and nothing like waiting out a 500, which is why it groups
   * with 401 rather than with the errors that recover by themselves.
   */
  it("names a 403 as the key being rejected too", () => {
    expect(classifyProviderError(apiError(403, "PermissionDeniedError"))).toBe(
      "auth-rejected",
    );
  });

  it("keeps a 500 as an ordinary provider error", () => {
    // The distinction this whole file exists for: a 500 recovers, a 401 does
    // not, and they used to be the same recorded fact.
    expect(classifyProviderError(apiError(500, "InternalServerError"))).toBe(
      "provider-error",
    );
  });

  it("names the provider's own 429 as rate limiting, not a fault", () => {
    // Our request volume. Nothing is wrong with the key or the model.
    expect(classifyProviderError(apiError(429, "RateLimitError"))).toBe(
      "rate-limited",
    );
  });

  it("classifies by status even when the class name is unfamiliar", () => {
    // A future SDK could rename a class. The status is the durable half.
    expect(classifyProviderError(apiError(401, "SomethingNewError"))).toBe(
      "auth-rejected",
    );
  });

  /*
   * MATCHED BY NAME, NOT BY `instanceof`, and this is the case that forces it.
   * Two copies of the SDK in one dependency tree have two distinct class
   * identities, so `instanceof Anthropic.AuthenticationError` is quietly false
   * across them — every auth failure would land in the default branch while the
   * code looked exactly right. This constructs a genuine SDK instance to prove
   * the name-based read agrees with the real class.
   */
  it("agrees with a genuine SDK error instance", () => {
    const real = new Anthropic.AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "bad key" } },
      "bad key",
      new Headers(),
    );
    /*
     * `name` IS "Error" ON EVERY SDK INSTANCE — the SDK sets `constructor` and
     * leaves `name` alone. The first version of the classifier read `error.name`
     * and was therefore dead code on every real error; this assertion pins the
     * surprise so nobody reinstates it.
     */
    expect(real.name).toBe("Error");
    expect(real.constructor.name).toBe("AuthenticationError");
    expect(classifyProviderError(real)).toBe("auth-rejected");
  });
});

describe("no answer in time", () => {
  /*
   * THE ONE FAILURE WITH NO STATUS CODE, which is why it is classified by class
   * and checked first. A genuine instance is used rather than a hand-rolled
   * Error, because the hand-rolled one sets `name` and the real one does not —
   * testing the fake would have proved a branch the real error never reaches.
   */
  it("names a genuine SDK timeout, which carries no status at all", () => {
    const real = new Anthropic.APIConnectionTimeoutError({ message: "timed out" });
    expect((real as unknown as { status?: number }).status).toBeUndefined();
    expect(classifyProviderError(real)).toBe("timeout");
  });

  it("names a genuine rate limit and a genuine server error", () => {
    const limited = new Anthropic.RateLimitError(429, undefined, "slow", new Headers());
    const broken = new Anthropic.InternalServerError(500, undefined, "boom", new Headers());
    expect(classifyProviderError(limited)).toBe("rate-limited");
    // A 500 recovers; a 401 does not. They used to be the same recorded fact.
    expect(classifyProviderError(broken)).toBe("provider-error");
  });

  it("names an abort as a timeout, because from here they are the same", () => {
    const error = new Error("Request was aborted.");
    error.name = "APIUserAbortError";
    expect(classifyProviderError(error)).toBe("timeout");
  });

  it("still reads a bare message when there is no class or status", () => {
    // A fetch rejection from the runtime rather than the SDK carries neither,
    // and "timed out" is still the truth.
    expect(classifyProviderError(new Error("socket timed out"))).toBe("timeout");
    expect(classifyProviderError("connection timeout")).toBe("timeout");
  });
});

describe("what we cannot identify, we do not diagnose", () => {
  /*
   * THE DEFAULT IS THE VAGUE ANSWER ON PURPOSE. Guessing "probably the key"
   * about a value nothing recognises would send somebody to rotate a credential
   * that was working — which costs a deploy and teaches them to distrust the
   * screen next time.
   */
  it("falls back to provider-error rather than a specific claim", () => {
    expect(classifyProviderError(new Error("who knows"))).toBe("provider-error");
    expect(classifyProviderError(null)).toBe("provider-error");
    expect(classifyProviderError(undefined)).toBe("provider-error");
    expect(classifyProviderError({})).toBe("provider-error");
    expect(classifyProviderError(42)).toBe("provider-error");
  });

  it("never invents a reason the database would refuse", () => {
    // Every branch of the classifier has to land inside the check constraint,
    // or the insert fails and takes the log row — and therefore the id, and
    // therefore the attribution of whatever booking followed — with it.
    for (const thrown of [
      apiError(401, "AuthenticationError"),
      apiError(403, "PermissionDeniedError"),
      apiError(429, "RateLimitError"),
      apiError(500, "InternalServerError"),
      new Anthropic.APIConnectionTimeoutError({ message: "timed out" }),
      new Error("who knows"),
      null,
      "a string",
    ]) {
      expect(isLoggableReason(classifyProviderError(thrown))).toBe(true);
    }
  });
});

/**
 * The union and the SQL constraint are one list written twice, so they are
 * compared rather than trusted.
 *
 * A constraint and a type that drift apart do not fail in a suite — they fail on
 * the first production request that produces the new value, by losing the whole
 * log row to a rejected insert. This reads the migration.
 */
describe("the loggable set matches the column's check constraint", () => {
  it("permits exactly the same reasons in TypeScript and in SQL", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20260926000002_triage_reason.sql",
        import.meta.url,
      ),
      "utf8",
    );

    // The `reason in (...)` list, which is the constraint's whole content.
    // `[\s\S]` rather than the `s` flag: this project targets an older ES
    // level and tsc refuses `/s` outright.
    const list = sql.match(/reason in \(([\s\S]*?)\)/)?.[1] ?? "";
    const inSql = (list.match(/'[a-z-]+'/g) ?? [])
      .map((quoted) => quoted.slice(1, -1))
      .sort();

    expect(inSql).toEqual([...LOGGABLE_REASONS].sort());
  });

  /*
   * THE TWO THE SERVER CANNOT PRODUCE. `unreachable` and `rejected` are the
   * browser fallback's own reasons — the request never arrived, or came back
   * 4xx — so no server ever sees one and no row can carry one. If either ever
   * becomes loggable this fails, which is the reminder to widen the constraint
   * in the same commit.
   */
  it("excludes the two reasons only a browser can produce", () => {
    expect(isLoggableReason("unreachable")).toBe(false);
    expect(isLoggableReason("rejected")).toBe(false);
  });
});
