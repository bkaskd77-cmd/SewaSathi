/*
 * OPEN A FEW WARDS AND A FEW TRADES FIRST, AND WIDEN WITHOUT A DEPLOY.
 *
 * A soft launch is "we are only taking work in Baneshwor and Patan, and only
 * plumbing and electrical, until we know the first fifty jobs go well". Until
 * now the only mechanism that could express it was RETIREMENT — and that is the
 * wrong instrument, which is the whole reason this table exists rather than a
 * loop over `areas` and `categories`.
 *
 * NOT YET OPENED IS A THIRD STATE, AND RETIRING IS NOT IT. `areas.retired_at`
 * and `categories.retired_at` record that we STOPPED, with a reason, an actor
 * and a `security_events` row reading `area.retired`. Soft-launching thirteen
 * wards through that mechanism would demand thirteen reasons for a thing nobody
 * withdrew, and would write a history saying we pulled out of most of Kathmandu
 * and then went back in. That is false, and it is the conflation this schema
 * already refuses one table over, where `providers.closed_at` ("taking a
 * break") is deliberately not `removed_at` ("removed for cause") because
 * writing one for the other puts a false accusation into every future report.
 *
 * ONE ROW, AND THE SWITCH IS SEPARATE FROM THE LISTS. That separation is rule 6
 * and it is the only part of this design that is load-bearing:
 *
 *   - `enabled = false`  -> the scope is not in force. Everything live is open,
 *                           which is the product's normal state and today's.
 *   - `enabled = true`   -> only what the two arrays name is open.
 *
 * An empty array therefore CANNOT mean "everything" and cannot mean "nothing"
 * by accident: the switch says which question is being asked, and the arrays
 * only ever answer the narrow one. Collapsing them — "empty means no scope" —
 * is the default-as-measurement mistake, and it would make the most dangerous
 * state (nothing open) unreachable while making the second most dangerous one
 * (everything open) the result of a truncated write.
 *
 * ENABLED WITH NOTHING NAMED IS A REAL STATE and is not refused here. It is
 * "we are not taking bookings anywhere", which is a thing somebody may
 * genuinely want on a bad morning, and it is reversible in one tap.
 * `/admin/launch-scope` says so in those words rather than the database
 * guessing at intent.
 *
 * THE ROW IS SEEDED, which is what makes a failed read legible. Zero rows would
 * otherwise be indistinguishable from "the scope is off", and the reads here
 * REFUSE on an unreadable scope rather than opening everything —
 * `bookableAreas()`' rule, for its stated reason: offering a ward we are not
 * serving takes a booking nobody will travel to. So the seed is the last
 * statement in this file: stopping anywhere before it leaves the catalogue
 * unreadable, which is the closed direction, and `npm run check:migrations`
 * exists to keep every migration that way.
 *
 * NO HISTORY TABLE, for the reason `announcements` gives: `security_events`
 * already records every change here with the actor, the previous scope and the
 * new one, and a second append-only table would be two records of one thing.
 * "When did we open ward 12?" is answered from the log.
 *
 * NO FOREIGN KEYS ON THE ARRAYS, deliberately and consistently with every other
 * place these keys are held: `addresses.area_key`, `provider_leads.area_key`,
 * `providers.service_areas` and `bookings.category_slug` all carry them bare,
 * because a key frozen on a row must keep resolving after the thing it names is
 * withdrawn. A scope naming a retired ward is harmless — the reads intersect
 * with the live list, so it narrows to nothing rather than resurrecting it.
 *
 * Ordering: create, then RLS and the revokes, then the constraint, then the
 * policy and the grant, then the seed. Per `npm run check:migrations`.
 */

create table if not exists public.launch_scope (
  /*
   * A SINGLETON, enforced rather than hoped for. `default true` plus the check
   * below means the table can hold exactly one row, so no caller has to know
   * which id to read and no second row can appear to disagree with the first.
   */
  id boolean primary key default true,

  /* The switch. FALSE is the product's normal state: no scope, everything live
     is open. See the header — this is never derived from the arrays. */
  enabled boolean not null default false,

  /* What is open while `enabled`. Area keys as `areas.key` spells them and
     category slugs as `categories.slug` does. */
  area_keys text[] not null default '{}',
  category_slugs text[] not null default '{}',

  /*
   * WHY WE ARE STARTING HERE, optional and for us. Unlike `retired_reason` this
   * is not required: a withdrawal raises the question "why did we stop serving
   * ward 26" six months later, where a soft launch is a plan somebody is
   * executing and the log carries each change anyway. A required box on a
   * screen somebody touches weekly is a box that fills up with "widening".
   */
  note text,

  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.launch_scope enable row level security;

revoke all on public.launch_scope from anon, authenticated;

alter table public.launch_scope
  drop constraint if exists launch_scope_singleton;
alter table public.launch_scope
  add constraint launch_scope_singleton check (id);

comment on table public.launch_scope is
  'One row. Which wards and trades are open to CUSTOMERS during a soft launch — distinct from retirement, which records that we stopped. See the migration header.';
comment on column public.launch_scope.enabled is
  'FALSE is "no scope, everything live is open" and is the normal state. The switch is deliberately separate from the arrays: an empty array must never be readable as "everything".';
comment on column public.launch_scope.area_keys is
  'Open wards while enabled. No foreign key, like every other holder of these keys — a scope naming a retired ward narrows to nothing rather than resurrecting it.';

/*
 * ANYBODY MAY READ IT, because the catalogue and the booking flow are read
 * through the cookie-free anon client and a visitor has no session. The row
 * holds two lists of public identifiers and a switch — nothing about a person,
 * no amount — so this is the `categories` posture rather than the `bookings`
 * one, and the lists are inferable from the catalogue it filters anyway.
 */
drop policy if exists "Anyone reads the launch scope" on public.launch_scope;
create policy "Anyone reads the launch scope"
  on public.launch_scope for select
  to anon, authenticated
  using (true);

/*
 * THE COLUMNS, NOT THE TABLE — `profiles`' lesson, applied before it is a
 * finding. `note` is an internal plan and `updated_by` is a staff profile id;
 * neither belongs on the open internet, and the reads in `lib/data/launch-scope.ts`
 * select exactly these three while the admin screen reads the rest through the
 * service role.
 */
grant select (enabled, area_keys, category_slugs)
  on public.launch_scope to anon, authenticated;

/*
 * No write grant for either browser role. Every write is
 * `lib/data/launch-scope-admin.ts` under the service role behind
 * `freshAdminActor()`, because a browser that could update this row could open
 * every ward in the country or close the product.
 */

/*
 * THE SEED, LAST. One row, scope off, so the product's behaviour is unchanged
 * by this migration and a read that comes back empty means something is wrong
 * rather than meaning "no scope".
 */
insert into public.launch_scope (id, enabled, area_keys, category_slugs, note)
values (true, false, '{}', '{}', null)
on conflict (id) do nothing;
