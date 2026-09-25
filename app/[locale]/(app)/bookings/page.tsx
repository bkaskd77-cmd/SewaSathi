import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, Plus } from "lucide-react";

import { BookingRow } from "@/components/booking/booking-row";
import { NeedsYou, type NeedsYouItem } from "@/components/booking/needs-you";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import {
  attentionFor,
  formatSlotInstant,
  isHappeningNow,
  summarise,
} from "@/lib/booking";
import { site, supportPhoneDisplay } from "@/lib/config/site";
import { categoryCopy } from "@/lib/config/services";
import { listBookings } from "@/lib/data/bookings";
import { getCategories } from "@/lib/data/categories";
import {
  liveClaimsByBooking,
  unpaidRefundsByBooking,
} from "@/lib/data/claims";
import { unreadByBooking } from "@/lib/data/notifications";
import { listNoteKey } from "@/lib/notify/channel";
import { getProvider } from "@/lib/data/providers";
import { formatBand, formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return {
    title: t("bookingsTitle"),
    // Nothing here is useful to a search engine and some of it is personal.
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * The customer's home inside the product.
 *
 * IT WAS A LIST AND IT NEEDED TO BE A DASHBOARD. Every booking was the same
 * card in the same colour, newest first — so a professional on the way sat
 * between two jobs finished in June, and a booking silently waiting on a trip
 * confirmation looked exactly like one that was proceeding. The page answered
 * "what have I booked". Nobody opens it to ask that. They open it to ask **is
 * anything happening, and does anything need me**, and those are the two
 * things it now answers before it lists anything.
 *
 * THREE TIERS, in the order somebody reads them:
 *
 *   1. **Needs you** — the actions the customer is blocking. `attentionFor` is
 *      the rule and it is pure, so what counts as needing them is testable and
 *      can later drive a notification without being reimplemented.
 *   2. **Happening now** — live jobs, at full weight, carrying the name of the
 *      person who is coming and when.
 *   3. **Earlier** — finished and cancelled, quiet and small.
 *
 * STILL NO CLIENT JAVASCRIPT. The whole page is links, which is why it renders
 * correctly on a connection that never finishes loading a bundle — the state
 * somebody is most likely to be in when they are checking whether anybody is
 * coming.
 */
export default async function BookingsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.bookings");
  const tNote = await getTranslations("booking");
  const tServices = await getTranslations("services");
  // The claim's own status sentences, already written for the booking page.
  const tClaim = await getTranslations("booking.guarantee");

  // The middleware already guards this route. Repeated here because a page
  // that reads a session should not depend on something else having checked.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Fbookings", locale });
  }

  const [bookings, categories, unread] = await Promise.all([
    listBookings(profile!.id),
    getCategories(),
    unreadByBooking(),
  ]);

  /*
   * A FINISHED JOB WITH A CLAIM ON IT IS NOT FINISHED.
   *
   * The status stays `completed` for ever — the claim is a second visit, not a
   * rerun of the first — so a customer who had reported their tap leaking
   * again found their booking filed under "Earlier", beside jobs closed in
   * June, while they waited for us to send somebody. One query for the whole
   * list, because this page ships no client JavaScript on purpose and a read
   * per row would undo that on the connection it exists to serve.
   */
  const bookingIds = bookings.map((b) => b.id);
  const [liveClaims, refundsOwed] = await Promise.all([
    liveClaimsByBooking(bookingIds),
    // AND A REFUND WE HAVE AGREED AND NOT SENT IS NOT HISTORY EITHER. Two of
    // three rails need a person to go and move the money, so "approved" is
    // where it stops unless something keeps the booking in front of somebody.
    unpaidRefundsByBooking(bookingIds),
  ]);

  const categoryName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };

  const happening = (booking: (typeof bookings)[number]) =>
    isHappeningNow({
      status: booking.status,
      hasLiveClaim: liveClaims.has(booking.id),
      hasUnpaidRefund: refundsOwed.has(booking.id),
    });

  const live = bookings.filter(happening);
  const past = bookings.filter((b) => !happening(b));

  /*
   * WHO IS COMING. Only for live bookings, and only for the ones somebody has
   * accepted — which is a handful of rows at most, so the names are fetched in
   * one wave rather than one at a time. "Krishna is on the way" is a different
   * sentence from "On the way": the first says a person exists.
   */
  const providerNames = new Map<string, string>();
  await Promise.all(
    live
      .filter((booking) => booking.providerId)
      .map(async (booking) => {
        const provider = await getProvider(booking.providerId!);
        if (provider) providerNames.set(booking.id, provider.displayName);
      }),
  );

  const needsYou: NeedsYouItem[] = [];
  for (const booking of bookings) {
    const kind = attentionFor(booking);
    if (!kind) continue;
    needsYou.push({
      bookingId: booking.id,
      label: t(`needs.${kind}`),
      context: `${categoryName(booking.categorySlug)} · ${booking.reference}`,
      // Nothing is moving until they answer, and they cannot tell. A price
      // correction is the same gate one step later: the database refuses
      // `in_progress` while the question is open.
      blocking:
        kind === "confirmTrip" ||
        kind === "respondToCorrection" ||
        kind === "approveAmount",
    });
  }

  const totals = summarise(bookings);
  const firstName = profile!.fullName?.trim().split(/\s+/)[0];

  /** The unread marker, already turned into a sentence. */
  const noteFor = (bookingId: string) => {
    /*
     * The claim outranks an unread notification, because it is the reason the
     * booking is up here at all. "We are arranging a visit" is the answer to
     * the question somebody opened this page with; a card promoted out of
     * "Earlier" with nothing saying why reads as a bug.
     */
    const claim = liveClaims.get(bookingId);
    if (claim) return tClaim(`status.${claim}`);

    const event = unread.get(bookingId);
    if (!event) return null;
    /*
     * THROUGH THE ALLOW-LIST, never by stripping a prefix. Dropping
     * `booking.` is correct for the kinds that carry it and wrong for every
     * other one: an unread `claim.resolved` printed
     * `booking.notifications.claim.resolved` onto this list, because
     * next-intl reads a dot as nesting and renders a miss as its own key
     * path. `listNoteKey` returns null for a kind with no sentence, and a
     * card with no note is the honest version of "nothing to say".
     */
    const key = listNoteKey(event.kind);
    return key ? tNote(`notifications.${key}`) : null;
  };

  const amountLabel = (booking: (typeof bookings)[number]) => {
    if (booking.finalAmount !== null) {
      return formatNpr(booking.finalAmount, { locale });
    }
    // A survey booking nobody has priced yet has no band to show. "Rs 0–Rs 0"
    // beside a real price is worse than saying what is actually true.
    return (
      formatBand({ min: booking.quotedMin, max: booking.quotedMax }, { locale }) ??
      tServices("surveyPriced")
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* THE WAY OUT OF THIS PAGE IS FORWARDS.
          Somebody looking at their bookings is a customer who already trusts
          us enough to have used the product — the single most likely person to
          book again — and the only route to a second booking used to be the
          logo, the homepage, then a scroll. It sits in the header rather than
          at the bottom, because a customer with fifteen bookings should not
          have to scroll past all of them to find it. */}
      <header className="animate-rise flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-display-md">{t("title")}</h1>
          <p className="mt-2 text-body-md text-muted-foreground">
            {firstName ? t("leadNamed", { name: firstName }) : t("lead")}
          </p>
        </div>
        {bookings.length > 0 ? (
          <Button variant="gold" asChild className="btn-tactile shrink-0">
            <Link href="/services">
              <Plus aria-hidden="true" />
              {t("bookAnother")}
            </Link>
          </Button>
        ) : null}
      </header>

      {bookings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            delay={0.06}
            icon={CalendarDays}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Button variant="gold" size="lg" asChild className="btn-tactile">
                {/* The catalogue, not a homepage anchor: it is searchable,
                    filterable and shareable, and it is the same destination as
                    the header button so the two never disagree. */}
                <Link href="/services">{t("browse")}</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <NeedsYou heading={t("needsYou")} items={needsYou} />

          {live.length > 0 ? (
            <section className="mt-8" aria-labelledby="live-bookings">
              <h2
                id="live-bookings"
                className="animate-rise text-body-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("happeningNow")}
              </h2>
              <ul className="assemble mt-3 flex flex-col gap-3">
                {live.map((booking, i) => (
                  <BookingRow
                    key={booking.id}
                    index={i}
                    tone="live"
                    href={`/bookings/${booking.id}`}
                    categoryName={categoryName(booking.categorySlug)}
                    status={booking.status}
                    description={booking.description}
                    reference={booking.reference}
                    amountLabel={amountLabel(booking)}
                    providerName={providerNames.get(booking.id) ?? null}
                    whenLabel={
                      booking.scheduledFor
                        ? formatSlotInstant(booking.scheduledFor)
                        : t("asSoonAsPossible")
                    }
                    note={noteFor(booking.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="mt-8" aria-labelledby="past-bookings">
              <div className="animate-rise flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="past-bookings"
                  className="text-body-sm font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("earlier")}
                </h2>
                {/* THEIR OWN NUMBERS, AND ONLY THE ONES WE CAN STAND BEHIND.
                    `summarise` sums what was actually paid, so a quoted range
                    and an unpaid job both contribute nothing — a total a
                    customer can disprove with their own wallet is worse than
                    no total. */}
                {totals.done > 0 ? (
                  <p className="text-caption tabular-nums text-muted-foreground">
                    {t("summary", {
                      n: String(totals.done),
                      amount: formatNpr(totals.spent, { locale }),
                    })}
                  </p>
                ) : null}
              </div>
              <ul className="assemble mt-3 flex flex-col gap-2">
                {past.map((booking, i) => (
                  <BookingRow
                    key={booking.id}
                    index={i}
                    tone="past"
                    href={`/bookings/${booking.id}`}
                    categoryName={categoryName(booking.categorySlug)}
                    status={booking.status}
                    description={booking.description}
                    reference={booking.reference}
                    amountLabel={amountLabel(booking)}
                    note={noteFor(booking.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {/* Dropped whole rather than rewritten: "booked over the phone?" is
          only a question worth asking when there is a phone to have booked
          over. */}
      {site.supportPhone ? (
        <p
          className="animate-rise mt-8 text-center text-caption text-muted-foreground"
          style={{ animationDelay: "120ms" }}
        >
          {t.rich("phoneNote", {
            number: supportPhoneDisplay ?? "",
            phone: (chunks) => (
              <a
                href={`tel:${site.supportPhone}`}
                className="text-foreground underline underline-offset-2"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}
