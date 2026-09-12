-- A reference is a person, and one person vouching for many applicants is a
-- fact worth seeing.
--
-- WHY THIS IS THE CHEAPEST COLLUSION AVAILABLE. References are the only human
-- check on competence in this whole phase — a CTEVT certificate is a document
-- like any other, but a reference is somebody picking up a phone and saying
-- "yes, he did my bathroom". So the way to defeat the check is not to forge
-- anything. It is to have one friend vouch for six applicants, and until now
-- that was completely invisible: reference numbers were stored on the
-- application and compared against nothing.
--
-- IT IS A SIGNAL, NOT A REFUSAL, AND THE WEIGHT SAYS SO. A foreman vouching
-- for his whole crew is the ordinary case and must not be punished — that is
-- exactly the supply this platform wants. Two applicants sharing a referee is
-- unremarkable; six is a pattern, and a pattern is something a reviewer should
-- see rather than something a rule should decide. So `reference` carries a low
-- weight in `MATCH_WEIGHTS` and its value is that it appears at all.
--
-- Hashed like every other key: a leak of this table must not be a list of
-- everybody's phone number. Matching is equality, so the hash costs nothing.

alter table public.application_match_keys
  drop constraint if exists application_match_keys_kind_check;

alter table public.application_match_keys
  add constraint application_match_keys_kind_check
  check (kind in ('document', 'account', 'name', 'area', 'device', 'face', 'reference'));
