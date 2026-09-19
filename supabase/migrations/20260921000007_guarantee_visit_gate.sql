-- Who pays for a return visit, and the moment after which it is settled.
--
-- THE COMPLAINT THIS ANSWERS. A professional arriving at a free redo and
-- saying "this isn't covered, it's Rs 3,000" leaves somebody with no real
-- choice, because that person is already in their house. Charging for a
-- genuinely different problem is right — without it, "free redo" is a standing
-- offer to have any job redone by breaking it again — but it cannot be sprung
-- at the door.
--
-- SO THE GATE IS NOT AT THE DOOR EITHER. Arriving and diagnosing is always
-- free and always covered: for plumbing, electrical, appliances and AC you
-- often cannot tell a returning fault from a new one without opening something
-- up, and a rule that demanded the answer first would force a guess, made by
-- the person whose own work is being judged, with money on it. The gate sits
-- before REMEDIAL WORK on a different problem.
--
-- WHICH `enforce_price_correction` ALREADY ENFORCES, UNCHANGED. That function
-- has no service-role bypass and its last clause refuses `in_progress` while a
-- correction is unanswered. On a visit booking that sentence means: you cannot
-- start work while the different-problem question is open. This file adds only
-- what that one does not say.
--
-- `billable` FLIPS ON THE CUSTOMER'S AGREEMENT, NOT ON THE VERDICT. The
-- verdict is recorded when the claim resolves, which is AFTER the work — too
-- late to be the thing that decides whether the work was chargeable. The
-- customer agreeing to the proposed different problem is the moment, and it
-- necessarily precedes the work.

create or replace function public.enforce_guarantee_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Ordinary bookings are none of this function's business.
  if new.guarantee_claim_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.billable is distinct from old.billable then
    /*
     * WORK HAS BEGUN IS A RECORDED MOMENT, NOT A JUDGEMENT. `started_at` is
     * stamped by the status trigger when the booking reaches `in_progress`, so
     * there is no argument later about when the line was crossed and no column
     * had to be invented to hold it.
     */
    if old.started_at is not null then
      raise exception 'Work has already started on this visit, so who pays for it is settled'
        using errcode = 'check_violation';
    end if;

    /*
     * NEVER BACK TO FREE. Once a visit has become an ordinary job at an agreed
     * price, making it free again would erase a bill the customer accepted —
     * and would be the obvious way to launder a chargeable job into a covered
     * one.
     */
    if old.billable and not new.billable then
      raise exception 'A visit that became an ordinary job cannot be made free again'
        using errcode = 'check_violation';
    end if;

    /*
     * AND IT ONLY BECOMES CHARGEABLE WHEN THE CUSTOMER HAS SAID SO. Not when
     * the professional proposes, and not when the verdict lands — the verdict
     * is written at resolution, after the work, which is exactly the "charged
     * afterwards" outcome this whole design exists to prevent.
     */
    if new.billable and new.band_change_approved_at is null then
      raise exception 'A return visit is chargeable only once the customer has agreed to the different problem'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_guarantee_visit() from public, anon, authenticated;

/*
 * Sorts before `bookings_enforce_immutability`, so it fires first. It only
 * ever refuses, so the ordering is safe either way — but a refusal the browser
 * sees before the immutability message is the more useful of the two.
 */
drop trigger if exists bookings_enforce_guarantee_visit on public.bookings;
create trigger bookings_enforce_guarantee_visit
  before insert or update on public.bookings
  for each row execute function public.enforce_guarantee_visit();

-- ---------------------------------------------------------------------------
-- The declined redo earns the trip, and it is counted as its own outcome
-- ---------------------------------------------------------------------------
--
-- Same Rs 500 as a declined correction: born `pending`, refused with no
-- recorded arrival, capped at four a month, paid only when a person approves
-- it. The travel and the diagnosis were real work whoever turned out to be
-- right, and unpaid callbacks are callbacks that stop being accepted.
--
-- ITS OWN OUTCOME VALUE BECAUSE THE PATTERN IS THE POINT. A run of declined
-- "different problem" claims by one professional is the signal that gate is
-- missing while leakage scoring does not exist; folded in with `band-declined`
-- it would be invisible.

alter table public.survey_visit_fees
  drop constraint if exists survey_visit_fees_outcome_check;
alter table public.survey_visit_fees
  add constraint survey_visit_fees_outcome_check
  check (outcome in ('declined', 'expired', 'band-declined', 'redo-declined'));
