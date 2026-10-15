"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

/**
 * Registers the service worker, and offers to install the app.
 *
 * ONE COMPONENT FOR BOTH, AND THAT IS A BUNDLE DECISION RATHER THAN TIDINESS.
 * Each is a few lines of browser API, and each as its own client component
 * would mean two client-module boundaries on the landing page — the page whose
 * ceiling is the one that matters, met by a stranger on a Nepali mobile
 * connection. `scripts/perf-budget.mjs` is what holds that honest.
 *
 * THE WORKER IS REGISTERED AFTER `load`, NEVER DURING RENDER. Registration
 * competes with the page's own requests for a connection that may have one bar,
 * and nothing it does is needed for a first visit — the caches it fills are for
 * the SECOND one. A product that installs its offline support by making the
 * first paint slower has the trade backwards.
 *
 * NOTHING HERE IS LOAD-BEARING. A browser with no `serviceWorker`, a private
 * window, a user who has blocked storage, an install prompt that never fires:
 * every one of those paths ends with the site working exactly as it does today.
 * That is the same posture as `use-booking-channel.ts` — live updates are an
 * enhancement, never the source of truth — and it is why this can sit in the
 * root layout without being a risk to every page.
 */

/** The `beforeinstallprompt` event, which TypeScript's DOM lib does not have. */
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Remembering a "not now".
 *
 * PER BROWSER AND DELIBERATELY NOT PER ACCOUNT. Installing is a property of the
 * device somebody is holding, not of who they are signed in as — a professional
 * who installs on their own phone and signs in on a shared tablet should be
 * asked on the tablet. And storing it server-side would mean a write on a
 * dismissal, which is a row about somebody saying no to a banner.
 */
const DISMISSED_KEY = "sk:install-dismissed";

export function AppShell() {
  const t = useTranslations("install");
  const [install, setInstall] = React.useState<InstallEvent | null>(null);

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      /*
       * Failure is swallowed on purpose. An unsupported browser, an insecure
       * origin, a policy that forbids workers — none of them is something the
       * person reading this page can act on, and none of them stops the
       * product working.
       */
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  React.useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Blocked storage reads as "not dismissed", which errs toward offering.
    }
    if (dismissed) return;

    const onPrompt = (event: Event) => {
      // Chrome shows its own mini-infobar unless this is called; the offer
      // below replaces it so it can be made in the reader's own language.
      event.preventDefault();
      setInstall(event as InstallEvent);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = React.useCallback(() => {
    setInstall(null);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* Nothing useful to do; they simply get asked again. */
    }
  }, []);

  const accept = React.useCallback(async () => {
    if (!install) return;
    setInstall(null);
    try {
      await install.prompt();
      /*
       * The outcome is deliberately not recorded. A dismissal at the browser's
       * own dialogue is the same answer as the one above, and the event only
       * fires again when the browser decides to — so storing it would let a
       * stale "no" outlive the moment it was given.
       */
      await install.userChoice;
    } catch {
      /* The browser refused to show it. Nothing to say about that. */
    }
  }, [install]);

  if (!install) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-50 animate-rise sm:left-auto sm:right-4 sm:w-80"
      role="dialog"
      aria-label={t("title")}
    >
      <div className="rounded-lg border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10"
          >
            <Download className="size-4 text-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold">{t("title")}</p>
            <p className="mt-1 text-pretty text-caption text-muted-foreground">
              {t("body")}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={t("dismiss")}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={accept}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-primary px-3 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.99]"
          >
            {t("action")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-10 items-center justify-center rounded-md px-3 text-caption font-semibold text-muted-foreground transition-colors hover:bg-muted"
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
