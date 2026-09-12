import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { ReviewDecision } from "@/components/admin/review-decision";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { areaShortLabel } from "@/lib/config/areas";
import { applicationForReview } from "@/lib/data/review";

import { decideAction, openDocumentAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * One application, with the evidence rather than a summary of it.
 *
 * THE ORDER ON THIS PAGE IS THE ARGUMENT. Duplicates first, because a match
 * against somebody we removed changes how everything below should be read.
 * Then the documents, then what is missing, then the references and the
 * assessment. The score is not on the page at all: a reviewer who sees "72"
 * has been given a conclusion, and the reason a person is in this loop is to
 * see what a rule could not.
 *
 * EVERY SIGNED URL MINTED HERE IS LOGGED against this admin, inside
 * `applicationForReview`. That is deliberate and it is not something a
 * reviewer can turn off.
 */
export default async function ApplicationReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.detail");
  const tApply = await getTranslations("join.apply");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: `/login?next=/admin/applications/${params.id}`, locale });
  }
  if (profile!.role !== "admin") notFound();

  const [application, messages] = await Promise.all([
    applicationForReview({ applicationId: params.id, adminId: profile!.id }),
    getMessages(),
  ]);

  if (!application) notFound();

  const removedHits = application.duplicates.filter((hit) => hit.againstRemoved);
  const otherHits = application.duplicates.filter((hit) => !hit.againstRemoved);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/admin/applications"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("back")}
      </Link>

      <h1 className="animate-rise mt-4 font-display text-display-sm">
        {application.fullName ?? t("title")}
      </h1>
      {application.fullNameNe ? (
        <p className="text-body-md text-muted-foreground">
          {application.fullNameNe}
        </p>
      ) : null}

      <dl className="animate-rise mt-4 grid gap-x-6 gap-y-1 text-body-sm sm:grid-cols-2">
        <Pair label={tApply("details.citizenship")} value={application.citizenshipNumber} />
        <Pair label={tApply("details.pan")} value={application.panNumber} />
        <Pair label={tApply("details.dob")} value={application.dateOfBirth} />
        <Pair label={tApply("trades.experience")} value={application.yearsExperience === null ? null : String(application.yearsExperience)} />
        <Pair label={tApply("trades.title")} value={application.trades.join(", ")} />
        <Pair
          label={tApply("areas.title")}
          value={application.serviceAreas
            .map((key) => areaShortLabel(key, locale))
            .join(", ")}
        />
        <Pair label={tApply("payout.title")} value={application.payoutAccount} />
      </dl>

      {/* Duplicates first: a match against somebody we removed changes how
          everything below should be read. */}
      {removedHits.length > 0 || otherHits.length > 0 ? (
        <div className="animate-rise mt-8">
          <h2 className="font-display text-heading-sm">{t("duplicatesTitle")}</h2>
          <ul className="mt-3 space-y-2">
            {[...removedHits, ...otherHits].map((hit, index) => (
              <li
                key={`${hit.applicationId}-${hit.kind}-${index}`}
                className={
                  hit.againstRemoved
                    ? "rounded-md border border-destructive/40 bg-destructive/5 p-3"
                    : "rounded-md border border-border p-3"
                }
              >
                <p className="flex items-center gap-1.5 text-body-sm font-medium">
                  {hit.againstRemoved ? (
                    <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
                  ) : null}
                  {t("duplicateOn", { kind: hit.kind })}
                </p>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {hit.againstRemoved
                    ? t("duplicateRemoved")
                    : t("duplicateOther")}
                </p>
                {/* The prior record, side by side rather than a link away. */}
                <p className="mt-1 text-body-sm">
                  {hit.fullName ?? "—"}
                  {hit.submittedAt
                    ? ` · ${new Date(hit.submittedAt).toISOString().slice(0, 10)}`
                    : ""}
                </p>
                <Link
                  href={`/admin/applications/${hit.applicationId}`}
                  className="mt-1 inline-block text-body-sm text-primary underline underline-offset-2"
                >
                  {t("openDocument")}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {application.missingKinds.length > 0 ? (
        <div className="animate-rise mt-8 rounded-lg border border-warning/40 bg-warning/5 p-4">
          <p className="text-body-sm font-medium">{t("evidenceTitle")}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {tApply("documents.missing", {
              list: application.missingKinds
                .map((kind) => tApply(`documents.${kind}` as "documents.citizenship"))
                .join(", "),
            })}
          </p>
        </div>
      ) : null}

      <div className="animate-rise mt-8">
        <h2 className="font-display text-heading-sm">{t("referencesTitle")}</h2>
        <ul className="mt-3 space-y-1.5 text-body-sm">
          {application.references.map((reference) => (
            <li key={reference.id} className="flex justify-between gap-3">
              <span>
                {reference.name} · {reference.phone}
              </span>
              <span className="text-muted-foreground">
                {reference.outcome === "not_contacted"
                  ? t("referenceNotCalled")
                  : reference.outcome}
              </span>
            </li>
          ))}
          {application.references.length === 0 ? (
            <li className="text-muted-foreground">—</li>
          ) : null}
        </ul>
      </div>

      <div className="animate-rise mt-8">
        <h2 className="font-display text-heading-sm">{t("assessmentTitle")}</h2>
        {application.assessments.length === 0 ? (
          <p className="mt-2 text-body-sm text-muted-foreground">
            {t("noAssessment")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-body-sm">
            {application.assessments.map((assessment) => (
              <li key={assessment.id} className="rounded-md border border-border p-3">
                <p className="font-medium">
                  {assessment.categorySlug} · {assessment.result}
                </p>
                <p className="mt-1 text-muted-foreground">{assessment.notes}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Said plainly, so an empty column is never read as a check that passed. */}
      {!application.identityAutomated ? (
        <div className="animate-rise mt-8 rounded-lg border border-border p-4">
          <h2 className="font-display text-heading-sm">{t("identityTitle")}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {t("identityManual")}
          </p>
        </div>
      ) : null}

      {["submitted", "in_review"].includes(application.status) ? (
        <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
          <ReviewDecision
            applicationId={application.id}
            documents={application.documents.map((document) => ({
              id: document.id,
              kind: document.kind,
              label: tApply(
                `documents.${document.kind}` as "documents.citizenship",
              ),
              hasFile: document.hasFile,
            }))}
            duplicateCount={application.duplicates.length}
            decideAction={decideAction}
            openDocumentAction={openDocumentAction}
          />
        </NextIntlClientProvider>
      ) : (
        <div className="animate-rise mt-8 rounded-lg border border-border p-4">
          {application.decisions.map((decision) => (
            <div key={decision.decidedAt}>
              <p className="text-body-sm font-medium">{decision.decision}</p>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {decision.reason}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Pair({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mb-1 sm:mb-0">{value || "—"}</dd>
    </>
  );
}
