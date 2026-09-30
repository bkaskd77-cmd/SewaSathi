-- ---------------------------------------------------------------------------
-- Where a professional's money actually goes.
--
-- WHAT EXISTED, STATED CORRECTLY. An earlier draft of this header claimed
-- `provider_applications.payout_bank_name` was the only destination field
-- anywhere. It was not: `payout_account` has existed since `20260910000001`,
-- is shown to a reviewer, is hashed into `application_match_keys`, and holds
-- real account numbers. What it is not is a PAYABLE address — it is collected
-- once at review and nothing reads it to send money. This table is that home,
-- and the application field's own plaintext exposure is dealt with separately.
--
-- RETIRE, NEVER EDIT. A destination row is immutable once written: changing
-- where money goes inserts a new row and retires the old one. That is not
-- tidiness — a payout must be able to name the destination that was live when
-- it was sent, months later, when somebody asks where their money went. An
-- edited row makes every historical payout point at today's answer.
--
-- The trigger below enforces that FOR EVERY CALLER INCLUDING THE SERVICE ROLE,
-- like `refuse_rewrite` on `provider_ledger` and `security_events`. There is no
-- `auth.uid() is null` bypass on purpose: every write here is service-role
-- anyway, so a bypass would leave the guard enforcing nothing at all.
--
-- WHY THE 72-HOUR COOLDOWN IS A COLUMN AND NOT A CONSTANT IN THE APPLICATION.
-- `usable_from` is stamped at insert. An account-takeover's first move is to
-- change where the money goes, and the window is what gives the real person
-- time to see the notice and object. Deriving it at payout time from
-- `created_at` would make it a rule the payout run could forget; stamping it
-- makes the row carry its own answer.
-- ---------------------------------------------------------------------------

create table if not exists public.payout_destinations (
  id uuid primary key default gen_random_uuid(),

  provider_id uuid not null references public.providers (id) on delete cascade,

  -- Which rail. `bank` needs an account number; the wallets need the number the
  -- wallet is registered to, which is often NOT the number they sign in with —
  -- plenty of people use a spouse's or a family member's wallet, which
  -- `payoutIsSomebodyElses` already warns a reviewer about on the application.
  kind text not null check (kind in ('bank', 'esewa', 'khalti')),

  -- As given. Never rendered whole: `lib/payments/destination.ts` masks it, and
  -- that is the only place allowed to decide how much shows.
  account_ref text not null check (char_length(account_ref) between 3 and 64),
  account_name text not null check (char_length(account_name) between 2 and 120),
  -- Only meaningful for `bank`, and the check says so rather than leaving a
  -- wallet row carrying a bank name nobody set.
  bank_name text check (char_length(bank_name) <= 120),

  created_at timestamptz not null default now(),

  /*
   * NOT USABLE IMMEDIATELY. See the header: this is the takeover window, and
   * the payout run reads it rather than recomputing it.
   */
  usable_from timestamptz not null,

  /*
   * A PERSON SAW THE FIRST PAYOUT TO THIS DESTINATION.
   *
   * Null means nobody has confirmed it yet, which is different from zero
   * payouts having gone: a destination can be live, past its cooldown and still
   * unconfirmed. Rule 6 — the absence is the state, not a default.
   */
  first_payout_confirmed_at timestamptz,
  first_payout_confirmed_by uuid references public.profiles (id),

  -- Set when it is replaced. Never unset; the trigger refuses that.
  retired_at timestamptz
);

comment on table public.payout_destinations is
  'Where a professional is paid. Append-and-retire, never edited: a payout names the destination that was live when it was sent. Service-role reads only — anon and authenticated are revoked outright, because this is the one table whose contents are somebody''s bank account.';

-- At most one live destination per professional. A partial unique index rather
-- than an application check, the `our_reference` idiom: two concurrent changes
-- are refused by the database rather than remembered against by the caller.
create unique index if not exists payout_destinations_one_live_idx
  on public.payout_destinations (provider_id)
  where retired_at is null;

create index if not exists payout_destinations_provider_idx
  on public.payout_destinations (provider_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Retire, never edit — for everybody.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_destination_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payout destinations are retired, not deleted';
  end if;

  -- The three columns a later event may legitimately set.
  if new.provider_id is distinct from old.provider_id
     or new.kind is distinct from old.kind
     or new.account_ref is distinct from old.account_ref
     or new.account_name is distinct from old.account_name
     or new.bank_name is distinct from old.bank_name
     or new.created_at is distinct from old.created_at
     or new.usable_from is distinct from old.usable_from then
    raise exception 'a payout destination is replaced, not edited — insert a new row and retire this one';
  end if;

  -- Un-retiring would resurrect an address somebody deliberately replaced,
  -- which is the takeover path with an extra step.
  if old.retired_at is not null and new.retired_at is null then
    raise exception 'a retired payout destination cannot be brought back';
  end if;

  -- A confirmation is a fact about a moment; rewriting it would let a second
  -- look overwrite the first person's name on the record.
  if old.first_payout_confirmed_at is not null
     and new.first_payout_confirmed_at is distinct from old.first_payout_confirmed_at then
    raise exception 'the first-payout confirmation is already recorded';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_destination_immutability() from public, anon, authenticated;

drop trigger if exists payout_destinations_immutable on public.payout_destinations;
create trigger payout_destinations_immutable
  before update or delete on public.payout_destinations
  for each row execute function public.enforce_destination_immutability();

-- ---------------------------------------------------------------------------
-- Nobody with a browser reads this table.
--
-- NOT "no policy" — an explicit revoke. Supabase grants `anon` and
-- `authenticated` table-wide select/insert/update through a default privilege
-- on `public`, and RLS-with-no-policy would return no rows today while leaving
-- the privilege in place for the first person to add a well-meaning policy.
-- The `profiles` escalation was exactly that shape: the grant was the thing
-- nobody looked at. Revoke the privilege; do not rely on the absence of a rule.
--
-- The professional sees their own destination MASKED, through a server-rendered
-- page reading under the service role — never by querying this table. Showing
-- somebody their own account number in full adds nothing they do not already
-- know and puts it in a response, a cache and a screenshot.
-- ---------------------------------------------------------------------------
alter table public.payout_destinations enable row level security;

revoke all on public.payout_destinations from anon, authenticated;
