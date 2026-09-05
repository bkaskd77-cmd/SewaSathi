-- A booking may only be made at an address the customer owns.
--
-- FOUND IN THE PHASE 9 AUDIT, and it is the same shape as the two holes that
-- shipped before it: an id arrived from the browser and nothing checked whose
-- it was. `confirmBookingAction` takes `addressId` straight from the client
-- and hands it to `createBooking`, and the insert policy on `bookings` only
-- ever checked `customer_id = auth.uid()`. Nothing anywhere tied the address
-- to the person booking.
--
-- WHAT THAT IS WORTH TO AN ATTACKER. Address ids are uuids, so this is not
-- enumerable — but a booking carries its address to the professional who
-- accepts it, so anybody holding one address id could have a stranger sent to
-- that door. On a platform whose sensitive core is people's home addresses,
-- "you need to know a uuid first" is not a control.
--
-- IN THE DATABASE RATHER THAN THE ACTION, because the action is one caller of
-- `createBooking` and the next one will be written by somebody who has not
-- read this. No exception for the service role either: there is no legitimate
-- path that books a job at an address its customer does not own, so unlike
-- `enforce_booking_immutability` this one applies to every writer.

create or replace function public.enforce_booking_address_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select a.profile_id into owner
  from public.addresses a
  where a.id = new.address_id;

  if owner is null then
    raise exception 'That address does not exist'
      using errcode = 'foreign_key_violation';
  end if;

  if owner <> new.customer_id then
    raise exception 'A booking cannot be made at somebody else''s address'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_address_ownership()
  from public, anon, authenticated;

drop trigger if exists bookings_enforce_address_ownership on public.bookings;
create trigger bookings_enforce_address_ownership
  before insert or update of address_id, customer_id on public.bookings
  for each row execute function public.enforce_booking_address_ownership();
