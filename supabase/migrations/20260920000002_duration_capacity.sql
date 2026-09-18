-- The scheduler stops assuming every job is two hours.
--
-- `enforce_slot_capacity` carried `slot interval := interval '120 minutes'`
-- with a comment asking the next reader to keep it in step with
-- `WORKING_HOURS.slotHours` by hand. That number is now two different facts
-- wearing one name: the width of a slot the picker OFFERS, and how long a job
-- actually HOLDS. The first is still 120. The second is the booking's own.
--
-- WHAT IT GOT WRONG. A four-hour deep clean starting at ten ran until two, and
-- a forty-five-minute leak at one landed inside it — but under a fixed
-- two-hour window the clean ended at noon and the two never met. The second
-- customer was told somebody was coming and found out on the day that nobody
-- was, which is the exact failure slot capacity was built to prevent.
--
-- AND IT IS ASYMMETRIC, which a single constant cannot be. Swap the lengths
-- and those same two start times stop colliding.
--
-- `booking_working_minutes` is the one rule, mirrored by `workingMinutes` in
-- lib/booking/duration.ts, and `npm run check:duration` fails if the two
-- constants ever disagree. A "must match" comment is what this replaced.

create or replace function public.booking_working_minutes(
  p_estimated integer,
  p_provider_estimated integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- THE PROFESSIONAL'S FIGURE FIRST, because they have been to the site and we
  -- have not. Then ours from the sub-band. Then the hold — named for what it
  -- is, a reservation rather than an estimate, and exactly what every booking
  -- took before durations existed, so nothing regresses for a row whose
  -- product nobody could name. Mirrors UNESTIMATED_HOLD_MINUTES.
  select coalesce(p_provider_estimated, p_estimated, 120);
$$;

comment on function public.booking_working_minutes(integer, integer) is
  'How many minutes a booking holds: the professional''s figure, then ours, then the 120-minute hold. Mirrors workingMinutes() in lib/booking/duration.ts; npm run check:duration asserts the constants agree.';

revoke execute on function public.booking_working_minutes(integer, integer)
  from public, anon, authenticated;

create or replace function public.enforce_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted_start timestamptz;
  wanted_minutes integer;
  taken integer;
  allowed integer;
begin
  if new.provider_id is null then
    return new;
  end if;

  -- Only when the ASSIGNMENT, the WINDOW or the LENGTH moves. A job already
  -- legally held must not be re-judged on its way to `completed`, or settling
  -- a payment on a row somebody was allowed to overbook would raise. The
  -- length is in that list now: a professional correcting four hours to eight
  -- is moving the window as surely as moving the start time is.
  if tg_op = 'UPDATE'
     and new.provider_id is not distinct from old.provider_id
     and new.scheduled_for is not distinct from old.scheduled_for
     and new.estimated_working_minutes is not distinct from old.estimated_working_minutes
     and new.provider_estimated_working_minutes
         is not distinct from old.provider_estimated_working_minutes then
    return new;
  end if;

  -- SERIALISE ON THE PROFESSIONAL, or the count below is a read that lies.
  -- Two transactions claiming two different jobs for the same person at the
  -- same moment each see zero taken under read committed, both pass, and both
  -- commit — which is precisely the double-booking this rule exists to stop.
  -- The claim policy settles a race for ONE booking; this is a race for one
  -- professional's time across two. Transaction-scoped, keyed on the provider,
  -- so it is released at commit and never blocks anybody else's booking.
  --
  -- CARRIED OVER VERBATIM FROM 20260915000002, and the db suite is what
  -- noticed it had been dropped: rewriting this function for durations lost
  -- the lock, the tests went red on the race, and that is the third time a
  -- `create or replace` has quietly taken a version nobody intended.
  perform pg_advisory_xact_lock(hashtextextended(new.provider_id::text, 0));

  -- An as-soon-as-possible job starts now, which is what the customer asked
  -- for. `created_at` rather than now() so re-checking an existing row gives
  -- the same answer it gave when it was written.
  wanted_start := coalesce(new.scheduled_for, new.created_at, now());
  wanted_minutes := public.booking_working_minutes(
    new.estimated_working_minutes,
    new.provider_estimated_working_minutes
  );

  -- EACH SIDE MEASURED BY ITS OWN LENGTH. Half-open on both, as before: a job
  -- ending exactly as this one starts does NOT collide, or a full day of
  -- back-to-back work would read as a day of conflicts.
  select count(*) into taken
  from public.bookings b
  where b.provider_id = new.provider_id
    and b.id <> new.id
    and b.status in ('pending', 'accepted', 'en_route', 'in_progress')
    and coalesce(b.scheduled_for, b.created_at)
        < wanted_start + make_interval(mins => wanted_minutes)
    and wanted_start
        < coalesce(b.scheduled_for, b.created_at)
          + make_interval(mins => public.booking_working_minutes(
              b.estimated_working_minutes,
              b.provider_estimated_working_minutes
            ));

  allowed := public.booking_slot_capacity(
    new.provider_id,
    new.category_slug,
    new.overbook_offered_at is not null
  );

  if taken >= allowed then
    raise exception 'That professional is already booked for this time'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_slot_capacity()
  from public, anon, authenticated;

-- Unchanged, and re-stated because the function was replaced: sorts after
-- `bookings_enforce_immutability`, so the overbooking +1 has been proved
-- legitimate by the time capacity is counted.
drop trigger if exists bookings_enforce_slot_capacity on public.bookings;
create trigger bookings_enforce_slot_capacity
  before insert or update on public.bookings
  for each row execute function public.enforce_slot_capacity();
