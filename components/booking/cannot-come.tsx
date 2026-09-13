"use client";

import { useTranslations } from "next-intl";
import { Clock, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ServingVerdict } from "@/lib/provider";
import { cn } from "@/lib/utils";

/**
 * What the product knows about whether this person can come, said before the
 * customer commits rather than after.
 *
 * IT HAD BEEN SAYING NOTHING. The state was computed, shown on the catalogue
 * card, and then read by no other screen — so a customer could see "On a job",
 * tap Book, walk four screens and confirm without the product ever repeating
 * what it already knew.
 *
 * TWO SHAPES, AND THE URGENCY THE CUSTOMER CHOSE DECIDES WHICH.
 *
 *   * **Emergency** is a stop. Somebody who picked emergency has told us they
 *     need help now, so we do not offer to hold the job for five minutes for
 *     a person demonstrably in another house. The panel hands them the people
 *     who can come instead — never a bare error.
 *   * **Everything else** is a note. The booking is good: the professional is
 *     told, and if they have not answered inside the first-refusal window the
 *     customer can hand it to somebody else. That second half already exists
 *     on the booking page, so this states a promise the product keeps.
 *
 * NOT A WARNING COLOUR on the second shape. "They are working" is ordinary,
 * and dressing it in red would teach somebody that a busy professional is a
 * bad one.
 */
export function CannotCome({
  verdict,
  providerName,
  blocking,
  holdMinutes,
  freeFromLabel,
  onChooseAnother,
}: {
  verdict: ServingVerdict;
  providerName: string;
  /** True when the urgency makes this a stop rather than a note. */
  blocking: boolean;
  /** How long we hold the job for them before opening it to everybody. */
  holdMinutes: number;
  /** When they are free again, already formatted. Null for a job in progress. */
  freeFromLabel: string | null;
  onChooseAnother: () => void;
}) {
  const t = useTranslations("booking.flow.cannotCome");
  if (verdict.ok) return null;

  return (
    <section
      className={cn(
        "animate-rise rounded-xl border p-4 sm:p-5",
        blocking ? "border-gold/50 bg-gold/5" : "border-border bg-muted/30",
      )}
      aria-labelledby="cannot-come"
    >
      <h3
        id="cannot-come"
        className="flex items-center gap-2 text-body-sm font-semibold text-foreground"
      >
        {blocking ? (
          <Info aria-hidden="true" className="size-4 text-gold-ink" />
        ) : (
          <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
        {t(`reason.${verdict.reason}`, { name: providerName })}
      </h3>

      <p className="text-caption mt-2 text-muted-foreground">
        {blocking
          ? t("emergencyBody")
          : /*
             * The real number from DISPATCH_WINDOWS, not a vague reassurance.
             * The booking page makes the same promise at the other end, and
             * the two have to be the same sentence.
             */
            t("waitBody", { minutes: String(holdMinutes) })}
      </p>

      {freeFromLabel ? (
        <p className="text-caption mt-1 text-muted-foreground">
          {t("freeFrom", { when: freeFromLabel })}
        </p>
      ) : null}

      {blocking ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onChooseAnother}
        >
          {t("chooseAnother")}
        </Button>
      ) : null}
    </section>
  );
}
