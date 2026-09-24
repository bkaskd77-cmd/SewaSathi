"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

/**
 * Reasons this screen has a sentence for.
 *
 * An allow-list rather than an interpolated key — `check:keys` would catch a
 * missing one now, but a reason with no copy would still have printed its own
 * dotted path onto the screen somebody reaches when they are locked out, which
 * is the worst possible moment for it.
 */
const KNOWN = [
  "badCode",
  "enrollFailed",
  "noFactor",
  "signedOut",
  "wrongCode",
] as const;

const errorKey = (reason: string | undefined) =>
  (KNOWN as readonly string[]).includes(reason ?? "") ? reason! : "wrongCode";

type Enrolment = { factorId: string; qr: string; secret: string };

/**
 * Setting up a second factor, and using it.
 *
 * ONE COMPONENT FOR BOTH STATES, because they are the same screen to the
 * person in front of it: "prove it is you". Which half shows is decided by
 * whether the account already has a verified factor, and splitting them into
 * two routes would mean two places that can disagree about where to send
 * somebody next.
 *
 * THE SECRET IS PRINTED BESIDE THE QR CODE. A reviewer on a desktop scans the
 * code with their phone; one already working on the phone cannot scan their
 * own screen, and a QR-only enrolment would lock that person out of the
 * feature. The same reason the login screen never dead-ends.
 *
 * WHY A CODE AT ALL, ON THIS PRODUCT. Said on the screen rather than in a
 * policy: an admin account reaches every customer's phone number and every
 * identity document, and an SMS code alone is the factor most easily taken
 * from somebody.
 */
export function MfaSetup({
  hasFactor,
  needsCode,
  returnTo = null,
}: {
  hasFactor: boolean;
  /** An enrolled admin whose session has not used the factor, or used it too long ago. */
  needsCode: boolean;
  /**
   * Where they were going when the gate sent them here, or null.
   *
   * Decided on the server by `afterSecurity` and already through
   * `safeRedirect`, so this component neither validates a path nor decides
   * whether the gate is satisfied — both would be second opinions on rules
   * that live in `lib/auth`, and second opinions are how two halves of a guard
   * come to disagree.
   */
  returnTo?: string | null;
}) {
  const t = useTranslations("auth.mfa");
  const router = useRouter();
  const [enrolment, setEnrolment] = React.useState<Enrolment | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const begin = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const { startEnrollmentAction } = await import(
          "@/app/[locale]/(app)/account/security/actions"
        );
        const result = await startEnrollmentAction();
        if (result.ok) setEnrolment(result);
        else setError(errorKey(result.reason));
      } catch {
        setError("enrollFailed");
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirm = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const { confirmCodeAction } = await import(
          "@/app/[locale]/(app)/account/security/actions"
        );
        const form = new FormData();
        if (enrolment) form.set("factorId", enrolment.factorId);
        form.set("code", code);
        const result = await confirmCodeAction(form);
        if (result.ok) {
          // The action revalidates, so the server re-renders this page in the
          // same round trip and the state below changes underneath us.
          setEnrolment(null);
          setCode("");
          /*
           * And if something sent them here, take them back to it. Without
           * this the gate asked for a code, got one, and left them on a
           * settings page with no mention of where they had been going.
           *
           * `router` comes from `@/i18n/navigation`, never `next/navigation`:
           * the plain one drops a Nepali reader into the English route and
           * nothing fails loudly when it does.
           */
          if (returnTo) router.replace(returnTo);
          return;
        }
        setError(errorKey(result.reason));
      } catch {
        setError("wrongCode");
      } finally {
        setBusy(false);
      }
    })();
  };

  /* ---------------------------------------------------------------- *
   * Enrolled, and this session needs to prove it
   * ---------------------------------------------------------------- */
  if (hasFactor && needsCode) {
    return (
      <section className="animate-rise mt-6 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:p-5">
        <h2 className="text-body-sm flex items-center gap-2 font-semibold">
          <ShieldAlert aria-hidden="true" className="size-4 text-warning-ink" />
          {t("challengeTitle")}
        </h2>
        <p className="text-caption mt-1 text-muted-foreground">
          {t("challengeBody")}
        </p>
        <CodeField
          value={code}
          onChange={setCode}
          onSubmit={confirm}
          busy={busy}
          label={t("codeLabel")}
          action={t("confirm")}
        />
        {error ? <Problem>{t(`errors.${error}`)}</Problem> : null}
      </section>
    );
  }

  /* ---------------------------------------------------------------- *
   * Already set up and already used
   * ---------------------------------------------------------------- */
  if (hasFactor) {
    return (
      <section className="animate-rise mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-body-sm flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
          {t("onTitle")}
        </h2>
        <p className="text-caption mt-1 text-muted-foreground">{t("onBody")}</p>
      </section>
    );
  }

  /* ---------------------------------------------------------------- *
   * Not set up yet
   * ---------------------------------------------------------------- */
  return (
    <section className="animate-rise mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-body-sm flex items-center gap-2 font-semibold">
        <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
        {t("offTitle")}
      </h2>
      <p className="text-caption mt-1 text-muted-foreground">{t("offBody")}</p>

      {!enrolment ? (
        <Button size="sm" className="btn-tactile mt-3" disabled={busy} onClick={begin}>
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {t("start")}
        </Button>
      ) : (
        <div className="animate-pop-in mt-4">
          <p className="text-caption text-muted-foreground">{t("scan")}</p>
          {/* Supabase returns the QR as an SVG data URI. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrolment.qr}
            alt={t("qrAlt")}
            width={200}
            height={200}
            className="mt-2 rounded-lg border border-border bg-white p-2"
          />
          {/* The secret in text, for somebody enrolling ON the phone that
              holds the authenticator and so cannot scan their own screen. */}
          <p className="text-caption mt-3 text-muted-foreground">{t("orType")}</p>
          <code className="mt-1 block break-all rounded-md border border-border bg-background p-2 font-mono text-body-sm">
            {enrolment.secret}
          </code>

          <CodeField
            value={code}
            onChange={setCode}
            onSubmit={confirm}
            busy={busy}
            label={t("codeLabel")}
            action={t("finish")}
          />
        </div>
      )}

      {error ? <Problem>{t(`errors.${error}`)}</Problem> : null}
    </section>
  );
}

function CodeField({
  value,
  onChange,
  onSubmit,
  busy,
  label,
  action,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  label: string;
  action: string;
}) {
  return (
    <div className="mt-3 space-y-1.5">
      <Label htmlFor="totp-code">{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="totp-code"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // A six-digit code on a phone should open the number pad, and
          // `one-time-code` lets the keyboard offer it from the authenticator.
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="max-w-32 font-mono tracking-widest"
        />
        <Button
          size="sm"
          className="btn-tactile"
          disabled={busy || value.replace(/\D/g, "").length !== 6}
          onClick={onSubmit}
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {action}
        </Button>
      </div>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="animate-pop-in mt-2 text-body-sm text-destructive-ink">
      {children}
    </p>
  );
}
