"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { ReauthNotice, isReauthReason } from "@/components/admin/reauth-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = { ok: boolean; reason?: string };
type Action = (data: FormData) => Promise<Result>;

export type AreaCard = {
  key: string;
  city: string;
  cityNe: string;
  wardNumber: number;
  name: string;
  nameNe: string;
  retiredAt: string | null;
  retiredReason: string | null;
  /** True when `seed/area-centroids.json` has no point for this key. */
  centroidMissing: boolean;
};

function Submit({
  label,
  busy,
  variant,
}: {
  label: string;
  busy: string;
  variant?: "outline" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {busy}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

function Outcome({ result }: { result: Result | null }) {
  const t = useTranslations("admin.areas");
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
        <Check className="size-4" aria-hidden />
        {t("done")}
      </p>
    );
  }
  /* A code, not a bug — one sentence with the link, for every money screen. */
  if (isReauthReason(result.reason)) return <ReauthNotice />;
  return (
    <p role="alert" className="animate-rise text-body-sm text-destructive-ink">
      {t(`errors.${result.reason}` as "errors.refused")}
    </p>
  );
}

/**
 * One ward: what it is, whether we serve it, and the one action available.
 *
 * THE ACTION IS SINGULAR ON PURPOSE. A live ward offers only Retire and a
 * retired one only Reopen — never both — because a card with two opposite
 * buttons invites the wrong one, and there is no third thing to do with an
 * area. That is `attentionFor`'s rule from `/bookings`: one card, one call to
 * action.
 *
 * RETIRING ASKS FOR A REASON IN A FIELD, NOT A CONFIRMATION DIALOG. An "are you
 * sure" teaches somebody to tap through; typing why is the pause and the record
 * at once — and the record does work later, because "why did we stop serving
 * ward 26" is what somebody asks six months on. `areas_retired_shape` refuses a
 * blank one, so the form and the database agree.
 *
 * REOPENING ASKS FOR NOTHING. It is the undo, the audit row names who did it,
 * and a reason field there would be friction on the recovery path from a
 * mistake — which is the one path that should be easy.
 */
export function AreaPanel({
  area,
  retire,
  reopen,
}: {
  area: AreaCard;
  retire: Action;
  reopen: Action;
}) {
  const t = useTranslations("admin.areas");
  const [result, setResult] = React.useState<Result | null>(null);
  const retired = area.retiredAt !== null;

  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (retired ? "border-border bg-muted/30" : "border-border")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body-md font-medium">
          {area.city} · {t("ward", { n: String(area.wardNumber) })} ({area.name})
        </h2>
        <code className="text-caption text-muted-foreground">{area.key}</code>
      </div>

      <p className="mt-0.5 text-caption text-muted-foreground" lang="ne">
        {area.cityNe} · {area.nameNe}
      </p>

      {/*
        THE MISSING CENTROID IS SAID ON THE CARD, because it is the consequence
        of opening a ward that nobody would think to look for: distance ranking
        reads `seed/area-centroids.json`, and a ward added here is not in it
        until somebody runs the fetch script. Until then it ranks on its ward
        alone — not broken, and not what the other wards do.
      */}
      {!retired && area.centroidMissing ? (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-caption">
          {t("noCentroid")}
        </p>
      ) : null}

      {retired ? (
        <>
          <p className="mt-3 text-body-sm">
            {t("retiredOn", {
              when: new Date(area.retiredAt!).toISOString().slice(0, 10),
              why: area.retiredReason ?? "",
            })}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("retiredMeans")}
          </p>
          <form
            className="mt-3 space-y-2"
            action={async (data) => setResult(await reopen(data))}
          >
            <input type="hidden" name="key" value={area.key} />
            <Submit label={t("reopen")} busy={t("working")} variant="outline" />
            <Outcome result={result} />
          </form>
        </>
      ) : (
        <form
          className="mt-3 space-y-2"
          action={async (data) => setResult(await retire(data))}
        >
          <input type="hidden" name="key" value={area.key} />
          <div className="space-y-1.5">
            <Label htmlFor={`why-${area.key}`}>{t("why")}</Label>
            <Input
              id={`why-${area.key}`}
              name="reason"
              required
              minLength={4}
              autoComplete="off"
            />
          </div>
          <Submit
            label={t("retire")}
            busy={t("working")}
            variant="destructive"
          />
          <Outcome result={result} />
        </form>
      )}
    </div>
  );
}

/**
 * Open a ward.
 *
 * SIX FIELDS AND ALL SIX REQUIRED, including both Nepali ones. A ward with an
 * English name and no Nepali one renders the English into a Nepali page, which
 * is the half-translated screen rule 5 exists to prevent — and the one place it
 * would go unnoticed, because a Latin place name on a Devanagari page reads as a
 * name somebody chose not to translate rather than as a missing field.
 *
 * THE KEY IS TYPED RATHER THAN DERIVED, and that is deliberate even though
 * "kathmandu" + "4" would compose it. This string is already in
 * `addresses.area_key`, `providers.service_areas` and the centroid file with no
 * foreign key behind it, so it is not ours to generate — a derived key for
 * "Lalitpur" would be `lalitpur-4` today and whatever the slug rule becomes
 * tomorrow. Typing it makes the convention visible, and `areas_key_shape`
 * refuses anything that is not it.
 */
export function AddArea({ add }: { add: Action }) {
  const t = useTranslations("admin.areas");
  const [result, setResult] = React.useState<Result | null>(null);

  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="-mx-1 cursor-pointer rounded-md px-1 text-body-sm font-semibold transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:text-foreground/70">
        {t("addTitle")}
      </summary>

      <div className="animate-rise">
        <p className="mt-2 text-caption text-muted-foreground">{t("addLead")}</p>

        <form
          className="mt-3 space-y-3"
          action={async (data) => setResult(await add(data))}
        >
          <div className="space-y-1.5">
            <Label htmlFor="area-key">{t("keyLabel")}</Label>
            <Input
              id="area-key"
              name="key"
              required
              placeholder="kirtipur-5"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-caption text-muted-foreground">
              {t("keyHelp")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-32 flex-1 space-y-1.5">
              <Label htmlFor="area-city">{t("cityLabel")}</Label>
              <Input id="area-city" name="city" required autoComplete="off" />
            </div>
            <div className="min-w-32 flex-1 space-y-1.5">
              <Label htmlFor="area-city-ne">{t("cityNeLabel")}</Label>
              <Input
                id="area-city-ne"
                name="cityNe"
                required
                lang="ne"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-32 flex-1 space-y-1.5">
              <Label htmlFor="area-name">{t("nameLabel")}</Label>
              <Input id="area-name" name="name" required autoComplete="off" />
            </div>
            <div className="min-w-32 flex-1 space-y-1.5">
              <Label htmlFor="area-name-ne">{t("nameNeLabel")}</Label>
              <Input
                id="area-name-ne"
                name="nameNe"
                required
                lang="ne"
                autoComplete="off"
              />
            </div>
            <div className="min-w-24 space-y-1.5">
              <Label htmlFor="area-ward">{t("wardLabel")}</Label>
              <Input
                id="area-ward"
                name="wardNumber"
                type="number"
                inputMode="numeric"
                step={1}
                min={1}
                required
                autoComplete="off"
              />
            </div>
          </div>

          <Submit label={t("add")} busy={t("working")} />
          <Outcome result={result} />
        </form>
      </div>
    </details>
  );
}
