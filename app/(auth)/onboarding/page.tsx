import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { safeRedirect } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Tell us your name",
  robots: { index: false },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeRedirect(searchParams.next);
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route; this is the belt to its braces.
  if (!user) redirect(`/login?next=${encodeURIComponent("/onboarding")}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Already onboarded — nobody should be asked their name twice.
  if (profile?.full_name) redirect(next);

  return (
    <AuthShell
      title="Almost there"
      lead="Two quick things, so your professional knows who they're visiting."
    >
      <OnboardingForm next={next} />
    </AuthShell>
  );
}
