import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyForm } from "@/components/auth/verify-form";
import { checkNepaliMobile } from "@/lib/auth/phone";
import { safeRedirect } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Enter your code",
  robots: { index: false },
};

export default function VerifyPage({
  searchParams,
}: {
  searchParams: { phone?: string; next?: string };
}) {
  const next = safeRedirect(searchParams.next);
  const check = checkNepaliMobile(searchParams.phone ?? "");

  // Landing here without a valid number means a stale link or a refresh after
  // the query was lost — send them back to enter it rather than showing six
  // boxes that can never succeed.
  if (!check.ok) redirect(`/login?next=${encodeURIComponent(next)}`);

  return (
    <AuthShell
      title="Enter your code"
      lead="We've sent a 6-digit code by SMS. It expires in a few minutes."
    >
      <VerifyForm phone={check.e164} next={next} />
    </AuthShell>
  );
}
