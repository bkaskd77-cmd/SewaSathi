-- REMOVES: nothing. Two nullable columns are added to `triage_logs`; no
-- column, policy, function, grant or guard clause is dropped or weakened.
--
-- ===========================================================================
-- Both hazard readings, because the column we had records only the winner.
--
-- WHAT WAS CLAIMED AND IS NOT TRUE. CLAUDE.md says `hazard` is written as
-- `text:gas` or `vision:burning` "so the two detectors can be compared later",
-- and the comment at the write site adds "without a schema change". Neither
-- holds. `applySafetyFloor` computes
--
--     via = textHazard ? 'text' : visionHazard ? 'vision' : …
--
-- so the text guard wins whenever both fire, and `vision:*` is written ONLY on
-- rows where the text guard found nothing. The column therefore records which
-- detector won, not what each one said.
--
-- WHAT THAT COSTS. "Vision caught what text missed" is measurable — it is
-- exactly what a `vision:*` row means. Agreement is not. "Text caught what
-- vision missed" is not. The two firing on DIFFERENT hazards is not. That is
-- most of the comparison, and it is the half that would tell us whether the
-- expensive detector is earning its place.
--
-- SO BOTH READINGS ARE KEPT, and `hazard` is left exactly as it is. It is the
-- effective outcome — what the customer was actually shown — and several
-- things read it. These two are what each detector independently said, before
-- one of them won.
--
-- NULL IS "NOT RECORDED", NEVER "NO HAZARD" — rule 6, and it bites on day one
-- rather than in theory: every row written before this migration has null in
-- both columns, and those rows are not evidence that the detectors stayed
-- quiet. Anything reading these has to tell "the detector said nothing" apart
-- from "we were not keeping this yet", and `lib/data/triage-accuracy.ts` does.
--
-- THE VISION READ IS NULL FOR A SECOND, DIFFERENT REASON and the two must not
-- be conflated either: the model only looks at a photo when the model answered
-- at all. On a fallback, or with no photo attached, nobody looked — which is
-- what `hazard = 'unseen-photo'` already records for the case that matters.
-- ===========================================================================

alter table public.triage_logs
  add column if not exists text_hazard text;

alter table public.triage_logs
  add column if not exists vision_hazard text;

comment on column public.triage_logs.text_hazard is
  'What the deterministic text guard found, independent of which detector won. Null means not recorded — either the row predates this column, or the guard found nothing. Never read as "no hazard" on its own.';

comment on column public.triage_logs.vision_hazard is
  'What the model read from the photo, independent of which detector won. Null also covers "nobody looked": there was no photo, or the model did not answer. `hazard = unseen-photo` is the case where a photo went unread.';

-- Only rows where a detector actually said something are interesting, and they
-- are the rare ones. A partial index keeps the comparison cheap without
-- indexing the overwhelming majority of rows where both are null.
create index if not exists triage_logs_hazard_readings_idx
  on public.triage_logs (created_at desc)
  where text_hazard is not null or vision_hazard is not null;
