-- ---------------------------------------------------------------------------
-- How long the reviewer actually had the evidence open.
--
-- NOT A BLOCKER, AND IT MUST NOT BECOME ONE. Nothing in the product refuses a
-- decision for being fast: a reviewer who has seen the same applicant twice, or
-- who opened the file this morning and is deciding this afternoon, is not doing
-- anything wrong. A gate on this number would be a gate on being efficient.
--
-- WHAT IT IS FOR IS THE PATTERN, AFTERWARDS. Nothing can make somebody look at
-- a photograph. What can be done is to make a run of two-second approvals
-- visible to whoever reads the audit trail later — which is a different and
-- more honest claim than pretending the interface enforces attention.
--
-- MEASURED FROM WHEN THE PAGE OPENED, not from when the session started, and
-- it is the browser's own number. It is therefore evidence about a habit and
-- never evidence about a person: somebody who wanted to defeat it could, and
-- the answer to that is that they would have to do it deliberately every time.
-- ---------------------------------------------------------------------------

alter table public.application_decisions
  add column if not exists seconds_on_evidence integer
    check (seconds_on_evidence is null or seconds_on_evidence >= 0);

comment on column public.application_decisions.seconds_on_evidence is
  'Seconds between the review page opening and the decision being sent, as reported by the browser. Never a gate — a pattern of two-second approvals should be visible afterwards, which is a more honest claim than pretending the interface enforces attention.';

alter table public.no_show_claims
  add column if not exists seconds_on_evidence integer
    check (seconds_on_evidence is null or seconds_on_evidence >= 0);

/*
 * A partial index on the fast ones, because that is the only query anybody
 * will ever run against this column: "show me the decisions nobody looked at".
 * Thirty seconds is not a threshold anything enforces, it is a place to start
 * reading.
 */
create index if not exists application_decisions_quick_idx
  on public.application_decisions (decided_by, decided_at desc)
  where seconds_on_evidence is not null and seconds_on_evidence < 30;
