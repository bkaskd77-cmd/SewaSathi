import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleAlert } from "lucide-react";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { enforcementBoard } from "@/lib/data/enforcement";
import {
  CustomerSuspension,
  EnforcementPanel,
} from "@/components/admin/enforcement-panel";
import { ReauthNotice } from "@/components/admin/reauth-notice";

import {
  liftEnforcementAction,
  reinstateCustomerAction,
  setEnforcementAction,
} from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * The published enforcement ladder, with something behind it.
 *
 * WHY THIS SCREEN IS THE POINT. `/providers/standards` publishes five steps in
 * both languages, linked from `/providers/join` before anybody signs up — and
 * until this phase the only response to a dangerous professional was
 * hand-written SQL, unaudited, in a schema where `profiles_record_role_change`
 * exists precisely to stop that. The ladder was a promise with no mechanism.
 *
 * A FAILED READ SAYS SO RATHER THAN RENDERING AN EMPTY LADDER. "Nobody is under
 * a step" and "we could not ask" are opposite facts, and on this screen the
 * second one rendered as the first would tell somebody the ladder is clear when
 * it is simply unreadable.
 *
 * SUSPENDING A CUSTOMER STARTS AT `/admin/lookup`, deliberately. That screen
 * already resolves a person from a phone number and already writes a
 * `customerRisk.viewed` audit row for the search. A second search box here would
 * be a second way to find somebody, and only one of them would be logged.
 */
export default async function EnforcementPage(props: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await props.params;
  const t = await getTranslations("admin.enforcement");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut")
      redirect({ href: "/login?next=/admin/enforcement", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/enforcement", locale });
  }

  await getLocale();
  const board = await enforcementBoard();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">{t("lead")}</p>

      <ReauthNotice />

      <section className="mt-8">
        <h2 className="text-lg font-medium text-foreground">
          {t("providersHeading")}
        </h2>

        {board.providers === null ? (
          <p className="animate-rise mt-3 flex items-center gap-2 text-sm text-warning-ink">
            <CircleAlert className="size-4" aria-hidden />
            {t("unreadable")}
          </p>
        ) : board.providers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("noProviders")}</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {board.providers.map((provider) => (
              <EnforcementPanel
                key={provider.id}
                providerId={provider.id}
                displayName={provider.displayName}
                step={provider.step}
                reason={provider.reason}
                setAction={setEnforcementAction}
                liftAction={liftEnforcementAction}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium text-foreground">
          {t("customersHeading")}
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          {t("customersLead")}
        </p>

        {board.customers === null ? (
          <p className="animate-rise mt-3 flex items-center gap-2 text-sm text-warning-ink">
            <CircleAlert className="size-4" aria-hidden />
            {t("unreadable")}
          </p>
        ) : board.customers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("noCustomers")}</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {board.customers.map((customer) => (
              <CustomerSuspension
                key={customer.profileId}
                profileId={customer.profileId}
                fullName={customer.fullName}
                reason={customer.reason}
                suspendAction={null}
                reinstateAction={reinstateCustomerAction}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
