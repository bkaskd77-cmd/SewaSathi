import "server-only";

import { z } from "zod";

import type { Locale } from "@/i18n/routing";
import { AREA_KEYS } from "@/lib/config/areas";
import { checkNepaliMobile } from "@/lib/auth/phone";
import { CATEGORY_SEED } from "@/lib/config/services";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * A professional asking to join, before real onboarding exists.
 *
 * Validation happens here rather than in the form, because the form is the one
 * place a submission cannot be trusted from. The category and the ward are
 * checked against the same lists the rest of the product renders from, so a
 * hand-crafted POST cannot invent a trade we do not sell.
 */

const CATEGORY_SLUGS = CATEGORY_SEED.map((c) => c.slug);

/** Field-level errors, keyed to the form. Values are message-catalogue keys. */
export type LeadErrors = Partial<
  Record<"fullName" | "phone" | "category" | "area" | "years" | "form", string>
>;

export type LeadResult = { ok: true } | { ok: false; errors: LeadErrors };

const schema = z.object({
  fullName: z.string().trim().min(2).max(80),
  category: z.string().refine((v) => CATEGORY_SLUGS.includes(v)),
  area: z.string().refine((v) => AREA_KEYS.includes(v)),
  years: z.coerce.number().int().min(0).max(60),
  note: z.string().trim().max(500).optional(),
});

export async function submitProviderLead(
  input: {
    fullName: string;
    phone: string;
    category: string;
    area: string;
    years: string;
    note?: string;
  },
  locale: Locale,
): Promise<LeadResult> {
  const errors: LeadErrors = {};

  // The phone check is the product's existing one, so "that's a landline"
  // reads the same here as it does at sign-in.
  const phone = checkNepaliMobile(input.phone);
  if (!phone.ok) errors.phone = phone.reason;

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "fullName") errors.fullName = "nameTooShort";
      if (field === "category") errors.category = "pickTrade";
      if (field === "area") errors.area = "pickArea";
      if (field === "years") errors.years = "yearsRange";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!parsed.success || !phone.ok) return { ok: false, errors };

  if (!hasSupabaseConfig()) {
    // A fresh clone with no keys should still be able to walk the form. The
    // submission goes nowhere, and says so in the log rather than pretending.
    console.warn("[leads] no Supabase config — application not stored");
    return { ok: true };
  }

  try {
    const { error } = await createClient()
      .from("provider_leads")
      .upsert(
        {
          full_name: parsed.data.fullName,
          phone: phone.e164,
          category_slug: parsed.data.category,
          area_key: parsed.data.area,
          years_experience: parsed.data.years,
          note: parsed.data.note || null,
          locale,
        },
        // Tapping submit twice is not two applications.
        { onConflict: "phone,category_slug" },
      );

    if (error) {
      console.error(`[leads] insert failed — ${describeError(error)}`);
      return { ok: false, errors: { form: "saveFailed" } };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[leads] insert threw — ${describeError(thrown)}`);
    return { ok: false, errors: { form: "saveFailed" } };
  }
}
