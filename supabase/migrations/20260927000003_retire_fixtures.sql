-- The 28 seeded professionals leave the catalogue.
--
-- They were invented: named people with invented ratings, job counts,
-- completion rates and response times, browsable and bookable on a public URL.
-- Same class as the invented durations this product already gates and the
-- invented bookings the homepage no longer shows.
--
-- TWO GROUPS, BECAUSE DELETING ALL 28 WOULD DAMAGE REAL HISTORY.
-- `bookings.provider_id` is ON DELETE SET NULL. Four of the 28 hold real
-- bookings — including two with `payout_due_at` — so deleting them would leave
-- settled work recording that somebody was paid and nobody did it.
-- `sweepRedoRecovery` groups by `provider_id`; a settled booking with a null
-- provider is money attributed to no one. That is a worse falsehood than the
-- listing being visible, and unlike the listing it cannot be undone.
--
-- So: the 24 nothing references are deleted, and the 4 are retired.

-- A fixture is not dormant, and it is certainly not removed for cause.
-- `removed_at` is step 5 of the enforcement ladder; writing it here would put a
-- false accusation into every future report, which the schema already warns
-- about for exactly this conflation.
alter table public.providers
  drop constraint if exists providers_closed_reason_known;
alter table public.providers
  add constraint providers_closed_reason_known check (
    closed_reason is null
    or closed_reason in ('dormant', 'fixture')
  );

/*
 * WHAT ACTUALLY HIDES THEM IS `is_active`, and finding that out is the reason
 * this migration is shaped the way it is.
 *
 * `providers` has exactly one SELECT policy for anon and authenticated —
 * "Anyone reads active providers" — and its whole qualifier is `is_active`.
 * Neither `removed_at` nor `closed_at` appears in it. An earlier draft of this
 * change planned to add `closed_at is null` to that policy, which would have
 * been unnecessary and wrong. One policy also means there is no permissive
 * second policy quietly granting the same read, which is the trap that makes
 * most RLS narrowing pointless.
 *
 * `closed_at` and `closed_reason` ride alongside as the account of WHY, because
 * a row that is merely inactive says nothing about the cause.
 */
update public.providers
   set is_active = false,
       closed_at = coalesce(closed_at, now()),
       closed_reason = 'fixture'
 where application_id is null
   and (
     exists (select 1 from public.bookings b
              where b.provider_id = providers.id
                 or b.first_choice_provider_id = providers.id)
     or exists (select 1 from public.provider_ledger l where l.provider_id = providers.id)
     or exists (select 1 from public.booking_refusals r where r.provider_id = providers.id)
     or exists (select 1 from public.guarantee_claims g
                 where g.provider_id = providers.id
                    or g.attending_provider_id = providers.id)
   );

-- And the rest go. `provider_categories`, `provider_contacts` and
-- `provider_stats` cascade and are all derived from the row being removed.
delete from public.providers
 where application_id is null
   and closed_reason is distinct from 'fixture';
