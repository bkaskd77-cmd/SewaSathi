import { NextResponse, type NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  hasAnthropicConfig,
  TRIAGE_MAX_TOKENS,
  TRIAGE_MODEL,
  TRIAGE_TIMEOUT_MS,
} from "@/lib/ai";
import {
  triageProblem as keywordTriage,
  type TriageResult,
} from "@/lib/ai/mockTriage";
import { TRIAGE_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { applySafetyFloor } from "@/lib/ai/safety";
import { parseTriageResponse } from "@/lib/ai/triage-schema";
import { checkTriageRateLimit } from "@/lib/server/rate-limit";
import { readTriageCache, writeTriageCache } from "@/lib/server/triage-cache";
import { logTriage } from "@/lib/server/triage-log";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";

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
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
): Promise<TriageResult | null> {
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
          text: TRIAGE_SYSTEM_PROMPT,
          // The prompt is byte-identical on every request, so it caches.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
    },
    { timeout: TRIAGE_TIMEOUT_MS, maxRetries: 0 },
  );

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return raw ? parseTriageResponse(raw) : null;
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

  if (image && base64Bytes(image.data) > MAX_IMAGE_BYTES) {
    return badRequest("That photo is too large. Try a smaller one.", 413);
  }

  const userId = await currentUserId();
  const limit = checkTriageRateLimit(rateLimitKey(request, userId));
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

  // Photos are never served from cache, and never written to it.
  const cached = !image && text ? readTriageCache(text) : null;

  let source: TriageSource = cached ? "cache" : "fallback";
  let result = cached;

  if (!result && hasAnthropicConfig()) {
    try {
      const answer = await askClaude(text, image);
      if (answer) {
        result = answer;
        source = "claude";
        if (!image && text) writeTriageCache(text, answer);
      }
    } catch (error) {
      // Timeout, rate limit at the provider, a 500, a network blip — all the
      // same from here: the keyword matcher answers instead.
      console.error(
        "[triage] Claude call failed, falling back:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!result) {
    result = keywordTriage(text);
    source = "fallback";
  }

  // Runs on every path, including the cache and the fallback. See lib/ai/safety.
  const { result: safeResult, hazard } = applySafetyFloor(text, result);

  const latencyMs = Date.now() - startedAt;

  await logTriage({
    userId,
    inputText: text,
    hadPhoto: Boolean(image),
    result: safeResult,
    source,
    model: source === "claude" ? TRIAGE_MODEL : null,
    latencyMs,
    hazard,
  });

  return NextResponse.json(
    { result: safeResult, source, latencyMs },
    { headers: { "cache-control": "no-store" } },
  );
}
