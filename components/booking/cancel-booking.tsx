"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Cancelling, behind a confirmation.
 *
 * A booking is a promise to a person who may already have planned their day
 * around it, so it does not cancel on a single tap. The reason is optional —
 * requiring one just produces "asdf" — but it is asked for, because the honest
 * answers are the only way we learn why people leave.
 */
export function CancelBooking({ bookingId }: { bookingId: string }) {
  const t = useTranslations("booking.detail.cancel");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const { cancelBookingAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await cancelBookingAction(bookingId, reason || null);
      if (result.ok) {
        // No refresh(): the action revalidates this route, so its own response
        // carries the re-rendered page. See the note in provider/job-card.tsx.
        setOpen(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <Label htmlFor="cancel-reason">{t("reasonLabel")}</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
            maxLength={300}
          />
          {error ? (
            <p role="alert" className="text-caption text-destructive-ink">
              {t("failed")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {t("keep")}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
