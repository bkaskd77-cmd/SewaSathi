"use client";

import { useTranslations } from "next-intl";

/**
 * What this session's token actually says, for us.
 *
 * THE SETTING LIVES IN SOMEBODY ELSE'S DASHBOARD, which is the category of
 * dependency that broke sign-in for a day. Reading the configured JWT expiry
 * needs a Supabase management token — one more credential in one more place —
 * but the token in front of us carries `iat` and `exp`, and the gap between
 * them IS the configured lifetime, observed rather than asked for.
 *
 * Same rule as the triage, data and auth badges: development, or `?debug=auth`
 * on the URL, because this branch deploys straight to production and a strict
 * production check would hide it exactly where somebody needs it. Ordinary
 * visitors never see it.
 *
 * It prints two durations and nothing else. No token, no claims, no id —
 * nothing that would matter in a screenshot.
 */
export function SessionDebug({
  accessTokenSeconds,
  stepUpHours,
}: {
  accessTokenSeconds: number | null;
  stepUpHours: number;
}) {
  const t = useTranslations("auth.mfa.debug");

  const asked =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "auth";
  if (process.env.NODE_ENV !== "development" && !asked) return null;

  return (
    <p className="animate-pop-in mt-4 break-words rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-caption text-muted-foreground">
      {accessTokenSeconds === null
        ? t("tokenUnknown")
        : t("token", { minutes: String(Math.round(accessTokenSeconds / 60)) })}
      {" · "}
      {t("stepUp", { hours: String(stepUpHours) })}
    </p>
  );
}
