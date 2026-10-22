/*
 * A SENTENCE WE CAN PUT IN FRONT OF EVERYBODY, WITHOUT A DEPLOY.
 *
 * "We are closed for Dashain", "payouts are a day late this week", "do not use
 * the gas line in Baneshwor until Friday" — every one of those is published
 * copy with a start and an end, and until now the only way to say any of them
 * was a commit. A product that cannot tell its customers something today is one
 * that says nothing on the day it matters most.
 *
 * AUDIENCE IS A COLUMN, which is the lesson from `notificationPath` one surface
 * over. "Payouts are late" is for professionals and "we are closed" is for
 * customers, and a banner shown to the wrong half is either noise or a
 * disclosure — a customer does not need to read that we are behind on paying
 * people. `everyone` is the third value rather than the default, so the
 * question is answered rather than skipped.
 *
 * THE WINDOW AND THE SWITCH ARE DIFFERENT FACTS, deliberately, where
 * `categories` needed them tied. `starts_at`/`ends_at` is when it was MEANT to
 * show; `enabled` is somebody taking it down now. A banner switched off inside
 * its window is a real state — the thing was wrong, or the outage ended early —
 * and collapsing them would lose which of the two happened. `announcements_window`
 * only refuses an end before its start.
 *
 * NULL `ends_at` IS "UNTIL SOMEBODY TAKES IT DOWN", never "for ever by
 * accident": `/admin/announcements` prints that in those words, because the
 * difference between a banner with an end date and one without is the
 * difference between a thing that stops and a thing somebody has to remember.
 *
 * NO HISTORY TABLE, and that is a decision rather than an omission. A band
 * revision is append-only because a disputed price is argued from it; a banner
 * is read and gone, and `security_events` already records every publish, edit
 * and withdrawal with the actor and the text. A second append-only table would
 * be two records of one thing.
 *
 * Ordering: create, then RLS, then the constraint, then the policy and the
 * grant. Per `npm run check:migrations`.
 */

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),

  /* Both languages or nothing. Rule 5: a banner in English on a Nepali page is
     the one place a missing translation is invisible, because a reader assumes
     it was meant that way. Both are NOT NULL and the form requires both. */
  body_en text not null check (length(btrim(body_en)) > 0),
  body_ne text not null check (length(btrim(body_ne)) > 0),

  /* Who it is for. `everyone` is a choice, not a fallback — see the note above. */
  audience text not null
    check (audience in ('customer', 'provider', 'everyone')),

  /*
   * HOW LOUD IT IS. Two levels and deliberately not four: `notice` is ordinary
   * information and `urgent` is a thing somebody must act on or know today.
   * A four-level scale invites a middle nobody can define, and every level
   * beyond the first that renders in a warning colour makes the real one
   * quieter — `/admin/signals`' reasoning about grading.
   */
  tone text not null default 'notice' check (tone in ('notice', 'urgent')),

  starts_at timestamptz not null default now(),
  /* NULL is "until somebody takes it down". */
  ends_at timestamptz,
  /* The kill switch, separate from the window. */
  enabled boolean not null default true,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz
);

alter table public.announcements enable row level security;

revoke all on public.announcements from anon, authenticated;

alter table public.announcements
  drop constraint if exists announcements_window;
alter table public.announcements
  add constraint announcements_window check (
    ends_at is null or ends_at > starts_at
  );

comment on column public.announcements.ends_at is
  'NULL is "until somebody takes it down", never "for ever by accident" — /admin/announcements says so in those words.';
comment on column public.announcements.enabled is
  'The kill switch, deliberately separate from the window: a banner switched off inside its window is a real state and collapsing the two would lose which happened.';

/*
 * ANYBODY MAY READ ONE, because the banner is on the landing page and a visitor
 * has no session. The rows hold published copy and nothing else — no person, no
 * amount, no id of anything private — so this is the `categories` posture
 * rather than the `bookings` one.
 *
 * WHICH rows are SHOWN is the query's filter and `showingNow`'s rule, not the
 * policy's: RLS is a floor, not a filter. A withdrawn or future banner being
 * readable costs nothing and the admin screen needs it.
 */
drop policy if exists "Anyone reads announcements" on public.announcements;
create policy "Anyone reads announcements"
  on public.announcements for select
  to anon, authenticated
  using (true);

/*
 * THE COLUMNS, NOT THE TABLE, which is `profiles`' own lesson applied before it
 * is a finding. A plain `grant select` would hand `anon` `created_by` and
 * `updated_by` as well — staff profile ids, readable from any browser on the
 * open internet, for no reason: `liveAnnouncements` selects exactly these eight
 * and the admin list reads the other two through the service role. The same
 * shape was decided out loud one table over and left wide
 * (`content_strings.updated_by`, "a staff id and no read selects it"); a grant
 * that matches the read costs nothing and needs no argument.
 */
grant select (
  id, body_en, body_ne, audience, tone, starts_at, ends_at, enabled
) on public.announcements to anon, authenticated;

/*
 * No write grant for either browser role. Every write is
 * `lib/data/announcements-admin.ts` under the service role, behind the admin
 * gate — this is copy that reaches every visitor, so a browser that could
 * insert one could put a sentence of its own on the landing page.
 */
