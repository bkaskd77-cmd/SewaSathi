-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. No deviation: this
--   migration contains no statement whose first keyword is `DROP`.
--
-- ADDS: booking_photos.taken_at_source.
-- REMOVES: nothing.

-- ---------------------------------------------------------------------------
-- WHICH END READ THE CLOCK, because the two are not worth the same and a column that
-- cannot tell them apart is a money rule waiting to be written against the wrong one.
--
-- `exif` MEANS THE SERVER PARSED THE ORIGINAL BYTES. That is what an arrival photograph
-- gets: the file goes up as the phone wrote it and `checkUploadedImage` reads the EXIF
-- itself, so the timestamp is one we saw rather than one we were told.
--
-- `device` MEANS THE BROWSER SENT US A NUMBER. A booking photograph is resized on a canvas
-- before it is uploaded, and a canvas re-encode destroys EXIF — measured in Chromium, not
-- assumed — so the only moment that timestamp exists is in the browser, before the resize.
-- It is read there and sent along. Anybody can send a different one.
--
-- SO A `device` TIMESTAMP GATES NOTHING, and this column is how that stays true after
-- everybody who built it has forgotten. Booking photographs are flag-only; the guarantee
-- and no-show gates read `exif` timestamps and refuse to act on a `device` one.
--
-- NULL IS "NOT RECORDED", as everywhere else: no timestamp, or a row written before this
-- column existed. It is never "we checked and it was fine".
-- ---------------------------------------------------------------------------

alter table public.booking_photos
  add column if not exists taken_at_source text
    check (taken_at_source in ('exif', 'device'));

comment on column public.booking_photos.taken_at_source is
  'Which end read taken_at. exif = the server parsed the original bytes. device = the browser sent a number, because the canvas resize had already destroyed the EXIF — not evidence, and never a money gate. Null means not recorded.';
