import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { MapPin, MapPinOff, Phone } from "lucide-react";

import { ClaimDecision } from "@/components/admin/claim-decision";
import { DisputeDecision } from "@/components/admin/dispute-decision";
import { QueueExtent } from "@/components/admin/queue-extent";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { openNoShowClaims, openTripDebtDisputes } from "@/lib/data/review";
import { formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Wasted trips waiting on a person.
 *
 * WHAT THIS SCREEN IS ACTUALLY DECIDING. Not whether to pay the professional —
 * that has usually already happened, or will regardless. It is deciding who
 * ends up carrying the Rs 350: the customer, through their next bill, or us.
 * Saying that out loud at the top matters, because a reviewer who thinks they
 * are deciding a professional's wages reads the evidence very differently from
 * one who knows they are deciding a write-off.
 *
 * THE EVIDENCE IS THE PAGE. How long they waited, how many times they rang,
 * whether the phone gave a location, whether the customer had confirmed, and
 * whether that door has ever worked before. Each one is a sentence rather than
 * a flag, because a reviewer acts on sentences.
 */
export default async function ClaimsQueuePage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.claims");

  /*
   * ROLE AND SECOND FACTOR IN ONE PLACE. Six pages and eight actions
   * each re-read the role; adding a second condition to all fourteen by
   * hand is how one of them ends up without it, and that one is the hole.
   */
  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") redirect({ href: "/login?next=/admin/claims", locale });
    // A 404 rather than a refusal: a signed-in customer learns nothing
    // about what exists here, which is what notFound() has always been for.
    if (gate.reason === "notAdmin") notFound();
    // An admin who has to set up or use their code first. They come back.
    redirect({ href: "/account/security?next=/admin/claims", locale });
  }

  const [queue, disputes, messages] = await Promise.all([
    // Passed so the queue can log that it put customer risk on screen —
    // see `recordRiskAccess` and the note in `openNoShowClaims`.
    openNoShowClaims({ adminId: gate.profile.id }),
    /*
     * THE OTHER HALF OF THE SAME STORY, ON THE SAME SCREEN. A dispute is a customer
     * objecting to a charge that came out of one of the claims above, so a reviewer
     * reading one wants the other in reach. It is a separate queue because it is a
     * separate decision — whether to COLLECT, not whether to pay.
     */
    openTripDebtDisputes({ adminId: gate.profile.id }),
    getMessages(),
  ]);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>
      <QueueExtent page={queue} />

      {queue.rows.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {queue.rows.map((claim, index) => (
            <li
              key={claim.id}
              className="animate-rise rounded-lg border border-border p-5"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {claim.providerName ?? "—"}
                </span>
                <span className="text-caption text-muted-foreground">
                  {claim.reference}
                </span>
              </div>

              <p className="mt-2 text-body-sm">
                {t("waited", {
                  minutes: String(claim.waitedMinutes),
                  count: claim.contactAttempts,
                })}
              </p>

              {/*
                WHICH BUTTON, because a call and a message are not the same attempt.
                A missed call tells a customer somebody wants them; a WhatsApp message
                sits unread in an app. Only shown when there is a breakdown worth
                showing — a line reading "0 calls, 0 messages" repeats the sentence
                above it.
              */}
              {claim.contactAttempts > 0 ? (
                <p className="text-caption mt-1 text-muted-foreground">
                  {t("channels", {
                    callCount: claim.contactChannels.call,
                    messageCount: claim.contactChannels.whatsapp,
                  })}
                </p>
              ) : null}

              {/*
                WHAT THE EVIDENCE ACTUALLY IS, said on the screen where somebody
                decides to pay. The WAIT is still a number the professional typed; the
                attempts and the arrival stamp are ours. The sentence was rewritten
                when the call count stopped being typed — leaving it saying both were
                self-reported would have been a comment describing behaviour the code
                no longer had, in the place it does the most harm.
              */}
              <p className="text-caption mt-1 text-muted-foreground">
                {t("selfReported")}
              </p>

              {/*
                THEIR OWN RECORD, with its denominator. We fund this now, so the
                question "is this their first claim in forty jobs or their fourth
                in five" is part of the decision. It is review, not punishment:
                nothing scores it and nothing acts on it.
              */}
              <p className="text-caption mt-1 text-muted-foreground">
                {claim.claimHistory.jobs === null
                  ? t("claimRateUnreadable", {
                      n: String(claim.claimHistory.claims),
                      count: claim.claimHistory.claims,
                    })
                  : t("claimRate", {
                      n: String(claim.claimHistory.claims),
                      count: claim.claimHistory.claims,
                      jobs: String(claim.claimHistory.jobs),
                      jobCount: claim.claimHistory.jobs,
                    })}
              </p>

              {/*
                THE PHOTOGRAPH AND WHAT ITS CLOCK SAID. The picture is the strongest
                thing a professional can offer and it is still not proof — it is a
                photograph of *a* door. What makes it worth funding a payment on is the
                skew: one taken three hours before the visit is a different claim.

                "NOT RECORDED" IS SAID OUT LOUD rather than left as a blank, because
                most photographs carry no EXIF at all — our own compressor strips it,
                and so does every messaging app. A silent absence reads as agreement.
              */}
              {claim.photoPath ? (
                <ClaimPhoto
                  bookingId={claim.bookingId}
                  path={claim.photoPath}
                  adminId={gate.profile.id}
                  skewMinutes={claim.photoSkewMinutes}
                />
              ) : null}

              <ul className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  {claim.hasLocation ? (
                    <MapPin aria-hidden="true" className="size-4" />
                  ) : (
                    <MapPinOff aria-hidden="true" className="size-4" />
                  )}
                  {claim.hasLocation ? t("locatedUnverified") : t("noLocation")}
                </li>
                {claim.customerConfirmed ? (
                  <li className="flex items-center gap-1.5 text-warning-ink">
                    <Phone aria-hidden="true" className="size-4" />
                    {t("customerConfirmed")}
                  </li>
                ) : null}
                {claim.addressProven ? (
                  <li className="text-warning-ink">{t("addressProven")}</li>
                ) : null}
                {claim.customerDisputed ? (
                  <li className="text-warning-ink">{t("disputed")}</li>
                ) : null}
              </ul>

              {claim.customerNote ? (
                <p className="mt-3 rounded-md border border-border p-3 text-body-sm">
                  {claim.customerNote}
                </p>
              ) : null}

              <p className="mt-3 text-caption text-muted-foreground">
                {claim.wouldBeAbsorbed
                  ? t("absorbed")
                  : t("recovered")}
                {" · "}
                {t("paid", { amount: formatNpr(claim.tripRupees, { locale }) })}
              </p>

              <NextIntlClientProvider
                locale={locale}
                messages={{ admin: messages.admin }}
              >
                <ClaimDecision bookingId={claim.bookingId} />
              </NextIntlClientProvider>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------- disputed trip charges ---------------- */}
      {/*
        BELOW THE CLAIMS, NOT MIXED INTO THEM. The forms do different things: one
        decides whether the professional is paid and who carries it, the other whether
        a charge already decided should be collected. One list with two kinds of card
        is how somebody submits the wrong one.

        NOTHING IS RENDERED WHEN THE QUEUE IS EMPTY AND THE READ WORKED — an empty
        heading is padding. A FAILED read is said out loud, because "no disputes" and
        "we could not ask" must not look alike on a screen where somebody concludes
        there is nothing to do.
      */}
      {disputes.total === null ? (
        <p className="animate-rise mt-10 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-sm">
          {t("disputesUnreadable")}
        </p>
      ) : disputes.rows.length === 0 ? null : (
        <>
          <h2 className="animate-rise font-display mt-12 text-heading-sm">
            {t("disputesTitle")}
          </h2>
          <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
            {t("disputesLead")}
          </p>
          <QueueExtent page={disputes} />

          <ul className="mt-6 space-y-4">
            {disputes.rows.map((dispute, index) => (
              <li
                key={dispute.customerId}
                className="animate-rise rounded-lg border border-border p-5"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-heading-sm">
                    {dispute.customerName ?? "—"}
                  </span>
                  <span className="text-body-md tabular-nums">
                    {formatNpr(dispute.debtRupees, { locale })}
                  </span>
                </div>

                <p className="text-caption mt-1 text-muted-foreground">
                  {t("disputeOpened", {
                    date: formatInstant(dispute.disputedAt, locale),
                  })}
                </p>

                {/*
                  THEIR RECORD WITH ITS DENOMINATOR, the same rule as the claim cards:
                  one missed door in forty jobs and one in one are different facts, and
                  a bare count invites the wrong conclusion.
                */}
                <p className="text-caption mt-1 text-muted-foreground">
                  {t("disputeRecord", {
                    n: String(dispute.upheldNoShows),
                    count: dispute.upheldNoShows,
                    jobs: String(dispute.completedJobs),
                    jobCount: dispute.completedJobs,
                  })}
                </p>

                {/* Their own words, unclassified — see `disputeTripDebt`. */}
                {dispute.note ? (
                  <p className="mt-3 rounded-md border border-border p-3 text-body-sm">
                    {dispute.note}
                  </p>
                ) : null}

                <NextIntlClientProvider
                  locale={locale}
                  messages={{ admin: messages.admin }}
                >
                  <DisputeDecision customerId={dispute.customerId} />
                </NextIntlClientProvider>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The photograph, behind a signed URL, with the read on the log.
 *
 * ITS OWN COMPONENT SO THE SIGNING AND THE LOGGING CANNOT COME APART.
 * `signArrivalPhotoForAdmin` writes the audit row and returns the URL in one call —
 * the `recordDocumentAccess` arrangement — so there is no path that renders an image
 * without a row saying who looked. A second call site that signed and forgot to log
 * is exactly what a separate helper invites.
 *
 * A MISSING PHOTOGRAPH IS NOT AN ERROR. The claim still has to be decidable, so a
 * failed sign renders the sentence and nothing else.
 */
async function ClaimPhoto({
  bookingId,
  path,
  adminId,
  skewMinutes,
}: {
  bookingId: string;
  path: string;
  adminId: string;
  skewMinutes: number | null;
}) {
  const t = await getTranslations("admin.claims");
  const { signArrivalPhotoForAdmin } = await import("@/lib/data/arrival-photos");
  const url = await signArrivalPhotoForAdmin({ path, adminId, bookingId });

  return (
    <div className="mt-3">
      {url === null ? (
        <p className="text-caption text-muted-foreground">{t("photoMissing")}</p>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed
           URL on a private bucket; next/image would proxy and cache it, which is the
           opposite of what a ten-minute link is for. */
        <img
          src={url}
          alt={t("photoAlt")}
          className="max-h-64 w-auto rounded-md border border-border"
        />
      )}
      <p className="text-caption mt-1 text-muted-foreground">
        {skewMinutes === null
          ? t("skewUnknown")
          : Math.abs(skewMinutes) <= 2
            ? t("skewMatches")
            : skewMinutes < 0
              ? t("skewEarlier", { minutes: String(Math.abs(skewMinutes)) })
              : t("skewLater", { minutes: String(skewMinutes) })}
      </p>
    </div>
  );
}
