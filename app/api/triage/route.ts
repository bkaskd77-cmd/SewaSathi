import { NextResponse, type NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getMessages } from "next-intl/server";
import { z } from "zod";

import {
  getAnthropic,
  hasAnthropicConfig,
  TRIAGE_MAX_TOKENS,
  TRIAGE_MODEL,
  TRIAGE_PHOTO_TIMEOUT_MS,
  TRIAGE_TIMEOUT_MS,
} from "@/lib/ai";
import {
  keywordAnswer,
  type TriageResult,
} from "@/lib/ai/mockTriage";
import { getTriagePrompt } from "@/lib/ai/prompt";
import { getPriceBands } from "@/lib/ai/price-bands";
import { triageCopyFrom, type TriageCopy } from "@/lib/ai/copy";
import { classifyProviderError, type LoggableReason } from "@/lib/ai/reason";
import { applySafetyFloor, type Hazard } from "@/lib/ai/safety";
import {
  parseTriageResponse,
  type PhotoRelevance,
} from "@/lib/ai/triage-schema";
import { judgeAiRequest, type GateRefusal } from "@/lib/ai/gate";
import { applyTopicVerdict } from "@/lib/ai/offtopic";
import { priceCall } from "@/lib/ai/spend";
import { nepalDayEndsAt } from "@/lib/config/ai-limits";
import {
  readAccountState,
  readAiLimits,
  readSpendToday,
  recordAiSpend,
  writeAccountState,
} from "@/lib/data/ai-ceilings";
import { perceptualHash } from "@/lib/photos/hash";
import { checkTriageRateLimit } from "@/lib/server/rate-limit";
import {
  spendDaily,
  spendUnrelatedPhoto,
  unrelatedPhotosSoFar,
  usedToday,
} from "@/lib/server/ai-quota";
import { readTriageCache, writeTriageCache } from "@/lib/server/triage-cache";
import { logTriage } from "@/lib/server/triage-log";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";
import { isLocale, routing, type Locale } from "@/i18n/routing";

/**
 * Triage: text and/or photo in, a category, urgency and price band out.
 *
 * The Anthropic key lives here and only here — this is why triage is a route
 * handler and not a client-side call.
 *
 * The contract with the caller is that it always answers. Missing key, model
 * down, timeout, malformed JSON, a category we do not sell: every one of those
 * paths ends in the keyword matcher rather than an error, because the person
 * on the other end typed "tap leaking" and deserves an answer either way. The
 * only 4xx are a bad request and the rate limit, and the client falls back
 * locally on both.
 *
 * Not streamed. The response is one small JSON object that has to survive
 * schema validation, a price clamp and the safety floor before anyone may see
 * it — streaming it would mean revealing fields we have not finished checking,
 * to save a few hundred milliseconds on a call that already shows a skeleton.
 *
 * The locale arrives in the body rather than the URL. This route sits outside
 * the `[locale]` segment on purpose — it is not a page, it must not be
 * rewritten to /ne/api/triage by the intl middleware, and an unknown value
 * simply falls back to the default rather than 404ing somebody mid-emergency.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Longer than the default, and only because a photograph needs it.
 *
 * `TRIAGE_PHOTO_TIMEOUT_MS` is 22 seconds and this is 30, so OUR timeout is what fires and
 * the customer gets a sentence we wrote rather than whatever the platform does to a
 * function it kills. A text-only triage is unaffected: it still answers inside 9.5 seconds
 * or falls back, and nothing here makes a fast request slower.
 *
 * If the plan clamps this below 22 seconds the product still answers — `triageProblem`'s
 * own catch produces the same "we couldn't look at your photo" line in the browser — so
 * this is a ceiling worth asking for and never one anything depends on.
 */
export const maxDuration = 30;

/** ~1 MB of image bytes. The client compresses well under this. */
const MAX_IMAGE_BYTES = 1_100_000;
const MAX_TEXT_LENGTH = 600;

const requestSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    image: z
      .object({
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data: z.string().min(1),
      })
      .optional(),
    locale: z.string().optional(),
  })
  .refine((body) => Boolean(body.text?.trim() || body.image), {
    message: "Describe the problem or add a photo.",
  });

type TriageSource = "claude" | "cache" | "fallback";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Who to count this request against.
 *
 * The user id when there is one, so a signed-in person on shared office wifi
 * is not throttled by their colleagues. Otherwise the forwarded IP — the first
 * entry, which is the client; the rest are proxies and are trivially spoofed.
 */
function rateLimitKey(request: NextRequest, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `ip:${ip}`;
}

async function currentUserId(): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    return user?.id ?? null;
  } catch {
    // Triage does not need to know who you are. If auth is unreachable, the
    // request is anonymous and rate limited by IP.
    return null;
  }
}

/**
 * Which browser this is, for a visitor who has not signed in.
 *
 * A COOKIE, AND IT IS A COST CEILING RATHER THAN AN IDENTITY. Anybody can clear it, open
 * a private window, or send none at all — so it bounds what one ordinary afternoon
 * spends and it stops nothing determined. That is said here because the alternative,
 * counting visitors by IP, is worse in a way that matters locally: Nepali mobile networks
 * put thousands of people behind one address, so an IP ceiling tight enough to be useful
 * would lock out a whole carrier. The IP limit stays as a generous backstop in
 * `checkTriageRateLimit`; this is the per-person half.
 *
 * `httpOnly` so no script can read or forge it from the page, `sameSite: lax` so it
 * survives arriving from a search result, and a year so somebody who comes back next week
 * is the same visitor.
 */
const DEVICE_COOKIE = "sk-device";

function readDeviceId(request: NextRequest): { id: string; isNew: boolean } {
  const existing = request.cookies.get(DEVICE_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) {
    return { id: existing, isNew: false };
  }
  return { id: crypto.randomUUID(), isNew: true };
}

function withDeviceCookie(
  response: NextResponse,
  device: { id: string; isNew: boolean },
): NextResponse {
  if (device.isNew) {
    response.cookies.set(DEVICE_COOKIE, device.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return response;
}

/** Decoded byte length of a base64 payload, without decoding it. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

async function askClaude(
  text: string,
  image: {
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    data: string;
  } | null,
  locale: Locale,
): Promise<{
  /**
   * The reply, or null when we could not use it at all.
   *
   * ONE DISCRIMINATOR RATHER THAN A UNION ON `result`, because `result` itself
   * became nullable: a model that names no trade returns a perfectly good reply
   * with `result: null` in it, and that is a different fact from a reply we
   * threw away. Collapsing the two is exactly the bug this change exists to
   * fix, one layer up.
   */
  parsed: NonNullable<ReturnType<typeof parseTriageResponse>> | null;
  usage: Anthropic.Usage | null;
}> {
  // Both read the same `categories` table, so the bands in the prompt and the
  // bands the answer is clamped to are the same numbers.
  const [systemPrompt, bands] = await Promise.all([
    getTriagePrompt(locale),
    getPriceBands(),
  ]);

  const content: Anthropic.ContentBlockParam[] = [];

  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }

  content.push({
    type: "text",
    text: text
      ? `Household problem: ${text}`
      : "The person sent a photo with no description. Work from the photo alone.",
  });

  const response = await getAnthropic().messages.create(
    {
      model: TRIAGE_MODEL,
      max_tokens: TRIAGE_MAX_TOKENS,
      // Same triage twice should price the same. This is a classification,
      // not a piece of writing.
      temperature: 0,
      system: [
        {
          type: "text",
          text: systemPrompt,
          // The prompt is byte-identical on every request, so it caches.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
    },
    /*
     * A PHOTOGRAPH GETS THE LONGER BUDGET. Pushing a megabyte of base64 to Anthropic and
     * then waiting for inference is not the same call as 40 characters of text, and 9.5
     * seconds was timing out on real phones in Kathmandu — reported by a customer, twice.
     * Either ceiling still ends in an answer: the route falls through to the keyword
     * matcher with the "we couldn't look at your photo" line.
     */
    {
      timeout: image ? TRIAGE_PHOTO_TIMEOUT_MS : TRIAGE_TIMEOUT_MS,
      maxRetries: 0,
    },
  );

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  /*
   * THE USAGE COMES BACK EVEN WHEN THE REPLY DOES NOT. Those tokens were spent, and a
   * budget that only counts the parseable answers undercounts exactly when the model is
   * misbehaving — which is when the bill is most likely to surprise somebody.
   */
  const usage = response.usage ?? null;
  return { parsed: raw ? parseTriageResponse(raw, bands) : null, usage };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Send JSON.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "That request didn't look right.",
    );
  }

  const text = parsed.data.text?.trim() ?? "";
  const image = parsed.data.image ?? null;
  const locale: Locale = isLocale(parsed.data.locale)
    ? parsed.data.locale
    : routing.defaultLocale;

  // The safety lines and the keyword matcher's explanations, in the reader's
  // language. Loaded before anything can fail, because every failure path
  // below needs them.
  const copy = triageCopyFrom(await getMessages({ locale }));

  if (image && base64Bytes(image.data) > MAX_IMAGE_BYTES) {
    return badRequest("That photo is too large. Try a smaller one.", 413);
  }

  const userId = await currentUserId();
  const limit = await checkTriageRateLimit(
    rateLimitKey(request, userId),
    Boolean(image),
  );
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: "That's a lot of questions at once. Give it a moment.",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "retry-after": String(limit.retryAfterSeconds) },
      },
    );
  }

  /* ------------------------------------------------------------------ *
   * The ceilings: what this person may ask, and what today may cost
   * ------------------------------------------------------------------ */

  /*
   * READ BEFORE THE CACHE, SPENT ONLY ON A REAL CALL. A cache hit costs nothing and must
   * not come off anybody's allowance — but the gate still runs first, because a visitor
   * who has used their questions should get the same sentence whether or not somebody
   * else happened to ask the same thing ten minutes ago. A ceiling that leaks through a
   * cache is a ceiling somebody can map.
   */
  const device = readDeviceId(request);
  const subject = userId ?? `device:${device.id}`;
  const limits = await readAiLimits();
  const now = new Date();

  const [
    spend,
    accountState,
    anonTriages,
    anonOffTopic,
    userText,
    userPhotos,
    unrelatedPhotos,
  ] = await Promise.all([
    readSpendToday(limits, now),
    readAccountState(userId),
    userId ? Promise.resolve(0) : usedToday("anonTriage", subject, now),
    userId ? Promise.resolve(0) : usedToday("anonOffTopic", subject, now),
    userId ? usedToday("userText", subject, now) : Promise.resolve(0),
    userId ? usedToday("userPhoto", subject, now) : Promise.resolve(0),
    userId ? unrelatedPhotosSoFar(userId) : Promise.resolve(0),
  ]);

  const gate = judgeAiRequest({
    limits,
    accountId: userId,
    text,
    hasPhoto: Boolean(image),
    used: { anonTriages, userText, userPhotos, unrelatedPhotos },
    pausedUntil: accountState.pausedUntil,
    anonOffTopicToday: anonOffTopic > 0,
    budget: {
      visitorRemainingUsd: spend.visitorRemainingUsd,
      userRemainingUsd: spend.userRemainingUsd,
    },
    dayEndsAt: nepalDayEndsAt(now).toISOString(),
    at: now,
  });

  /*
   * A REFUSAL IS AN ANSWER, NOT AN ERROR, AND THAT IS THE WHOLE SHAPE OF IT. The keyword
   * matcher runs, the safety floor runs over it, and a 200 comes back carrying the
   * sentence that explains the ceiling. So somebody who has used their questions and then
   * smells gas still gets "switch off at the mains" — which is the one thing no ceiling
   * in this product may ever take away.
   */
  if (!gate.allowed) {
    return withDeviceCookie(
      await refusedAnswer({
        refusal: gate.refusal,
        text,
        image,
        locale,
        copy,
        userId,
        startedAt,
      }),
      device,
    );
  }

  /*
   * THE SAME PHOTOGRAPH SENT TWICE IS A RETRY, NOT A SECOND QUESTION.
   *
   * The hash is the key — sixteen hex characters, no bytes held — so a re-upload on a
   * weak connection costs nothing, which is the most expensive call we make saved on the
   * commonest accident. Two DIFFERENT photographs of the same tap still miss, because
   * the hash is compared exactly rather than by distance: a near-match is a judgement
   * and a cache key must not make one.
   *
   * A PHOTOGRAPH WE COULD NOT HASH IS NEVER CACHED, in either direction. `photoHash` is
   * null then, and `cacheKey` drops the photo segment — so a text-only entry would be
   * served for a question that had a photograph in it. The guard is here rather than in
   * the key, where it would be a silent condition.
   */
  const photoHash = image ? hashOfImage(image.data) : null;
  const cacheable = Boolean(text) && (!image || Boolean(photoHash));
  const cachedEntry = cacheable ? readTriageCache(text, locale, photoHash) : null;
  const cached = cachedEntry?.result ?? null;

  let source: TriageSource = cached ? "cache" : "fallback";
  /*
   * A CACHED ANSWER REPLAYS ITS VERDICT ON THE WORDS. The call was paid for
   * once and the judgement it produced is part of the answer — so a good
   * question served from cache still clears a signed-in account's off-topic
   * streak, which it silently did not before. Only `onTopic: true` can ever be
   * replayed: an off-topic reply has no result and is never cached.
   */
  /*
   * TYPED AS THE LOGGABLE SUBSET, not the full `TriageReason`, and the compiler
   * is what keeps that honest: `unreachable` and `rejected` are produced by the
   * BROWSER when it never reached us or got a 4xx, so this route cannot
   * legitimately hold one. Widening it here would let a value the column's
   * check constraint refuses reach an insert, where it would fail the whole row
   * — losing the log, its id, and the attribution of whatever booking followed.
   */
  let reason: LoggableReason = cached ? "cache-hit" : "no-api-key";
  let result = cached;
  let visionHazard: Hazard | null = null;
  let photoVerdict: {
    relevance: PhotoRelevance;
    reason: string | null;
  } | null = null;

  let topicVerdict: { onTopic: boolean; reason: string | null } | null =
    cachedEntry?.topic ?? null;
  /**
   * The model replied and named no trade — off-topic, or a home problem it
   * could not place. Tracked separately from `result` being null, because the
   * keyword matcher fills `result` in a moment either way and the safety floor
   * needs something to run over.
   */
  let modelNamedNoTrade = false;
  /**
   * Did ANYTHING point at the trade on the card?
   *
   * The model naming one counts; a keyword in the text counts; `GENERIC_RULE`
   * does not. False is what stops the hero printing a plumbing recommendation
   * at somebody who pasted lorem ipsum.
   */
  let matched = true;

  if (!result && hasAnthropicConfig()) {
    /*
     * THE ALLOWANCE IS SPENT HERE AND NOT AT THE GATE, because this is the first line
     * past which a model call is actually going to be attempted. Spending it at the gate
     * would charge somebody for a cache hit, and spending it after the call would let two
     * tabs a millisecond apart both pass a ceiling that each of them then used up.
     * `spendDaily` is an atomic increment for that reason.
     */
    await Promise.all(
      userId
        ? [spendDaily(image ? "userPhoto" : "userText", subject, now)]
        : [spendDaily("anonTriage", subject, now)],
    );

    reason = "unparseable";
    try {
      const answer = await askClaude(text, image, locale);
      if (answer.parsed) {
        /*
         * THE VERDICTS SURVIVE A REPLY THAT NAMED NO TRADE, and that is the
         * whole change. They used to be read inside `if (answer.result)`, so a
         * model correctly answering "this is not a home-service problem" —
         * which has no category to put in `result` — had its entire reply
         * thrown away as unparseable. The hazard went with it, the topic
         * verdict went with it, and the keyword matcher printed plumbing.
         */
        visionHazard = answer.parsed.hazard;
        photoVerdict = answer.parsed.photo;
        topicVerdict = answer.parsed.topic ?? null;

        if (answer.parsed.result) {
          result = answer.parsed.result;
          source = "claude";
          reason = "ok";
          if (cacheable) {
            writeTriageCache(
              text,
              locale,
              answer.parsed.result,
              photoHash,
              answer.parsed.photo,
              answer.parsed.topic,
            );
          }
        } else {
          /*
           * A GOOD REPLY THAT NAMES NO TRADE. Two different facts and they are
           * logged apart: `off-topic` ends a visitor's AI day and moves a
           * signed-in streak, `no-trade` costs nobody anything and is the
           * signal that the ten categories do not cover what people ask for.
           *
           * NOT CACHED. An off-topic answer is refused by the gate on the next
           * attempt, so there is no repeat to save a call on; a no-trade answer
           * is one we want re-asked once the person adds a detail.
           */
          reason =
            answer.parsed.topic && !answer.parsed.topic.onTopic
              ? "off-topic"
              : "no-trade";
          modelNamedNoTrade = true;
        }
      }
      /*
       * PRICED FROM WHAT THE PROVIDER REPORTED, on every outcome including an answer we
       * could not parse: the tokens were spent whether or not we could use them, and a
       * budget that only counts the successes undercounts exactly when the model is
       * misbehaving.
       */
      if (answer.usage) {
        await recordAiSpend({
          cost: priceCall(TRIAGE_MODEL, answer.usage),
          model: TRIAGE_MODEL,
          visitor: !userId,
          hasPhoto: Boolean(image),
          at: now,
        });
      }
    } catch (error) {
      /*
       * The keyword matcher answers either way, but WHICH failure it was is not
       * a detail — it is the difference between a credential to rotate, a
       * volume to throttle and a blip to ignore. That used to be a regex here
       * that collapsed a 401 and a 500 into one `provider-error`, so a key that
       * would never work read exactly like a model having a bad minute.
       * `classifyProviderError` reads the SDK's own error classes instead.
       */
      reason = classifyProviderError(error);
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[triage] Claude call failed (${reason}), falling back:`,
        message,
      );
    }
  }

  if (!result) {
    const answer = keywordAnswer(text, copy);
    result = answer.result;
    matched = answer.matched;
    /*
     * A MODEL THAT DECLINED A TRADE IS NOT A FALLBACK, and `source` says where
     * the answer came from. The matcher supplied the row underneath so the
     * safety floor has something to run over — but if a keyword DID point
     * somewhere, that is a better answer than nothing and the card shows it.
     */
    if (!modelNamedNoTrade) source = "fallback";
  }

  // Runs on every path, including the cache and the fallback. See lib/ai/safety.
  //
  // The model's hazard read is passed in only when the model actually
  // answered. When a photo was attached and it did not, `photoUnseen` says so
  // — nobody looked at that picture, and the result should admit it.
  /*
   * DID THE MODEL REPLY AT ALL? `source` cannot answer that any more, and using
   * it for this became wrong the moment a reply could be good and still name no
   * trade — `source` then says `fallback`, because the matcher supplied the row
   * underneath.
   *
   * THE COST WOULD HAVE BEEN THE HAZARD. The model reads a photograph for gas,
   * burning and live wires BEFORE it decides what the words are about, so a
   * sparking board photographed alongside a rambling message would have had its
   * `visionHazard` dropped here and the customer told "we couldn't look at your
   * photo" by the product that had just looked at it. It also decides whether
   * `triage_logs.model` records which model answered.
   */
  const modelReplied = source === "claude" || modelNamedNoTrade;

  const {
    result: safeResult,
    hazard,
    via,
    cautioned,
    readTextHazard,
    readVisionHazard,
  } = applySafetyFloor(text, result, {
    copy: copy.safety,
    visionHazard: modelReplied ? visionHazard : null,
    photoUnseen: Boolean(image) && !modelReplied,
  });

  /* ------------------------------------------------------------------ *
   * What this answer did to the person's standing
   * ------------------------------------------------------------------ */

  /*
   * ONLY WHEN THE MODEL ACTUALLY JUDGED IT. A null verdict is "nobody asked or nobody
   * answered" — the fallback, the cache, a reply that omitted the field — and counting
   * one of those as off-topic would pause somebody for our outage. Rule 6 on a rule that
   * takes the product away from a person for a day.
   */
  if (topicVerdict) {
    if (userId) {
      const outcome = applyTopicVerdict({
        state: accountState,
        onTopic: topicVerdict.onTopic,
        at: now,
        streakToPause: limits.offTopicStreakToPause,
        pauseHours: limits.offTopicPauseHours,
        repeatWindowDays: limits.offTopicRepeatWindowDays,
      });
      await writeAccountState({
        profileId: userId,
        state: outcome.next,
        flagForReview: outcome.flagForReview,
        at: now,
      });
    } else if (!topicVerdict.onTopic) {
      await spendDaily("anonOffTopic", subject, now);
    }
  }

  /*
   * AN UNRELATED PHOTOGRAPH COUNTS AGAINST THIS QUESTION'S TWO, on the server, keyed to
   * the account — which is the whole reason a refresh cannot reset it. `unclear` counts
   * too: the cost is identical and "we could not tell" twice running is the same signal
   * as "that is not it" twice running.
   */
  if (userId && photoVerdict && photoVerdict.relevance !== "related") {
    await spendUnrelatedPhoto(userId, limits.photoRequestWindowMinutes);
  }

  const latencyMs = Date.now() - startedAt;

  const triageLogId = await logTriage({
    userId,
    inputText: text,
    hadPhoto: Boolean(image),
    result: safeResult,
    source,
    model: modelReplied ? TRIAGE_MODEL : null,
    latencyMs,
    /*
     * THREE FIELDS, BECAUSE ONE CANNOT ANSWER THE QUESTION. `hazard` is the
     * OUTCOME — what the customer was shown — and it carries the winner's
     * prefix. The comment here used to claim that prefix let the two
     * detectors "be audited apart later without a schema change"; it does
     * not. The text guard wins whenever both fire, so a `text:*` row says
     * nothing about whether vision agreed, and `vision:*` only ever appears
     * where text found nothing. Agreement was unmeasurable.
     *
     * So each detector's own reading goes alongside it — taken from the
     * safety floor, which already computes both, rather than re-running the
     * text guard here and creating a second implementation of it.
     */
    hazard: hazard ? `${via}:${hazard}` : cautioned ? "unseen-photo" : null,
    textHazard: readTextHazard,
    visionHazard: readVisionHazard,
    /*
     * WHY THIS ANSWER CAME FROM WHERE IT DID, and it was computed and thrown
     * away until now. It went to the browser for the dev badge — one developer,
     * one card, one request — and never to the row, so nothing could COUNT how
     * often the matcher stood in or say why. With a key live that is the
     * question that matters: a fallback with no key is a setup step, and a
     * fallback WITH one looks like a working product.
     */
    reason,
    /*
     * WHAT THE MODEL MADE OF THE PHOTO, as a judgement with its reason and never
     * as a score. Null is "no photo, or the model did not say" — the same thing
     * to every reader: nobody looked, so nothing is claimed. Rule 6, and the
     * distinction that matters here is that "not recorded" must never render as
     * "the photo was fine".
     */
    photoRelevance: photoVerdict?.relevance ?? null,
    photoRelevanceReason: photoVerdict?.reason ?? null,
  });

  return withDeviceCookie(
    NextResponse.json(
      {
        result: safeResult,
        source,
        latencyMs,
        /*
         * THE PHOTO VERDICT GOES TO THE BROWSER SEPARATELY FROM THE RESULT, and
         * that separation is the safety rule in the shape of a payload: the card
         * renders the answer whatever the photo was. An unrelated photo asks for
         * another one; it never withholds the triage, and it never touches the
         * hazard — which was read from that same photo regardless of what it
         * turned out to be of.
         */
        photo: photoVerdict,
        /*
         * THE MODEL'S VERDICT ON THE WORDS, beside the answer for the same
         * reason the photo verdict is: the safety floor has already run and a
         * hazard is on screen whatever this says. It was computed and thrown
         * away until now — used to move a streak and a counter, never sent — so
         * the product knew a question was off-topic and the person reading the
         * screen could not tell.
         */
        topic: topicVerdict,
        /*
         * WHETHER ANYTHING POINTED AT THE TRADE ON THE CARD. False means the
         * answer is `GENERIC_RULE`: a reservation the scheduler needs, never a
         * recommendation to read out.
         */
        matched,
        // The choices for the "which of these is it?" question, when there is
        // one to ask. Empty on every other path, which is what the card reads.
        subBands: await askableSubBands(safeResult, locale),
        /*
         * THE JOIN KEY, AND IT WAS THE MISSING LINK IN A CHAIN THAT WAS
         * OTHERWISE COMPLETE. `bookings.triage_log_id` has a column, a zod
         * field, a flow-state slot and an insert — and `/book` reads it off
         * `?triage=`. Nothing ever set it, because the id never left this
         * route, so every booking ever made has a null there and the accuracy
         * loop had no join to make.
         *
         * Null whenever logging is off, timed out or failed. The card must
         * treat that as ordinary: the link simply carries no id, and the
         * booking is made exactly as before.
         */
        triageLogId,
        // For the dev-only badge. Nothing here is secret and nothing here is
        // rendered to an ordinary visitor.
        reason,
        model: modelReplied ? TRIAGE_MODEL : null,
        /* No ceiling refused this one. The field is always present so the browser never
         has to tell "allowed" from "an older server that did not say". */
        aiRefusal: null,
      },
      { headers: { "cache-control": "no-store" } },
    ),
    device,
  );
}

/**
 * The products to offer the customer, or nothing.
 *
 * WHY THE LABELS COME BACK ON THE RESPONSE RATHER THAN OUT OF THE BUNDLE.
 * Thirty-six labels in two languages is a few kB of landing-page JavaScript
 * for a question most visitors never see, and `/[locale]` sits on a 155 kB
 * ceiling. They also go stale: the bundle would be frozen to the seed while
 * the table is what a price is actually read from. So they ride back on a
 * response we were already sending.
 *
 * The read is skipped entirely unless there is a question to ask — the common
 * case is that the triage named a product, and a round trip to fetch choices
 * nobody will see is latency spent on nothing.
 */
async function askableSubBands(
  result: TriageResult,
  locale: Locale,
): Promise<Array<{ slug: string; label: string; low: number; high: number }>> {
  // Already answered. Asking again would invite somebody to contradict a
  // reading of their own sentence with a tap.
  if (result.band) return [];

  const bands = await getPriceBands();
  const band = bands.find((entry) => entry.slug === result.category);
  /*
   * A SURVEY TRADE HAS NO PRODUCTS AND MUST NOT BE ASKED. Movers is the case:
   * no Nepali operator publishes a price, so there is nothing to narrow to and
   * the honest answer is the surveyor. `toBand` already returns an empty list
   * for it, so this is belt and braces rather than the only guard.
   */
  if (!band || band.model === "survey") return [];

  return band.subBands.map((sub) => ({
    slug: sub.slug,
    // One side picked here, not both shipped. `categoryCopy` is the same rule
    // one level up: the language choice is made in one place.
    label: locale === "ne" ? sub.labelNe : sub.labelEn,
    /*
     * THE PUBLISHED RANGE, WHICH IS THE POINT OF ASKING AT ALL. The figure on
     * the card today is the model's own, clamped only to the category band —
     * which is how AC servicing shows 1,800-5,500 while the `repair` product
     * it named is 500-1,500. An answer from the customer replaces a guess with
     * a researched, dated number.
     */
    low: sub.low,
    high: sub.high,
  }));
}

/**
 * A ceiling refused the call. Answer anyway.
 *
 * THE POINT OF THIS FUNCTION IS THAT IT IS NOT AN ERROR PATH. A 429 or a 4xx would make
 * the browser fall back locally, which works — `triageProblem`'s own catch does exactly
 * this — but it would lose the SENTENCE, and the sentence is the whole product decision:
 * "sign in to continue", "the AI is back at midnight", "photographs are closed for this
 * question". A refusal nobody can read is indistinguishable from a broken product.
 *
 * AND THE SAFETY FLOOR STILL RUNS. The keyword matcher costs nothing and the floor over
 * it is deterministic, so somebody who has used every allowance in the product and then
 * types "I can smell gas" still gets told to switch off at the mains and ring us. That is
 * asserted as behaviour in `tests/unit/ai-gate.test.ts` rather than promised here.
 *
 * IT IS LOGGED AS `ceiling-reached`, which is its own reason rather than a fault: every
 * other fallback reason is something going wrong, and counting a working ceiling among
 * them would make the fallback rate unreadable.
 */
async function refusedAnswer(input: {
  refusal: GateRefusal;
  text: string;
  image: { mediaType: string; data: string } | null;
  locale: Locale;
  copy: TriageCopy;
  userId: string | null;
  startedAt: number;
}): Promise<NextResponse> {
  const answer = keywordAnswer(input.text, input.copy);
  const { result: safeResult } = applySafetyFloor(
    input.text,
    answer.result,
    {
      copy: input.copy.safety,
      visionHazard: null,
      /*
       * NOT `photoUnseen`, even with a photograph attached, and the distinction is worth
       * the line: that sentence says "we could not look at your photo", which is about a
       * failure. This is a ceiling, and the refusal's own sentence says so. Two
       * explanations for one thing is how a screen stops being readable.
       */
      photoUnseen: false,
    },
  );

  const latencyMs = Date.now() - input.startedAt;

  const triageLogId = await logTriage({
    userId: input.userId,
    inputText: input.text,
    hadPhoto: Boolean(input.image),
    result: safeResult,
    source: "fallback",
    model: null,
    latencyMs,
    hazard: null,
    textHazard: null,
    visionHazard: null,
    reason: "ceiling-reached",
    photoRelevance: null,
    photoRelevanceReason: null,
  });

  return NextResponse.json(
    {
      result: safeResult,
      source: "fallback" satisfies TriageSource,
      latencyMs,
      photo: null,
      subBands: [],
      triageLogId,
      reason: "ceiling-reached" satisfies LoggableReason,
      model: null,
      /* Nobody asked the model anything, so there is no verdict on the words. */
      topic: null,
      /*
       * AND THE MATCHER'S OWN VERDICT RIDES ALONG, which is what stops a refused
       * call reading as a recommendation. This is the path the visitor in the
       * bug report was on: the ceiling fired six times and every one of them
       * rendered "Plumbing · Needed soon · Rs 900 – Rs 4,000" with the limit
       * notice below the fold, so the ceiling was invisible behind the thing it
       * had just refused to produce.
       */
      matched: answer.matched,
      /*
       * THE REFUSAL ITSELF, so the browser can render the sentence rather than inferring
       * one from the absence of an answer. It is data the card reads by `kind`, never a
       * message written here: the server does not know which language this reader has
       * chosen for a string the client already holds in both.
       */
      aiRefusal: input.refusal,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * The perceptual hash of an uploaded photograph, or null.
 *
 * SIXTEEN HEX CHARACTERS OF A 64-BIT dHASH — enough to say "this is the same file",
 * nowhere near enough to reconstruct anything, and nothing is stored. `perceptualHash`
 * answers null on bytes it cannot decode, and null here means the photograph is simply
 * not cacheable rather than that it is the same as every other undecodable one.
 */
function hashOfImage(base64: string): string | null {
  try {
    return perceptualHash(new Uint8Array(Buffer.from(base64, "base64")));
  } catch {
    return null;
  }
}
