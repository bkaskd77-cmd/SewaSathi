"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { ReauthNotice } from "@/components/admin/reauth-notice";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  scopeStanding,
  withKey,
  type LaunchScope,
  type ScopeStanding,
} from "@/lib/config/launch-scope";

/**
 * The soft-launch scope: a switch, two lists of checkboxes, and a note.
 *
 * ONE FORM FOR THE WHOLE SCOPE, not a toggle per ward. Four reasons, and the
 * last is the one that would have bitten: the row is one fact so a per-ward
 * writer would be four ways to write it; each tap would be its own audit row,
 * making "what did we open on the 14th" a diff of twenty rows rather than one;
 * a soft launch is widened in a sitting, not a ward at a time; and a per-ward
 * POST would mean a fresh second factor per tap, which is how people learn to
 * tap through the proofs that matter.
 *
 * THE STANDING IS COMPUTED FROM THE UNSAVED BOXES, which is why `scopeStanding`
 * and `withKey` are pure and live in `lib/config/`. Somebody unticking their
 * last open trade sees "this closes the product" BEFORE they save it, rather
 * than discovering it from a customer. `isFresh` was first written inside a
 * `server-only` module and had to be moved for exactly this; the rule is that
 * a judgement a screen needs to render cannot live where only the server can
 * reach it.
 */

type Result = { ok: boolean; reason?: string; unknown?: string[] };
type Action = (data: FormData) => Promise<Result>;

export type ScopeOption = { value: string; label: string; retired: boolean };

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
          {busy}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

function Checklist({
  name,
  options,
  open,
  onToggle,
  retiredNote,
}: {
  name: "area" | "category";
  options: ScopeOption[];
  open: readonly string[];
  onToggle: (value: string, next: boolean) => void;
  retiredNote: string;
}) {
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
      {options.map((option) => (
        <li key={option.value}>
          <label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-body-sm transition-colors hover:bg-muted/60">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              checked={open.includes(option.value)}
              onChange={(event) => onToggle(option.value, event.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              {option.label}
              {/*
                A RETIRED ROW IS STILL SHOWN, AND SAID TO BE. The scope can name
                one — the reads intersect it with what is live, so it narrows to
                nothing rather than resurrecting anything — and hiding it would
                silently drop it from the form on the next save, which is a
                change nobody made appearing in the audit row.
              */}
              {option.retired ? (
                <span className="ml-1 text-caption text-muted-foreground">
                  {retiredNote}
                </span>
              ) : null}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function LaunchScopePanel({
  scope,
  areas,
  categories,
  save,
}: {
  scope: LaunchScope;
  areas: ScopeOption[];
  categories: ScopeOption[];
  save: Action;
}) {
  const t = useTranslations("admin.launchScope");
  const [draft, setDraft] = React.useState<LaunchScope>(scope);
  const [result, setResult] = React.useState<Result | null>(null);

  const liveAreas = areas.filter((a) => !a.retired).map((a) => a.value);
  const liveCategories = categories.filter((c) => !c.retired).map((c) => c.value);
  const standing: ScopeStanding = scopeStanding(draft, liveAreas, liveCategories);

  return (
    <form
      className="mt-6"
      action={async (data) => setResult(await save(data))}
    >
      {/*
        THE SWITCH, AND A HIDDEN FIELD BEHIND IT. An unchecked checkbox sends
        nothing at all, so without the hidden input "off" and "the field was
        never rendered" would arrive identically — and the action would have to
        guess. Rule 6 in the shape HTML forms take.
      */}
      <input type="hidden" name="enabled" value={draft.enabled ? "true" : "false"} />

      <div className="rounded-lg border border-border p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft({ ...draft, enabled: event.target.checked })
            }
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block text-body-md">{t("enable")}</span>
            <span className="mt-0.5 block text-caption text-muted-foreground">
              {t("enableWhat")}
            </span>
          </span>
        </label>

        {/*
          WHAT THIS WILL DO, BEFORE IT IS SAVED. Four standings and the fourth
          is the one worth the screen: `closed` means either list is empty, so
          the product takes no bookings however full the other one is. It is a
          real state somebody may want — not refused, and not dressed up as a
          fault — so it is stated plainly rather than coloured as an error.
        */}
        <p
          className={
            standing === "closed"
              ? "mt-3 rounded-md bg-warning/10 px-3 py-2 text-body-sm text-warning-ink"
              : "mt-3 text-body-sm text-muted-foreground"
          }
        >
          {t(`standing.${standing}`)}
        </p>
      </div>

      <fieldset className="mt-5" disabled={!draft.enabled}>
        <legend className="text-heading-xs font-display">{t("wards")}</legend>
        <p className="text-caption text-muted-foreground">{t("wardsWhat")}</p>
        <Checklist
          name="area"
          options={areas}
          open={draft.areaKeys}
          retiredNote={t("retired")}
          onToggle={(value, next) =>
            setDraft(withKey(draft, "area", value, next))
          }
        />
      </fieldset>

      <fieldset className="mt-5" disabled={!draft.enabled}>
        <legend className="text-heading-xs font-display">{t("trades")}</legend>
        <p className="text-caption text-muted-foreground">{t("tradesWhat")}</p>
        <Checklist
          name="category"
          options={categories}
          open={draft.categorySlugs}
          retiredNote={t("retired")}
          onToggle={(value, next) =>
            setDraft(withKey(draft, "category", value, next))
          }
        />
      </fieldset>

      <div className="mt-5">
        <Label htmlFor="scope-note">{t("note")}</Label>
        <p className="text-caption text-muted-foreground">{t("noteWhat")}</p>
        <textarea
          id="scope-note"
          name="note"
          rows={2}
          maxLength={280}
          className="mt-1 w-full rounded-md border border-input bg-background p-3 text-body-md"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Submit label={t("save")} busy={t("saving")} />

        {result?.ok ? (
          <span className="flex items-center gap-1.5 text-body-sm text-success-ink">
            <Check aria-hidden="true" className="size-4" />
            {t("saved")}
          </span>
        ) : null}

        {result && !result.ok && result.reason !== "reauthNeeded" ? (
          <span className="text-body-sm text-destructive-ink">
            {result.reason === "unknownKey"
              ? t("unknownKey", { keys: (result.unknown ?? []).join(", ") })
              : t("notSaved")}
          </span>
        ) : null}
      </div>

      {/*
        THE REAUTH SENTENCE WITH THE LINK, rather than "that did not save".
        `freshAdminActor` refuses on a proof older than fifteen minutes and the
        remedy is a code — which somebody can only act on if the screen says so.
        It opens in a new tab, because this form carries a set of ticks and a
        typed note that navigating away would throw out.
      */}
      {result?.reason === "reauthNeeded" ? <ReauthNotice /> : null}
    </form>
  );
}
