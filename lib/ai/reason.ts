/**
 * Why a triage answer came from where it did — one taxonomy, one declaration.
 *
 * WHY THIS FILE EXISTS. `TriageReason` was declared twice, in
 * `lib/ai/triage.ts` and again inside `app/api/triage/route.ts`, and the two had
 * already drifted: the route's copy was missing `unreachable` and `rejected`.
 * Nothing failed, because the route never produces those two — but a taxonomy
 * with two definitions is one where the next value gets added to whichever file
 * somebody had open. The route sends these strings to the browser and the badge
 * looks up copy by them, so they are a contract between server and client and
 * belong in a module both can import.
 *
 * NO `server-only` HERE, DELIBERATELY. The browser fallback in `lib/ai/triage.ts`
 * produces two of these itself, so this has to be importable from client code.
 * Nothing in it reads an environment variable or touches a provider — it
 * classifies a thrown value and nothing else.
 */

/**
 * The reasons, and each one names a different fix.
 *
 * THE DISTINCTION THAT MATTERS IS "WAS THERE A KEY". A silent fallback with no
 * key is a missing environment variable; a silent fallback with a key is
 * something else entirely, and for the whole life of this product the second
 * could not happen because the first was always true. `lib/ai/accuracy.ts`
 * groups these into `FallbackCause`, which is what the screen counts.
 */
export type TriageReason =
  /** Claude answered and the answer survived validation. */
  | "ok"
  /** The same question inside the cache window. Still a model answer. */
  | "cache-hit"
  /** No `ANTHROPIC_API_KEY` at all. Nothing was ever asked. */
  | "no-api-key"
  /** The model did not answer inside `TRIAGE_TIMEOUT_MS`. */
  | "timeout"
  /**
   * The key is set and the provider refused it.
   *
   * ITS OWN REASON BECAUSE IT IS THE MOST DECEPTIVE CASE. A revoked, mistyped
   * or out-of-credit key is *present* — every presence check reports it as
   * configured, `hasAnthropicConfig()` returns true, and every answer is still
   * the keyword matcher. It reads exactly like a working product. The fix is to
   * rotate a credential, which is nothing like adding one, and folding it into
   * `provider-error` would have said "the model had a blip" about a key that
   * will never work until somebody changes it.
   */
  | "auth-rejected"
  /**
   * The provider's own 429 — we asked too often.
   *
   * Nothing is wrong with the key and nothing is wrong with the model. This is
   * a fact about our request volume, and it is the one reason on this list that
   * gets better by itself.
   */
  | "rate-limited"
  /** Anything else the provider did: a 500, a connection reset, a bad request. */
  | "provider-error"
  /**
   * The model answered, and we rejected the answer.
   *
   * The only reason here that is ours to fix in code rather than in a
   * dashboard: the reply failed `parseTriageResponse`, or named a category we
   * do not sell. Worth separating for exactly that.
   */
  | "unparseable"
  /** The browser never reached us. Client-side only; never logged. */
  | "unreachable"
  /** We answered 4xx — a rate limit or a bad request. Client-side only. */
  | "rejected";

/**
 * The reasons the server can actually write to `triage_logs`.
 *
 * `unreachable` and `rejected` are produced by the browser fallback in
 * `lib/ai/triage.ts` when the request never arrived or came back 4xx — so by
 * construction no server ever saw them and no row can carry them. Naming that
 * set here is what lets the migration's check constraint be exact instead of
 * permissive, and it is asserted rather than trusted.
 */
export const LOGGABLE_REASONS = [
  "ok",
  "cache-hit",
  "no-api-key",
  "timeout",
  "auth-rejected",
  "rate-limited",
  "provider-error",
  "unparseable",
] as const satisfies readonly TriageReason[];

export type LoggableReason = (typeof LOGGABLE_REASONS)[number];

export function isLoggableReason(value: unknown): value is LoggableReason {
  return (LOGGABLE_REASONS as readonly string[]).includes(value as string);
}

/**
 * What a thrown value from the Anthropic call actually was.
 *
 * WHY NOT THE REGEX THAT WAS HERE. The route classified every throw with
 * `/timeout|timed out|aborted/` and called everything else `provider-error`, so
 * a 401 and a 500 were the same fact — and the 401 is the one that needs a
 * human to change something. The SDK already distinguishes them by class, which
 * is stronger than any message match: a message is English prose from somebody
 * else's service and can be reworded in a patch release.
 *
 * MATCHED BY NAME RATHER THAN BY `instanceof`. Two copies of the SDK in one
 * dependency tree give two distinct class identities, and `instanceof` across
 * them is quietly false — which would send every auth failure to the default
 * branch while looking completely correct. The name and the HTTP status are
 * what the SDK actually promises, so they are what this reads.
 *
 * AN UNRECOGNISED THROW IS `provider-error`, NEVER SOMETHING MORE SPECIFIC.
 * Guessing "probably the key" about a value we cannot identify would send
 * somebody to rotate a credential that was fine. The default is the vague
 * answer on purpose.
 */
/**
 * The class names in a thrown value's prototype chain, plus its own `name`.
 *
 * WHY THE CHAIN AND NOT `error.name`. Every Anthropic SDK error instance reports
 * `name: "Error"` — the SDK sets `constructor` but not `name` — so a check
 * against `error.name` looks completely correct and never fires on a real error.
 * This was written that way first and `tests/unit/triage-reason.test.ts` caught
 * it by constructing a genuine `AuthenticationError`: the name branch was dead
 * code and every auth failure was surviving only on its status code, with the
 * timeout — which carries NO status — resting entirely on a message regex.
 *
 * WHY NOT `instanceof`. Two copies of the SDK in one dependency tree have two
 * distinct class identities and `instanceof` across them is quietly false, which
 * would send every auth failure to the default branch. The chain is read by name
 * so it holds across copies.
 */
function shapeNames(error: unknown): string[] {
  const names: string[] = [];
  const own = (error as { name?: unknown } | null)?.name;
  if (typeof own === "string") names.push(own);

  let node: unknown = error;
  // Bounded rather than `while` — a cyclic or hostile prototype must not spin.
  for (let depth = 0; node && depth < 12; depth += 1) {
    const ctor = (node as { constructor?: { name?: unknown } }).constructor;
    if (ctor && typeof ctor.name === "string") names.push(ctor.name);
    node = Object.getPrototypeOf(node);
  }
  return names;
}

/*
 * RETURNS THE LOGGABLE SUBSET, not the full union, and that is a deliberate
 * narrowing rather than an accident of implementation. Everything this can
 * produce came back from a provider call, so none of it can be `unreachable` or
 * `rejected` — those describe the browser never reaching us. Saying so in the
 * type means the route's variable, the log writer's field and the column's check
 * constraint are all held together by the compiler instead of by three comments
 * agreeing with each other.
 */
export function classifyProviderError(error: unknown): LoggableReason {
  const names = shapeNames(error);
  const has = (name: string) => names.includes(name);

  const status = (error as { status?: unknown } | null)?.status;
  const code = typeof status === "number" ? status : null;

  /*
   * THE TIMEOUT IS CHECKED FIRST AND BY CLASS, because it is both the most
   * likely failure on a 9.5-second budget and the only one with NO status code
   * to fall back on. An abort is the same fact from here: no answer in time.
   */
  if (has("APIConnectionTimeoutError") || has("APIUserAbortError")) {
    return "timeout";
  }

  /*
   * THE STATUS IS THE STRONGEST SIGNAL FOR EVERYTHING ELSE. A minifier can
   * mangle a class name; it cannot change the number the provider sent.
   */
  if (code === 401 || code === 403) return "auth-rejected";
  if (code === 429) return "rate-limited";

  if (has("AuthenticationError") || has("PermissionDeniedError")) {
    return "auth-rejected";
  }
  if (has("RateLimitError")) return "rate-limited";

  /*
   * THE MESSAGE IS THE LAST RESORT, NOT THE FIRST. Kept because a fetch
   * rejection from the runtime rather than the SDK carries no status and no
   * recognised class, and "timed out" in that case is still the truth.
   */
  const raw = (error as { message?: unknown } | null)?.message;
  const message =
    typeof raw === "string" ? raw : typeof error === "string" ? error : "";
  if (/timeout|timed out|aborted/i.test(message)) return "timeout";

  return "provider-error";
}
