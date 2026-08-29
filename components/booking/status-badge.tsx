import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@/lib/booking/status";

/**
 * A booking's status, in a colour that means something.
 *
 * `no_provider_found` is deliberately not destructive-red. Nobody did anything
 * wrong and nothing is broken — we simply have not found someone yet, and
 * colouring it like an error tells the customer their booking failed when what
 * it needs is a phone call.
 */
const VARIANTS: Record<
  BookingStatus,
  "default" | "verified" | "urgent" | "info" | "muted" | "gold-subtle"
> = {
  pending: "info",
  accepted: "verified",
  en_route: "gold-subtle",
  in_progress: "gold-subtle",
  completed: "verified",
  cancelled: "muted",
  no_provider_found: "urgent",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations("booking.status");
  return <Badge variant={VARIANTS[status]}>{t(status)}</Badge>;
}
