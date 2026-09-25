import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { readSecurityLog, recordLogAccess } from "@/lib/data/security-log";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Who looked at what, and who decided what.
 *
 * NOTHING HAS EVER READ THIS TABLE. Events have been written since Phase 10 and
 * the only way to see one was the Supabase dashboard — itself an untraceable
 * read. A log nobody can open proves nothing.
 *
 * OPENING IT IS LOGGED, which is the part that makes the rest mean anything.
 * The person best placed to misuse this data is an admin, and an audit log that
 * recorded everything except its own readers would be missing the entry that
 * mattered. One event per open, never recursive.
 *
 * THE FILTER IS EVIDENCE AND IT IS IDS ONLY. "An admin opened the log" is
 * nearly worthless; "an admin pulled this customer's whole trail" is the thing
 * worth being able to answer later. But the stored filter is the ids it already
 * was — a name or a searched string in there would make this table a second,
 * searchable copy of the very thing it exists to protect.
 *
 * `detail` IS NOT RENDERED. It carries counts and reasons, and the rule at the
 * top of `lib/audit` keeps tokens and documents out of it — but it is written
 * by twenty-odd call sites and one plpgsql function, and a screen that printed
 * whatever happened to be in a jsonb blob is a screen that leaks the first time
 * somebody puts something careless in one. What is shown is the shape: who,
 * what kind, to which record, when.
 *
 * PAGING, UNLIKE EVERY QUEUE IN THIS PRODUCT. A queue empties and a second page
 * invites working the wrong end of it. Nothing ever leaves a log, and what
 * somebody wants is rarely on the first page.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.audit");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") redirect({ href: "/login?next=/admin/audit", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/audit", locale });
  }

  const one = (value: string | string[] | undefined) =>
    ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, 120) || null;

  const filter = {
    actorId: one(searchParams.actor),
    subjectId: one(searchParams.subject),
    before: one(searchParams.before),
  };

  /*
   * Logged before the read, not after. If the read fails the person still
   * asked, and a log that only recorded successful looks would be a log
   * somebody could probe by making it fail.
   */
  await recordLogAccess({ adminId: gate.profile.id, filter });
  const page = await readSecurityLog(filter);

  const filtered = Boolean(filter.actorId || filter.subjectId);
  const nextHref = page.next
    ? `/admin/audit?${new URLSearchParams({
        ...(filter.actorId ? { actor: filter.actorId } : {}),
        ...(filter.subjectId ? { subject: filter.subjectId } : {}),
        before: page.next,
      }).toString()}`
    : null;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {filtered ? (
        <p className="animate-rise mt-4 text-body-sm">
          <span className="text-muted-foreground">{t("filtered")}</span>{" "}
          <Link href="/admin/audit" className="underline underline-offset-4">
            {t("clear")}
          </Link>
        </p>
      ) : null}

      {!page.ok ? (
        <p
          role="alert"
          className="animate-rise mt-8 inline-flex items-center gap-2 text-body-sm text-warning-ink"
        >
          <CircleAlert aria-hidden="true" className="size-4" />
          {t("unreadable")}
        </p>
      ) : page.entries.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {filtered ? t("noneMatching") : t("empty")}
        </p>
      ) : (
        <>
          <ol className="mt-8 space-y-2">
            {page.entries.map((entry, index) => (
              <li
                key={entry.id}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.02, 0.25)}s` }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-mono text-body-sm text-foreground">
                    {entry.kind}
                  </span>
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {formatInstant(entry.at, locale)}
                  </span>
                </div>

                <p className="mt-1 text-body-sm text-muted-foreground">
                  {t("by", { role: t(`roles.${entry.actorRole}`) })}
                  {entry.actorId ? (
                    <>
                      {" · "}
                      <Link
                        href={`/admin/audit?actor=${entry.actorId}`}
                        className="underline underline-offset-4"
                      >
                        {t("theirTrail")}
                      </Link>
                    </>
                  ) : null}
                  {entry.subjectId ? (
                    <>
                      {" · "}
                      <Link
                        href={`/admin/audit?subject=${entry.subjectId}`}
                        className="underline underline-offset-4"
                      >
                        {t("thisRecord")}
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>

          {nextHref ? (
            <div className="mt-6">
              <Link
                href={nextHref}
                className={buttonVariants({ variant: "outline", className: "btn-tactile" })}
              >
                {t("older")}
              </Link>
            </div>
          ) : (
            <p className="mt-6 text-caption text-muted-foreground">{t("end")}</p>
          )}
        </>
      )}
    </section>
  );
}
