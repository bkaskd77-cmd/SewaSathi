-- A refund is the only part of the guarantee that moves real money.
--
-- The re-do is generous because it costs us almost nothing — the labour
-- belongs to the professional whose defect it was. A refund does not, so it is
-- the last rung and every one of them is decided by a person. These are the
-- four things no person may decide, because there is no legitimate case for
-- any of them:
--
--   * paying twice on one claim
--   * paying more than was ever collected
--   * paying out of a job nobody has settled, or one whose amount is in
--     dispute between the customer and the professional
--   * paying on a claim whose trade window had already closed
--
-- IN THE TRIGGER AND NOT ONLY IN THE ACTION. `lib/payments/refund.ts` judges
-- all four and returns a sentence a person can act on; this refuses them with
-- no service-role bypass, because a rule that decides money and has no
-- exception belongs where it cannot be routed around. Same posture as
-- `enforce_booking_address_ownership`.

create or replace function public.enforce_claim_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  window_days integer;
begin
  -- Nothing to check until money is actually being paid back.
  if coalesce(new.refund_rupees, 0) = 0 then
    return new;
  end if;

  /*
   * A REFUND NOBODY SIGNED IS NOT THIS FUNCTION'S REFUSAL.
   *
   * `enforce_claim_transition` owns "money back needs a person" and it is the
   * more fundamental rule — the anti-farming design in one line. This trigger
   * sorts alphabetically BEFORE that one, so without this early return its
   * message would preempt it and somebody would be told the booking was
   * unsettled when the real fault was that no human had decided anything.
   *
   * Returning early is safe rather than a hole: the row is still refused, by
   * the trigger whose sentence actually describes what is wrong.
   */
  if new.refund_decided_by is null then
    return new;
  end if;

  /*
   * NO DOUBLE PAYOUT. Once a figure is on the claim it is the figure. A
   * second one is a support conversation, not a button, and an EDIT of the
   * first is the same event wearing different clothes.
   */
  if tg_op = 'UPDATE'
     and coalesce(old.refund_rupees, 0) > 0
     and new.refund_rupees is distinct from old.refund_rupees then
    raise exception 'This claim has already been refunded'
      using errcode = 'check_violation';
  end if;

  select bk.payment_status, bk.final_amount, bk.customer_reported_amount,
         bk.amount_mismatch_at, bk.completed_at, bk.category_slug
    into b
    from public.bookings bk
   where bk.id = new.booking_id;

  if not found then
    raise exception 'A refund needs the booking it is refunding'
      using errcode = 'check_violation';
  end if;

  -- NOTHING ON AN UNSETTLED BOOKING. There is no money to give back.
  if b.payment_status is distinct from 'paid' or b.final_amount is null then
    raise exception 'That job has not been settled, so there is nothing to refund'
      using errcode = 'check_violation';
  end if;

  /*
   * AND NOTHING WHILE THE TWO FIGURES DISAGREE. A standing
   * `amount_mismatch_at` means a person is already deciding which number is
   * true; refunding against either would pick a side by accident, and pick it
   * in whichever direction happened to be written down.
   */
  if b.amount_mismatch_at is not null then
    raise exception 'The amount for that job is still in dispute'
      using errcode = 'check_violation';
  end if;

  /*
   * NOTHING ABOVE WHAT WAS COLLECTED. The lower of the two figures when they
   * differ — the same number whenever they agree. The cash screen promises
   * "up to the amount you enter", and that promise is a ceiling rather than a
   * floor.
   */
  if new.refund_rupees > least(
       b.final_amount,
       coalesce(b.customer_reported_amount, b.final_amount)
     ) then
    raise exception 'A refund cannot be more than the amount recorded for the job'
      using errcode = 'check_violation';
  end if;

  /*
   * NOTHING OUTSIDE THE WINDOW. `claimIsAllowed` checked this when the claim
   * was filed, but a refund is decided later — sometimes much later — and a
   * claim that sat open past its window must not become payable by waiting.
   * The windows mirror GUARANTEE_WINDOWS in lib/config/guarantee.ts; the
   * default is the ordinary repair window, so a trade added later is covered
   * rather than unguarded.
   */
  window_days := case b.category_slug
    when 'painting' then 90
    when 'home-cleaning' then 2
    when 'movers-packers' then 2
    else 30
  end;

  if b.completed_at is null
     or b.completed_at + (window_days || ' days')::interval < now() then
    raise exception 'That job''s guarantee window has closed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_claim_refund() from public, anon, authenticated;

drop trigger if exists guarantee_claims_enforce_refund on public.guarantee_claims;
create trigger guarantee_claims_enforce_refund
  before insert or update on public.guarantee_claims
  for each row execute function public.enforce_claim_refund();
