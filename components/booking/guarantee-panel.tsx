"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldCheck } from "lucide-react";

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
 * The guarantee, on the screen of the person it was promised to.
 *
 * THE PANEL IS SHOWN WHETHER OR NOT THEY CAN CLAIM, and that is the whole
 * design. A promise that appears only when it is claimable is indistinguishable
 * from one that was never made: somebody whose 30 days ran out last week needs
 * to be told that, in a sentence, on the booking it applied to — not left
 * tapping a button that is not there. So the refusal reasons are copy rather
 * than a hidden state.
 *
 * THE SENTENCE ABOUT WHO PAYS IS AGREED BEFORE ANYBODY IS SENT. Every claim
 * dispatches a visit, and what that visit finds decides whether it is free.
 * Saying so here — at the moment of claiming, not in the terms — is what makes
 * the policy fair rather than a surprise bill, and it is what stops a claim
 * being a free roll of the dice.
 */
export type ClaimState = {
  id: string;
  status: string;
  description: string;
  verdict: string | null;
  verdictNote: string | null;
  payer: "provider" | "customer" | null;
};

export function GuaranteePanel({
  bookingId,
  windowKey,
  allowed,
  reason,
  claims,
}: {
  bookingId: string;
  /** d30 | d90 | h48 — the window for this trade, written once per language. */
  windowKey: string;
  allowed: boolean;
  reason: string | null;
  claims: ClaimState[];
}) {
  const t = useTranslations("booking.guarantee");
  const tWindows = useTranslations("booking.payment.guaranteeWindows");

  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const live = claims.find((claim) =>
    ["open", "dispatched", "attended"].includes(claim.status),
  );

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { openClaimAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await openClaimAction(bookingId, description);
      if (result.ok) {
        setOpen(false);
        setDescription("");
      } else {
        setError(result.error);
      }
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(claimId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const { withdrawClaimAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      await withdrawClaimAction(claimId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="animate-rise mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-body-sm flex items-center gap-2 font-semibold text-foreground">
        <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
        {t("title")}
      </h2>

      <p className="text-caption mt-1 text-muted-foreground">
        {t("window", { window: tWindows(windowKey) })}
      </p>

      {claims.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {claims.map((claim) => (
            <li
              key={claim.id}
              className="animate-rise rounded-lg border border-border/70 bg-background p-3"
            >
              <p className="text-caption font-medium text-foreground">
                {t(`status.${claim.status}`)}
              </p>
              <p className="text-caption mt-1 text-muted-foreground">
                {claim.description}
              </p>
              {claim.verdict ? (
                <p className="text-caption mt-2 text-foreground">
                  {t(`verdict.${claim.verdict}`)}
                  {claim.payer ? ` · ${t(`payer.${claim.payer}`)}` : ""}
                </p>
              ) : null}
              {claim.verdictNote ? (
                <p className="text-caption mt-1 text-muted-foreground">
                  {claim.verdictNote}
                </p>
              ) : null}
              {claim.status === "open" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={() => void withdraw(claim.id)}
                >
                  {t("withdraw")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* A live claim replaces the button. Two at once is refused by the
          database anyway, and offering it would be offering a dead end. */}
      {allowed && !live ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="mt-3">
              {t("trigger")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dialogTitle")}</DialogTitle>
              <DialogDescription>{t("dialogBody")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-1">
              <Label htmlFor="claim-description">{t("whatHappened")}</Label>
              <Input
                id="claim-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("whatHappenedPlaceholder")}
                maxLength={1000}
              />
              {/* The sentence that makes the policy fair. Before the button,
                  never after — a condition revealed afterwards cannot inform
                  the decision it applies to. */}
              <p className="text-caption text-muted-foreground">
                {t("whoPays")}
              </p>
              {error ? (
                <p role="alert" className="text-caption text-destructive-ink">
                  {t(`errors.${error}`)}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={busy}>
                  {t("back")}
                </Button>
              </DialogClose>
              <Button
                onClick={() => void submit()}
                disabled={busy || description.trim().length < 4}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {t("send")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Why not, said plainly. A missing button explains nothing. */}
      {!allowed && !live && reason ? (
        <p className="text-caption mt-3 text-muted-foreground">
          {t(`cannot.${reason}`)}
        </p>
      ) : null}
    </section>
  );
}
