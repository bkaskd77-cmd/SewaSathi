"use server";

import { getLocale } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { submitProviderLead, type LeadResult } from "@/lib/data/provider-leads";

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
