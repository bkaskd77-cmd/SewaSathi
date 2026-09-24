/*
 * The base a professional's listing falls back to, written rather than defaulted.
 *
 * WHAT WAS WRONG. `providers.availability` is the value underneath both
 * self-declared stamps, and it was carrying two meanings at once:
 *
 *   - "I deliberately book ahead" — what the seeded listings say on purpose.
 *   - "nobody has ever touched this" — every professional we approved, because
 *     the column defaults to 'scheduled' and the approval insert in
 *     `lib/data/review.ts` never named it.
 *
 * Rule 6 again, the fifth time: a column default being read as a fact. And the
 * fact it was read as was `AVAILABILITY_SCORE['scheduled']`, which sat on the
 * floor tied with `busy` — a declared refusal. So every real professional
 * started life ranked as if they had said "not taking work", and stayed there
 * until they found the toggle. The seeded fixtures, authored at 'today',
 * outranked them. That is the same failure `avg_response_minutes` produced and
 * it was found the same way: by reading the live rows rather than the code.
 *
 * WHAT CHANGES HERE is only the backfill. The two writes that keep it true
 * from now on are in the application:
 *
 *   - approval writes 'today' explicitly (`lib/data/review.ts`)
 *   - clearing both stamps writes 'scheduled' explicitly
 *     (`byArrangement` in `lib/provider/availability.ts`, applied by
 *     `setAvailableNow` and `setBusyUntil`)
 *
 * The column default stays 'scheduled'. Lowering the risk of a forgotten
 * insert is what the explicit write is for; changing the default would only
 * move which value gets assumed, and a row that nobody named is exactly what
 * this migration exists to stop pretending about.
 *
 * SCOPED TO ROWS THAT CAME FROM AN APPLICATION. `application_id is not null`
 * is what tells a real approved professional from a seeded demo listing, and
 * the seeded 'scheduled' rows are authored on purpose — Hari Prasad Adhikari
 * and Pemba Sherpa are meant to read "by appointment". Rewriting those would
 * be inventing a claim on their behalf, which is the mistake in miniature.
 *
 * NO STAMP IS TOUCHED. `available_until`, `busy_until` and `on_job_since` are
 * live declarations and our own fact; a professional currently marked busy
 * stays busy, because the base is only what shows once nothing else does.
 */

update public.providers
   set availability = 'today'
 where application_id is not null
   and availability = 'scheduled';

comment on column public.providers.availability is
  'The state shown when neither self-declared stamp is live. Written explicitly: today at approval, scheduled when the professional clears both stamps. Never left to the column default — see 20260924000001.';
