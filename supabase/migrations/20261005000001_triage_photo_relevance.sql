-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. No deviation: this
--   migration contains no statement whose first keyword is `DROP`.
--
-- ADDS: triage_logs.photo_relevance, triage_logs.photo_relevance_reason.
-- REMOVES: nothing. No function is rebuilt and no policy is redefined.

-- ---------------------------------------------------------------------------
-- What the model made of the photo.
--
-- A JUDGEMENT, NOT A SCORE, AND THAT IS THE WHOLE SHAPE OF IT. Three named answers and a
-- sentence saying why, never a confidence number. A number invites a threshold, a
-- threshold reads as a measurement, and nobody has the data to choose one — which is
-- rule 6 in the form it takes for a model's opinion rather than for a column default.
--
-- `unclear` IS NOT `unrelated`, and the difference is what a customer is told. "I cannot
-- tell what this shows" asks for a clearer photo; "this is a different thing from what you
-- described" asks for the right one. Collapsing them would tell somebody with a dark photo
-- that they had photographed the wrong tap.
--
-- NULL IS "NO PHOTO, OR THE MODEL DID NOT SAY", which is one meaning to every reader:
-- nobody looked, so nothing is claimed. It must never read as "the photo was fine". Every
-- row written before these columns is silent and NOTHING IS BACKFILLED — the same refusal
-- `reason` and `text_hazard` already carry, for the same reason: a value invented for a
-- judgement nobody made manufactures a record out of an absence.
--
-- THE PHOTO ITSELF IS STILL NEVER STORED. This records what was concluded about a
-- photograph that was looked at and discarded, which is the promise the privacy page makes
-- and this does not change it.
-- ---------------------------------------------------------------------------

alter table public.triage_logs
  add column if not exists photo_relevance text
    check (photo_relevance in ('related', 'unrelated', 'unclear')),
  add column if not exists photo_relevance_reason text
    check (length(photo_relevance_reason) between 1 and 160);

comment on column public.triage_logs.photo_relevance is
  'Whether the photo showed the problem described: related, unrelated or unclear. Null means there was no photo or the model did not say — never "the photo was fine". Not backfilled.';

comment on column public.triage_logs.photo_relevance_reason is
  'The model''s own sentence saying what it saw, shown to the customer when asking for another photo. A reason rather than a score: a number would invite a threshold and read as a measurement.';
