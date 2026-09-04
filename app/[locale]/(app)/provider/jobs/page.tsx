import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { ClipboardList } from "lucide-react";

import { JobCard } from "@/components/provider/job-card";
import { EmptyState } from "@/components/shared/empty-state";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { checkNepaliMobile } from "@/lib/auth";
import { getSessionProfile } from "@/lib/auth/session";
import { formatSlotInstant } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategory } from "@/lib/data/categories";
import {
  getMyProvider,
  listOpenJobs,
  listProviderJobs,
} from "@/lib/data/provider-jobs";
import { PRICE_RULES } from "@/lib/payments/client";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "provider.jobs",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * The professional's jobs.
 *
 * Minimal on purpose. Phase 10 is the real dashboard with earnings, a
 * calendar and onboarding; this is the smallest surface on which a booking can
 * actually travel from pending to paid with a person on each end. Until that
 * existed, every customer-facing screen built in Phases 6-8 could only be
 * looked at, never used.
 *
 * Nothing here decides anything. Each action calls the same server function
 * the API route does, which re-reads the booking, checks this professional is
 * the one assigned, and judges the move against the status machine.
 */
export default async function ProviderJobsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("provider.jobs");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Fprovider%2Fjobs", locale });
  }

  const messages = await getMessages();
  const me = await getMyProvider(profile!.id);

  // Not linked to a listing yet. Provider onboarding is Phase 10, so rather
  // than a dead end this prints the one statement that links an account —
  // with this account's own id already in it, so it is a copy and a paste
  // rather than a puzzle. It is shown to the account holder only, and it
  // grants nothing on its own: it has to be run by somebody who already holds
  // the database.
  if (!me) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="animate-rise font-display text-display-md">
          {t("title")}
        </h1>
        <div className="animate-rise mt-6 rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-body-md">{t("unlinked.body")}</p>
          <p className="mt-3 text-caption text-muted-foreground">
            {t("unlinked.hint")}
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-background p-3 text-caption">
            <code>{claimSql(profile!.id, profile!.phone)}</code>
          </pre>
        </div>
      </div>
    );
  }

  // Two lists, and the separation matters. "Mine" is work somebody has already
  // been given; "open" is work first refusal has lapsed on and anybody
  // eligible can take. An open job carries no customer name, phone or
  // doorstep — nobody has agreed to anything yet.
  const [jobs, openJobs] = await Promise.all([
    listProviderJobs(profile!.id),
    listOpenJobs(profile!.id),
  ]);

  // Category names are data, not interface copy, so they are resolved here
  // rather than in the card — and a function cannot cross to a Client
  // Component anyway.
  const named = await Promise.all(
    jobs.map(async (job) => {
      const category = await getCategory(job.categorySlug);
      return {
        job,
        categoryName: category
          ? categoryCopy(category, locale).name
          : job.categorySlug,
      };
    }),
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        {/* "Signed in as Anita Rai" alongside a header saying Bikas reads as
            somebody else's session. It never was — `getMyProvider` resolves the
            listing from `auth.uid()` and the db suite proves the policy — but a
            label that has to be explained is a bad label. It is the listing,
            so it says so. */}
        <p className="mt-1 text-body-md text-muted-foreground">
          {t("subtitle", { name: me.displayName })}
        </p>
      </header>

      {openJobs.length > 0 ? (
        <NextIntlClientProvider
          locale={locale}
          messages={{ provider: messages.provider }}
        >
          <section className="mt-6">
            <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
              {t("openHeading")}
            </h2>
            <p className="mt-1 text-body-sm text-muted-foreground">
              {t("openBody")}
            </p>
            <div className="assemble mt-3 space-y-4">
              {openJobs.map((job, i) => (
                <div key={job.id} style={{ ["--i" as string]: i }}>
                  <JobCard
                    open
                    id={job.id}
                    reference={job.reference}
                    status={job.status}
                    categoryName={job.categorySlug}
                    description={job.description}
                    whenLabel={
                      job.scheduledFor
                        ? formatSlotInstant(job.scheduledFor)
                        : t("asap")
                    }
                    quoteLabel={`${formatNpr(job.quotedMin, { locale })}–${formatNpr(job.quotedMax, { locale })}`}
                    finalLabel={null}
                    customerName={null}
                    customerPhone={null}
                    addressLine={job.addressLine}
                    landmark={null}
                    quotedMax={job.quotedMax}
                    ceiling={job.quotedMax * PRICE_RULES.hardCeilingMultiple}
                    paymentStatus="pending"
                    paymentMethodLabel={t(`payment.methods.${job.paymentMethod}`)}
                    earningLabel={null}
                  />
                </div>
              ))}
            </div>
          </section>
        </NextIntlClientProvider>
      ) : null}

      {named.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("empty.title")}
          description={t("empty.body")}
        />
      ) : (
        <NextIntlClientProvider
          locale={locale}
          messages={{ provider: messages.provider }}
        >
          <div className="assemble mt-6 space-y-4">
            {named.map(({ job, categoryName }, i) => (
              <div key={job.id} style={{ ["--i" as string]: i }}>
                <JobCard
                  id={job.id}
                  reference={job.reference}
                  status={job.status}
                  categoryName={categoryName}
                  description={job.description}
                  whenLabel={
                    job.scheduledFor
                      ? formatSlotInstant(job.scheduledFor)
                      : t("asap")
                  }
                  quoteLabel={`${formatNpr(job.quotedMin, { locale })}–${formatNpr(job.quotedMax, { locale })}`}
                  finalLabel={
                    job.finalAmount !== null
                      ? formatNpr(job.finalAmount, { locale })
                      : null
                  }
                  customerName={job.customerName}
                  customerPhone={job.customerPhone}
                  addressLine={job.addressLine}
                  landmark={job.landmark}
                  quotedMax={job.quotedMax}
                  ceiling={job.quotedMax * PRICE_RULES.hardCeilingMultiple}
                  paymentStatus={job.paymentStatus}
                  paymentMethodLabel={t(`payment.methods.${job.paymentMethod}`)}
                  earningLabel={
                    job.providerEarning !== null
                      ? formatNpr(job.providerEarning, { locale })
                      : null
                  }
                />
              </div>
            ))}
          </div>
        </NextIntlClientProvider>
      )}
    </div>
  );
}

/**
 * The two statements that link this account to a listing.
 *
 * Generated rather than written out, because the first version was wrong in
 * two ways that only showed up when somebody ran it. It asked for a
 * `display_name` the person had no way to know, and it interpolated
 * `profiles.phone` verbatim — which Supabase stores without a leading `+`,
 * while `provider_contacts.phone` has a check constraint demanding E.164. The
 * insert failed on a constraint the page itself had just violated.
 *
 * So: the listing is chosen by the query rather than named, and the phone goes
 * through the same normalisation the rest of the product uses. Copy-and-paste
 * has to actually work — a snippet that needs debugging is worse than no
 * snippet, because it looks authoritative.
 */
function claimSql(profileId: string, phone: string | null): string {
  const normalised = phone ? checkNepaliMobile(phone) : null;
  const e164 = normalised?.ok ? normalised.e164 : null;

  const claim = `-- 1. Claim the first unclaimed listing for this account.
update public.providers
set profile_id = '${profileId}'
where id = (
  select id from public.providers
  where profile_id is null
  order by display_name
  limit 1
);`;

  const contact = e164
    ? `-- 2. Publish a number the customer can call once a job is accepted.
insert into public.provider_contacts (provider_id, phone)
select id, '${e164}'
from public.providers
where profile_id = '${profileId}'
on conflict (provider_id) do update set phone = excluded.phone;`
    : `-- 2. No usable number on this account. Put one in E.164 (+977…) here:
-- insert into public.provider_contacts (provider_id, phone)
-- select id, '+9779800000000'
-- from public.providers
-- where profile_id = '${profileId}'
-- on conflict (provider_id) do update set phone = excluded.phone;`;

  return `${claim}\n\n${contact}`;
}
