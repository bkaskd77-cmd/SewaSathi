-- The model is allowed to say "no trade", and the column is allowed to record it.
--
-- WHAT WAS BROKEN. The triage prompt has asked for an `onTopic` verdict since
-- the AI ceilings shipped. It never told the model what to put in `category`
-- when the answer is "this is not a home-service problem", because there is
-- nothing honest to put there — and `triageResponseSchema` had `category` as a
-- required enum. So a model that correctly judged a question off-topic produced
-- a reply this product threw away whole: `parseTriageResponse` returned null,
-- the route logged `unparseable`, the verdict went in the bin with it, and the
-- keyword matcher printed `GENERIC_RULE` — plumbing, "needed soon",
-- Rs 900-4,000 — at somebody who had pasted a paragraph of lorem ipsum.
--
-- Seven rows in production on 2026-10-10 say exactly that, every one of them
-- `source: fallback, reason: unparseable`, and the visitor reported it as
-- "it still gives the suggestion of plumbing with need soon tag".
--
-- A PROMPT THAT ASKS FOR AN ANSWER THE SCHEMA REFUSES is the same class this
-- repository keeps paying for: two halves each written carefully, and nobody
-- ran the pair. It is the `LOGGABLE_REASONS`-versus-check-constraint shape with
-- the second copy living in a prompt rather than in SQL.
--
-- TWO NEW REASONS AND NOT ONE, because the consequences differ completely:
--
--   * `off-topic` — the model read the words and said they are not about a
--     home. This ends a signed-out visitor's AI day and moves a signed-in
--     account's streak toward a 24-hour pause.
--   * `no-trade`  — a real home problem the model could not pin to one of the
--     ten. It costs nobody anything, and counting it is the only way to learn
--     that the ten categories do not cover what people are asking for.
--
-- Collapsing them would pause people for being vague, which is the one thing
-- `applyTopicVerdict`'s "BE GENEROUS" instruction exists to avoid.
--
-- `LOGGABLE_REASONS` in lib/ai/reason.ts is the other copy of this list and
-- `tests/unit/triage-reason.test.ts` reads every migration, takes the LAST
-- definition of this constraint and compares the two sets — so a value added to
-- one and not the other fails there rather than on the first production request
-- that produces it, which would lose the log row and the id that attributes
-- whatever booking followed.

alter table public.triage_logs
  drop constraint if exists triage_logs_reason_known;

alter table public.triage_logs
  add constraint triage_logs_reason_known check (
    reason is null or reason in (
      'ok',
      'cache-hit',
      'no-api-key',
      'timeout',
      'auth-rejected',
      'rate-limited',
      'provider-error',
      'unparseable',
      'ceiling-reached',
      'off-topic',
      'no-trade'
    )
  );

comment on column public.triage_logs.reason is
  'Why this answer came from where it did. Null is "not recorded" — the rows written before the column, never "nothing went wrong". `off-topic` and `no-trade` are REPLIES rather than faults: the model answered and named no trade, which the schema refused to accept for a whole phase. Mirrors LOGGABLE_REASONS in lib/ai/reason.ts.';
