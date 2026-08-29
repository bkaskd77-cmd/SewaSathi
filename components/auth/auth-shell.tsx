import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/marketing/wordmark";
import { Link } from "@/i18n/navigation";

/**
 * Frame shared by every auth screen. Narrow, centred, no site nav — nothing
 * on these pages should compete with the one thing being asked for.
 */
export function AuthShell({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("auth");

  return (
    <main className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-gold/[0.16] to-transparent"
      />

      <div className="container relative flex flex-1 flex-col">
        <div className="py-6">
          <Wordmark />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center pb-16">
          <h1 className="text-balance font-display text-display-md">{title}</h1>
          {lead ? (
            <p className="mt-2 text-pretty text-body-md text-muted-foreground">
              {lead}
            </p>
          ) : null}

          <div className="mt-7">{children}</div>

          {footer ? <div className="mt-6">{footer}</div> : null}
        </div>

        {/*
          One message with the links inside it, not three fragments. Nepali
          puts the verb last, so "By continuing you agree to our … and …" has
          no prefix/link/suffix shape to reuse — the sentence has to be able to
          reorder around its own links.
        */}
        <p className="pb-6 text-center text-caption text-muted-foreground">
          {t.rich("terms", {
            terms: (chunks) => (
              <Link
                href="/legal/terms"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link
                href="/legal/privacy"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </main>
  );
}
