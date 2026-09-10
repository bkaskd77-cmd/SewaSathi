import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { CheckCircle2, Clock } from "lucide-react";

import { ApplyFlow } from "@/components/providers/apply-flow";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { AREAS, areaShortLabel } from "@/lib/config/areas";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import {
  APPLY_STEPS,
  currentApplication,
  leadForProfile,
  listApplicationDocuments,
  listReferences,
} from "@/lib/data/applications";
import { documentsFor, requiredDocumentsFor } from "@/lib/verification";

import {
  addReferenceAction,
  consentAction,
  saveStepAction,
  startAction,
  submitAction,
  uploadDocumentAction,
} from "./actions";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "join.apply.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * The application.
 *
 * SERVER-RENDERED FROM THE DATABASE ON EVERY VISIT, which is what makes it
 * resumable rather than merely long. Nothing lives in the browser between
 * steps: closing the tab, losing signal or picking up a different phone three
 * days later all land on the same step with the same answers, because the step
 * and the answers are rows.
 *
 * NO PHONE STEP. The phone number IS the OTP that got them here — asking a
 * tradesperson to prove the same thing twice on a form this long is exactly
 * the kind of small insult that loses supply.
 */
export default async function ApplyPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("join.apply");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=/providers/apply", locale });
  }

  const application = await currentApplication(profile!.id);

  /* ---- Nothing started yet. ---- */
  if (!application) {
    /*
     * Do they already have a lead waiting? If so the application will open
     * with their name, trade and ward already filled, and somebody who sees
     * filled fields without being told why wonders who filled them.
     */
    const lead = await leadForProfile(profile!.id);

    return (
      <Intro
        seeded={lead ? t("intro.seeded") : null}
        title={t("intro.title")}
        lead={t("intro.lead")}
        needTitle={t("intro.needTitle")}
        needs={[
          t("intro.needCitizenship"),
          t("intro.needClearance"),
          t("intro.needAccount"),
          t("intro.needReferences"),
        ]}
        timing={t("intro.timing")}
        start={t("intro.start")}
      />
    );
  }

  /* ---- Sent, decided, or closed: a status, never an empty form. ---- */
  if (application.status !== "draft") {
    const days = application.submittedAt
      ? Math.floor(
          (Date.now() - new Date(application.submittedAt).getTime()) / 86_400_000,
        )
      : 0;

    return (
      <section className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="animate-rise rounded-lg border border-border p-6">
          <div className="flex items-center gap-2.5">
            {application.status === "approved" ? (
              <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
            ) : (
              <Clock aria-hidden="true" className="size-5 text-muted-foreground" />
            )}
            <h1 className="font-display text-heading-md">
              {application.status === "approved"
                ? t("status.approvedTitle")
                : application.status === "rejected"
                  ? t("status.rejectedTitle")
                  : t("status.submittedTitle")}
            </h1>
          </div>

          <p className="mt-3 text-body-md text-muted-foreground">
            {application.status === "approved"
              ? t("status.approvedBody")
              : application.status === "rejected"
                ? t("status.rejectedBody")
                : t("status.submittedBody")}
          </p>

          {application.status === "submitted" ||
          application.status === "in_review" ? (
            <p className="mt-2 text-caption text-muted-foreground">
              {days > 0
                ? t("status.submittedWaiting", { days: String(days) })
                : t("status.submittedToday")}
            </p>
          ) : null}

          {application.status === "rejected" ? (
            <p className="mt-3 text-body-sm text-muted-foreground">
              {t("status.rejectedRetry")}
            </p>
          ) : null}

          {application.status === "approved" ? (
            <Button className="btn-tactile mt-5" asChild>
              <Link href="/provider/jobs">{t("status.goToJobs")}</Link>
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  /* ---- A draft in progress. ---- */
  const [documents, references, messages] = await Promise.all([
    listApplicationDocuments(application.id),
    listReferences(application.id),
    getMessages(),
  ]);

  const uploaded = new Set(
    documents
      .filter((document) => document.status !== "expired")
      .map((document) => document.kind as string),
  );

  const wanted = documentsFor(application.trades).map((requirement) => ({
    kind: requirement.kind,
    required: requirement.required,
    expires: requirement.expires,
    uploaded: uploaded.has(requirement.kind),
  }));

  // What still stands between them and submitting, named rather than implied
  // by a disabled button.
  const missing: string[] = [];
  for (const kind of requiredDocumentsFor(application.trades)) {
    if (!uploaded.has(kind)) {
      missing.push(t(`documents.${kind}` as "documents.citizenship"));
    }
  }
  if (!application.fullName) missing.push(t("details.fullName"));
  if (application.trades.length === 0) missing.push(t("trades.title"));
  if (application.serviceAreas.length === 0) missing.push(t("areas.title"));
  if (!application.payoutAccount) missing.push(t("payout.title"));
  if (references.length < 2) missing.push(t("references.title"));

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="sr-only">{t("intro.title")}</h1>
      <NextIntlClientProvider locale={locale} messages={{ join: messages.join }}>
        <ApplyFlow
          draft={application}
          totalSteps={APPLY_STEPS}
          categories={SERVICE_CATEGORIES.map((category) => ({
            slug: category.slug,
            name: categoryCopy(category, locale).name,
          }))}
          areas={AREAS.map((area) => ({
            key: area.key,
            // The short form: a checkbox grid of thirty wards is unreadable
            // with the full "Lalitpur · Ward 4 (Jhamsikhel)" on every line.
            label: areaShortLabel(area.key, locale),
          }))}
          documents={wanted}
          references={references.map((reference) => ({
            id: reference.id as string,
            name: reference.name as string,
            relationship: (reference.relationship as string | null) ?? null,
          }))}
          missing={missing}
          consentAction={consentAction}
          saveStepAction={saveStepAction}
          addReferenceAction={addReferenceAction}
          submitAction={submitAction}
          uploadDocumentAction={uploadDocumentAction}
        />
      </NextIntlClientProvider>
    </section>
  );
}

/** The one screen before anything is created: what this costs them, and why. */
function Intro(props: {
  title: string;
  lead: string;
  /** Set when the form already knows them. Null on a cold start. */
  seeded: string | null;
  needTitle: string;
  needs: string[];
  timing: string;
  start: string;
}) {
  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{props.title}</h1>
      <p className="animate-rise mt-3 text-body-lg text-muted-foreground">
        {props.lead}
      </p>

      <div className="animate-rise mt-6 rounded-lg border border-border p-5">
        <p className="text-body-sm font-medium">{props.needTitle}</p>
        <ul className="mt-3 space-y-2">
          {props.needs.map((need, index) => (
            <li
              key={need}
              className="animate-rise flex gap-2 text-body-sm text-muted-foreground"
              style={{ animationDelay: `${Math.min(index * 0.06, 0.25)}s` }}
            >
              <span aria-hidden="true">·</span>
              {need}
            </li>
          ))}
        </ul>
      </div>

      {props.seeded ? (
        <p className="animate-rise mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 text-body-sm">
          {props.seeded}
        </p>
      ) : null}

      {/* Said before they start, not after they finish: an application that
          disappears into silence is how supply is lost. */}
      <p className="animate-rise mt-4 text-body-sm text-muted-foreground">
        {props.timing}
      </p>

      <form action={startAction} className="mt-6">
        <Button type="submit" size="lg" className="btn-tactile">
          {props.start}
        </Button>
      </form>
    </section>
  );
}
