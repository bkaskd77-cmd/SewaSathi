# `lib/ai`

Triage. The feature the product is built around.

| file               | what it is                                                          |
| ------------------ | ------------------------------------------------------------------- |
| `triage.ts`        | What the browser calls. Posts to `/api/triage`, falls back locally. |
| `client.ts`        | Anthropic client, model, token cap, timeout. `server-only`.         |
| `prompt.ts`        | The system prompt, generated from the categories and price bands.   |
| `price-bands.ts`   | Reference prices for the prompt, derived from `mockTriage`'s rules. |
| `triage-schema.ts` | Zod validation, price clamp. Anything invalid returns null.         |
| `safety.ts`        | The hazard floor. Pure, runs on the server and in the browser.      |
| `mockTriage.ts`    | The keyword matcher — now the fallback, not the product.            |

The route is `app/api/triage/route.ts`. The key never leaves the server.

## Rules

**Never let a failure reach the user as an error.** Timeout, 500, bad JSON,
invented category, rate limit: all of them end at `triageProblem` in
`mockTriage.ts`. Someone who typed "tap leaking" gets an answer.

**Never weaken the safety floor.** `applySafetyFloor` runs on every result from
every source. The prompt asks Claude for the same behaviour, but the guard is
what makes it a guarantee. If you add a hazard word, add it there — not only to
the prompt.

**The price bands are ours, not the model's.** They live in `price-bands.ts`,
derived from `KEYWORD_RULES` so repricing happens in one place, and the route
clamps the answer back into the band.

**`TriageResult` is the contract.** The hero renders it and Phase 5 will route
on it. Adding a field means changing both.

## Things that were considered and not done

- **Streaming.** The object is small and has to clear validation, the clamp and
  the safety floor before anyone sees it. A skeleton is the better trade.
- **Structured outputs (`output_config.format`).** Would remove the JSON
  parsing. Worth revisiting once it can be verified against this model from a
  machine that can reach the API — the fallback would be a 400 on every call,
  so it was not worth guessing at.
- **Storing the photo.** Not needed for triage, and it changes what this
  product holds about people. `triage_logs.had_photo` is a boolean.
