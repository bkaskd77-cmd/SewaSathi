/**
 * What one model call actually cost, from what the provider said it used.
 *
 * MEASURED, NOT ESTIMATED, AND THAT IS THE WHOLE POINT OF THIS FILE. It would be easy to
 * price a triage from our own token guess — a photograph is about `width × height / 750`
 * tokens, a sentence is about sixty — and a ceiling computed that way drifts from the
 * bill in a direction nobody notices until the bill arrives. Every response carries a
 * `usage` block; this prices that block and nothing else.
 *
 * THE RATES ARE PER MODEL AND WRITTEN OUT, because a wrong rate is a wrong budget and a
 * derived-from-the-other-model rate is the kind of cleverness that survives a model
 * change. The cache multipliers ARE derived — 0.1× to read and 1.25× to write, which is
 * how ephemeral caching is priced — because those two move with the input rate by
 * definition rather than by coincidence.
 *
 * AN UNKNOWN MODEL IS PRICED AT THE MOST EXPENSIVE RATE WE KNOW, never at zero. A model
 * id we do not recognise is a model somebody switched to, and a budget that reads it as
 * free is a budget that stops working the day it matters most — rule 6 pointed at money:
 * unmeasured must not read as measured-at-zero.
 */

/** Dollars per million tokens, as published. */
export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
};

/** Reading a cached prefix is a tenth of the input rate; writing one is a quarter more. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** What the provider reports. Every field optional — an older response may omit one. */
export type ProviderUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export type CallCost = {
  usd: number;
  /** Carried so a spend row can be read back and argued with, not just totalled. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** True when the model id was not in the table and the dearest rate was used. */
  pricedAsUnknown: boolean;
};

function dearest(): ModelPrice {
  return Object.values(MODEL_PRICES).reduce((worst, price) =>
    price.inputPerMTok + price.outputPerMTok >
    worst.inputPerMTok + worst.outputPerMTok
      ? price
      : worst,
  );
}

export function priceCall(model: string, usage: ProviderUsage | null): CallCost {
  const known = MODEL_PRICES[model];
  const price = known ?? dearest();

  const input = Math.max(0, Number(usage?.input_tokens ?? 0));
  const output = Math.max(0, Number(usage?.output_tokens ?? 0));
  const cacheRead = Math.max(0, Number(usage?.cache_read_input_tokens ?? 0));
  const cacheWrite = Math.max(0, Number(usage?.cache_creation_input_tokens ?? 0));

  const usd =
    (input * price.inputPerMTok +
      output * price.outputPerMTok +
      cacheRead * price.inputPerMTok * CACHE_READ_MULTIPLIER +
      cacheWrite * price.inputPerMTok * CACHE_WRITE_MULTIPLIER) /
    1_000_000;

  return {
    usd,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    pricedAsUnknown: !known,
  };
}

/**
 * How the day's budget is divided, and what is left of each share.
 *
 * ONE-WAY RESERVATION. Visitors may have at most their share; signed-in users may have
 * everything that is left, including the part visitors did not use. A two-way split would
 * waste a quiet morning's visitor allowance on a busy afternoon, and the reservation
 * exists to protect the people who might book — not to ration them.
 */
export type BudgetShares = {
  spentUsd: number;
  visitorSpentUsd: number;
  /** What a visitor request may still spend. Zero means the category picker. */
  visitorRemainingUsd: number;
  /** What a signed-in request may still spend. */
  userRemainingUsd: number;
};

export function shareOf(input: {
  dailyBudgetUsd: number;
  visitorShareBps: number;
  spentUsd: number;
  visitorSpentUsd: number;
}): BudgetShares {
  const budget = Math.max(0, input.dailyBudgetUsd);
  const spent = Math.max(0, input.spentUsd);
  const visitorSpent = Math.max(0, input.visitorSpentUsd);

  const visitorCeiling = (budget * Math.max(0, input.visitorShareBps)) / 10_000;
  const left = Math.max(0, budget - spent);

  return {
    spentUsd: spent,
    visitorSpentUsd: visitorSpent,
    /* Bounded by BOTH: their own share and whatever is left of the whole day. A visitor
       cannot spend the last of the budget just because their own share is untouched. */
    visitorRemainingUsd: Math.max(0, Math.min(visitorCeiling - visitorSpent, left)),
    userRemainingUsd: left,
  };
}
