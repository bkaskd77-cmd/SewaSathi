-- One claim, one visit — and the unique column was not enough.
--
-- `guarantee_claims.visit_booking_id` is `unique`, which stops TWO CLAIMS
-- SHARING ONE VISIT. It does not stop ONE CLAIM BEING POINTED AT A SECOND
-- BOOKING: the new id is unused, so the unique index is satisfied and the old
-- visit is simply orphaned — still `accepted`, still holding one of the
-- professional's capacity seats, on a claim that no longer references it.
--
-- I asserted in the phase plan that the unique column covered this. It does
-- not, and a test written against the assertion is what found out.
--
-- WHY THE GUARD CANNOT BE "NEVER CHANGES ONCE SET", which is what I would have
-- written without reading the live function first. `enforce_claim_transition`
-- DELIBERATELY CLEARS `visit_booking_id` when a claim goes back to `open` —
-- alongside `dispatched_at` and `attending_provider_id` — because a released
-- claim legitimately drops its visit and gets a new one when somebody else
-- accepts. So null->value and value->null are both ordinary. Only
-- value->DIFFERENT value is the bug.
--
-- The clause therefore sits AFTER the status block, so that on a release it
-- sees the null the release has just written rather than the value it
-- replaced.

create or replace function public.enforce_claim_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A claim must start as open, not %', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- A claim is a record of one job. Re-pointing it at another booking or
  -- another customer would rewrite history rather than continue it.
  if new.booking_id <> old.booking_id or new.customer_id <> old.customer_id then
    raise exception 'A claim cannot be moved to another booking or customer'
      using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    if not public.claim_transition_allowed(old.status, new.status) then
      raise exception 'A claim cannot go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    case new.status
      when 'dispatched' then new.dispatched_at := coalesce(new.dispatched_at, now());
      when 'attended'   then new.attended_at := coalesce(new.attended_at, now());
      when 'resolved'   then new.closed_at := coalesce(new.closed_at, now());
      when 'withdrawn'  then new.closed_at := coalesce(new.closed_at, now());
      when 'rejected'   then new.closed_at := coalesce(new.closed_at, now());
      -- Back to the pool: the professional sent to look declined it. Clear the
      -- assignment, exactly as the booking machine does on a release.
      when 'open' then
        new.dispatched_at := null;
        new.attending_provider_id := null;
        new.visit_booking_id := null;
      else null;
    end case;
  end if;

  /*
   * A VISIT IS NOT SWAPPED FOR ANOTHER ONE.
   *
   * Deliberately after the status block above, which nulls this column on a
   * release — so a release reaches here with null and passes, while a silent
   * repoint of a live claim is refused. The orphan it would otherwise leave is
   * a booking nobody can reach that still consumes the professional's day.
   */
  if old.visit_booking_id is not null
     and new.visit_booking_id is not null
     and new.visit_booking_id <> old.visit_booking_id then
    raise exception 'A claim already has a return visit'
      using errcode = 'check_violation';
  end if;

  -- THE VISIT IS THE VERIFICATION. Somebody has to have been there.
  if new.status = 'attended' and new.attending_provider_id is null then
    raise exception 'A claim cannot be attended by nobody'
      using errcode = 'check_violation';
  end if;

  if new.status = 'resolved' then
    if new.verdict is null then
      raise exception 'A claim cannot be resolved without a verdict'
        using errcode = 'check_violation';
    end if;
    if new.payer is null then
      raise exception 'A resolved claim must say who pays'
        using errcode = 'check_violation';
    end if;
  end if;

  -- MONEY BACK NEEDS A PERSON, and this is the line that says so.
  if new.refund_rupees > 0 and new.refund_decided_by is null then
    raise exception 'A refund has to be decided by somebody'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_claim_transition() from public;
