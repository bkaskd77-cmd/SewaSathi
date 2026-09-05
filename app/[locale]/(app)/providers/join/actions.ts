"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { submitProviderLead, type LeadResult } from "@/lib/data/provider-leads";
import { checkRateLimit } from "@/lib/server/rate-limit";

/**
 * The form posts here.
 *
 * A server action rather than a route handler so the form keeps working with
 * JavaScript still loading — Next wires a plain form POST to it, which is the
 * right default for the audience: a professional filling this in on a cheap
 * phone on mobile data.
 */
export async function joinAction(
  _previous: LeadResult | null,
  formData: FormData,
): Promise<LeadResult> {
  const value = (key: string) => String(formData.get(key) ?? "");
  const locale = (await getLocale()) as Locale;

  /*
   * PUBLIC, UNAUTHENTICATED, AND THEREFORE A SPAM TARGET.
   *
   * This is the only write in the product a stranger may make, which is
   * exactly why it has a ceiling. Keyed by network, because there is nobody to
   * key it by: two a minute is above anybody filling in a form and far below a
   * script. A flooded lead table is a real cost — somebody reads these.
   */
  const forwarded = headers().get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit("join", ip);
  if (!limit.ok) return { ok: false, errors: { form: "tooManyRequests" } };

  return submitProviderLead(
    {
      fullName: value("fullName"),
      phone: value("phone"),
      category: value("category"),
      area: value("area"),
      years: value("years"),
      note: value("note"),
    },
    locale,
  );
}
