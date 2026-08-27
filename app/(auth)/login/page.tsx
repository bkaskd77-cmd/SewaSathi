import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { PhoneForm } from "@/components/auth/phone-form";
import { safeRedirect } from "@/lib/auth/routes";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to SajiloKaam with your mobile number.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeRedirect(searchParams.next);

  if (hasSupabaseConfig()) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user) redirect(next);
  }

  return (
    <AuthShell
      title="Sign in with your mobile"
      lead="No passwords. We text you a code and you're in."
    >
      <PhoneForm next={next} />
    </AuthShell>
  );
}
