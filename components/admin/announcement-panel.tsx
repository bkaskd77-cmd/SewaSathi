"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TONES,
  isoToNepalStamp,
  type AnnouncementAudience,
  type AnnouncementTone,
} from "@/lib/config/announcements";

type Result = { ok: boolean; reason?: string };
type Action = (data: FormData) => Promise<Result>;

export type AnnouncementCardData = {
  id: string;
  bodyEn: string;
  bodyNe: string;
  audience: AnnouncementAudience;
  tone: AnnouncementTone;
  startsAt: string;
  endsAt: string | null;
  enabled: boolean;
  standing: "showing" | "scheduled" | "over";
};

const TEXTAREA =
  "w-full rounded-md border border-input bg-background p-3 text-body-md";

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
  const t = useTranslations("admin.announcements");
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
        <Check className="size-4" aria-hidden />
        {t("done")}
      </p>
    );
  }
  /*
   * NO `ReauthNotice` HERE, AND THAT IS `adminActor`'S RULE RATHER THAN AN
   * OMISSION. The money screens get one because `freshAdminActor()` hands back
   * `reauthNeeded`, which it may safely do: only somebody who already passed
   * the role check and the eight-hour step-up can see it. This gate collapses
   * both halves on purpose — an action must not tell a caller which half of it
   * they failed — so there is no second sentence to show and `notAdmin` is the
   * whole answer.
   */
  return (
    <p role="alert" className="animate-rise text-body-sm text-destructive-ink">
      {t(`errors.${result.reason}` as "errors.refused")}
    </p>
  );
}

/**
 * The two bodies, with the bound printed above them.
 *
 * SHARED BY PUBLISH AND EDIT so the two forms cannot disagree about what a
 * banner may be — the divergence `lib/provider/measured.ts` exists to prevent,
 * one layer up in the markup. `ANNOUNCEMENT_BODY_MAX` is interpolated rather
 * than written into the sentence, so a copy of the number cannot go stale in
 * the catalogue while rendering perfectly.
 */
function Bodies({
  idPrefix,
  bodyEn,
  bodyNe,
}: {
  idPrefix: string;
  bodyEn?: string;
  bodyNe?: string;
}) {
  const t = useTranslations("admin.announcements");
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-en`}>{t("bodyEn")}</Label>
        <textarea
          id={`${idPrefix}-en`}
          name="bodyEn"
          rows={2}
          required
          maxLength={ANNOUNCEMENT_BODY_MAX}
          defaultValue={bodyEn}
          className={TEXTAREA}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-ne`}>{t("bodyNe")}</Label>
        <textarea
          id={`${idPrefix}-ne`}
          name="bodyNe"
          rows={2}
          required
          lang="ne"
          maxLength={ANNOUNCEMENT_BODY_MAX}
          defaultValue={bodyNe}
          className={TEXTAREA}
        />
      </div>
      {/* THE BOUND IS PRINTED, NEVER FOUND BY TRIPPING IT. `statedBandRefusal`'s
          rule, and `/providers/standards`' argument that a threshold nobody can
          read is a trap rather than a deterrent. */}
      <p className="text-caption text-muted-foreground">
        {t("bothLanguages", {
          count: ANNOUNCEMENT_BODY_MAX,
          n: String(ANNOUNCEMENT_BODY_MAX),
        })}
      </p>
    </>
  );
}

/** The tone radio group, rendered from the constant rather than hand-listed. */
function ToneChoice({
  idPrefix,
  current,
}: {
  idPrefix: string;
  current?: AnnouncementTone;
}) {
  const t = useTranslations("admin.announcements");
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-body-sm font-medium">{t("tone")}</legend>
      <div className="flex flex-wrap gap-3">
        {ANNOUNCEMENT_TONES.map((tone) => (
          <label
            key={tone}
            className="flex items-center gap-1.5 text-body-sm"
            htmlFor={`${idPrefix}-tone-${tone}`}
          >
            <input
              id={`${idPrefix}-tone-${tone}`}
              type="radio"
              name="tone"
              value={tone}
              defaultChecked={(current ?? "notice") === tone}
            />
            {t(`tones.${tone}` as "tones.notice")}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Put a banner up.
 *
 * THE AUDIENCE AND THE TONE ARE RENDERED FROM THEIR CONSTANTS, which is
 * `REFUSAL_REASON_CODES`' arrangement: a value offered here that the column
 * refuses would lose the banner in the same statement that wrote it, and
 * `tests/db/announcements.test.ts` reads the check constraint and compares the
 * two lists for exactly that reason.
 *
 * THE WINDOW IS TWO OPTIONAL BOXES AND BOTH EMPTY IS THE COMMON CASE: start
 * blank means now, end blank means "until somebody takes it down". The screen
 * says the second one in those words, because the difference between a banner
 * that stops by itself and one somebody has to remember is the whole difference
 * between a note and a thing that quietly becomes part of the product.
 */
export function PublishAnnouncement({ publish }: { publish: Action }) {
  const t = useTranslations("admin.announcements");
  const [result, setResult] = React.useState<Result | null>(null);

  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="-mx-1 cursor-pointer rounded-md px-1 text-body-sm font-semibold transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:text-foreground/70">
        {t("publishTitle")}
      </summary>

      <div className="animate-rise">
        <p className="mt-2 text-caption text-muted-foreground">
          {t("publishLead")}
        </p>

        <form
          className="mt-3 space-y-3"
          action={async (data) => setResult(await publish(data))}
        >
          <Bodies idPrefix="new" />

          <fieldset className="space-y-1.5">
            <legend className="text-body-sm font-medium">{t("audience")}</legend>
            <div className="flex flex-wrap gap-3">
              {ANNOUNCEMENT_AUDIENCES.map((audience) => (
                <label
                  key={audience}
                  className="flex items-center gap-1.5 text-body-sm"
                  htmlFor={`new-audience-${audience}`}
                >
                  <input
                    id={`new-audience-${audience}`}
                    type="radio"
                    name="audience"
                    value={audience}
                    defaultChecked={audience === "everyone"}
                    required
                  />
                  {t(`audiences.${audience}` as "audiences.everyone")}
                </label>
              ))}
            </div>
            <p className="text-caption text-muted-foreground">
              {t("audienceHelp")}
            </p>
          </fieldset>

          <ToneChoice idPrefix="new" />

          <div className="flex flex-wrap gap-3">
            <div className="min-w-44 flex-1 space-y-1.5">
              <Label htmlFor="new-starts">{t("startsAt")}</Label>
              <Input id="new-starts" name="startsAt" type="datetime-local" />
            </div>
            <div className="min-w-44 flex-1 space-y-1.5">
              <Label htmlFor="new-ends">{t("endsAt")}</Label>
              <Input id="new-ends" name="endsAt" type="datetime-local" />
            </div>
          </div>
          {/* THE ZONE IS ON THE SCREEN. A `datetime-local` box sends no
              timezone and the server runs on UTC, so an admin in Kathmandu
              typing 09:00 would otherwise publish a banner that appeared at
              14:45 their own time. `nepalStampToIso` is the fix and this
              sentence is what makes the assumption visible. */}
          <p className="text-caption text-muted-foreground">
            {t("windowHelp")}
          </p>

          <Submit label={t("publish")} busy={t("working")} />
          <Outcome result={result} />
        </form>
      </div>
    </details>
  );
}

/**
 * One banner: what it says, who sees it, and the one thing to do with it.
 *
 * THE ACTION IS SINGULAR, `AreaPanel`'s rule: a banner that is up offers Take
 * down and one that is not offers Put back up — never both, because a card with
 * two opposite buttons invites the wrong one. Editing sits behind a disclosure
 * below it, so the primary action stays one tap and the fix for a typo is one
 * more.
 *
 * THERE IS NO DELETE, here or in the data layer, and the audit log is why that
 * costs nothing: `announcements` has no history table because
 * `security_events` already records every publish, edit, withdrawal and
 * restoration with the words in both languages. A row removed from this table
 * would leave that record pointing at nothing.
 */
export function AnnouncementCard({
  announcement,
  edit,
  setEnabled,
}: {
  announcement: AnnouncementCardData;
  edit: Action;
  setEnabled: Action;
}) {
  const t = useTranslations("admin.announcements");
  const [result, setResult] = React.useState<Result | null>(null);
  const showing = announcement.standing === "showing";

  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (showing ? "border-border" : "border-border bg-muted/30")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`standings.${announcement.standing}` as "standings.showing")}
        </span>
        <span className="text-caption text-muted-foreground">
          {t(
            `audiences.${announcement.audience}` as "audiences.everyone",
          )}{" "}
          · {t(`tones.${announcement.tone}` as "tones.notice")}
        </span>
      </div>

      <p className="mt-2 text-body-md">{announcement.bodyEn}</p>
      <p className="mt-1 text-body-sm text-muted-foreground" lang="ne">
        {announcement.bodyNe}
      </p>

      <p className="mt-3 text-caption text-muted-foreground">
        {announcement.endsAt === null
          ? /* IN THOSE WORDS. A null end is not a date nobody filled in — it is
               a banner that needs somebody to remember, and saying so is the
               difference between a decision and an accident. */
            t("fromUntilTakenDown", {
              from: isoToNepalStamp(announcement.startsAt).replace("T", " "),
            })
          : t("fromUntil", {
              from: isoToNepalStamp(announcement.startsAt).replace("T", " "),
              to: isoToNepalStamp(announcement.endsAt).replace("T", " "),
            })}
      </p>

      {/* THE SWITCH AND THE WINDOW ARE DIFFERENT FACTS, so a banner that was
          taken down inside its window says so rather than looking expired. */}
      {!announcement.enabled ? (
        <p className="mt-1 text-caption text-muted-foreground">
          {t("takenDown")}
        </p>
      ) : null}

      <form
        className="mt-3 space-y-2"
        action={async (data) => setResult(await setEnabled(data))}
      >
        <input type="hidden" name="id" value={announcement.id} />
        <input
          type="hidden"
          name="enabled"
          value={announcement.enabled ? "false" : "true"}
        />
        <Submit
          label={announcement.enabled ? t("takeDown") : t("putBack")}
          busy={t("working")}
          variant={announcement.enabled ? "destructive" : "outline"}
        />
      </form>

      <details className="mt-3">
        <summary className="-mx-1 cursor-pointer rounded-md px-1 text-body-sm transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t("editTitle")}
        </summary>
        <div className="animate-rise">
          <p className="mt-2 text-caption text-muted-foreground">
            {t("editLead")}
          </p>
          <form
            className="mt-3 space-y-3"
            action={async (data) => setResult(await edit(data))}
          >
            <input type="hidden" name="id" value={announcement.id} />
            <Bodies
              idPrefix={`edit-${announcement.id}`}
              bodyEn={announcement.bodyEn}
              bodyNe={announcement.bodyNe}
            />
            <ToneChoice
              idPrefix={`edit-${announcement.id}`}
              current={announcement.tone}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`edit-${announcement.id}-ends`}>
                {t("endsAt")}
              </Label>
              {/* The stored instant rendered back into Nepal time, not UTC —
                  the box would otherwise show a time 5h45 earlier than the one
                  that was published, and saving it unchanged would move the
                  banner. */}
              <Input
                id={`edit-${announcement.id}-ends`}
                name="endsAt"
                type="datetime-local"
                defaultValue={
                  announcement.endsAt === null
                    ? ""
                    : isoToNepalStamp(announcement.endsAt)
                }
              />
            </div>
            <Submit
              label={t("save")}
              busy={t("working")}
              variant="outline"
            />
          </form>
        </div>
      </details>

      <Outcome result={result} />
    </div>
  );
}
