"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { ReauthNotice, isReauthReason } from "@/components/admin/reauth-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CategoryGap } from "@/lib/config/category-readiness";

type Result = { ok: boolean; reason?: string };
type Action = (data: FormData) => Promise<Result>;

export type CategoryStanding = {
  slug: string;
  name: string;
  retiredAt: string | null;
  retiredReason: string | null;
  /** What the trade has not got yet, derived by `categoryReadiness`. */
  gaps: CategoryGap[];
  /** The subset of `gaps` that only a commit can close. */
  needsCode: CategoryGap[];
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
  const t = useTranslations("admin.content.standing");
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
 * Whether we sell this trade, and the one action available.
 *
 * SEPARATE FROM THE WORDS EDITOR ON THE SAME SCREEN, and it reads as one card
 * because it is one trade. The words are an eight-hour admin edit and this is a
 * fifteen-minute one — a descriptor is reversible and costs nobody anything,
 * where withdrawing a trade stops every future booking in it. Two gates on one
 * screen needs the heavier one to look different, which is what the border and
 * the typed reason are for.
 *
 * THE ACTION IS SINGULAR, `AreaPanel`'s rule: a live trade offers only Withdraw
 * and a withdrawn one only Sell again, never both.
 *
 * WHAT THE TRADE STILL LACKS IS PRINTED HERE AND NOT HIDDEN BEHIND THE ADD
 * FORM, because the gaps outlive the moment of opening. A row inserted into
 * `categories` renders perfectly on the landing grid while the keyword matcher
 * cannot reach it, there are no products to narrow to and the band is a guess —
 * and "ten trades" looked identical either way. It measures and does not grade:
 * no score, no colour for bad, nothing blocked. `/admin/signals`' posture.
 */
export function CategoryStandingPanel({
  category,
  retire,
  reopen,
}: {
  category: CategoryStanding;
  retire: Action;
  reopen: Action;
}) {
  const t = useTranslations("admin.content.standing");
  const [result, setResult] = React.useState<Result | null>(null);
  const retired = category.retiredAt !== null;

  return (
    <div
      className={
        "mt-3 rounded-lg border p-3 " +
        (retired ? "border-border bg-muted/30" : "border-border")
      }
    >
      {retired ? (
        <>
          <p className="text-body-sm">
            {t("retiredOn", {
              when: new Date(category.retiredAt!).toISOString().slice(0, 10),
              why: category.retiredReason ?? "",
            })}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("retiredMeans")}
          </p>
          <form
            className="mt-3 space-y-2"
            action={async (data) => setResult(await reopen(data))}
          >
            <input type="hidden" name="slug" value={category.slug} />
            <Submit label={t("reopen")} busy={t("working")} variant="outline" />
            <Outcome result={result} />
          </form>
        </>
      ) : (
        <>
          {/*
            THE GAPS, WITH THE REMEDY SPLIT OUT. A band moves on `/admin/bands`
            and products could get a screen; `KEYWORD_RULES` and
            `GUARANTEE_WINDOWS` are TypeScript, so those two are a commit — and
            a list that mixed them would read as four things somebody could go
            and do this afternoon.
          */}
          {category.gaps.length > 0 ? (
            <div className="mb-3">
              <p className="text-caption font-medium">{t("gapsTitle")}</p>
              <ul className="mt-1 space-y-0.5">
                {category.gaps.map((gap) => (
                  <li key={gap} className="text-caption text-muted-foreground">
                    {t(`gaps.${gap}` as "gaps.noProducts")}
                  </li>
                ))}
              </ul>
              {category.needsCode.length > 0 ? (
                <p className="mt-1 text-caption text-muted-foreground">
                  {t("gapsNeedCode", { n: String(category.needsCode.length) })}
                </p>
              ) : null}
            </div>
          ) : null}

          {/*
            A TYPED REASON RATHER THAN AN "ARE YOU SURE", `AreaPanel`'s rule: a
            confirmation teaches somebody to tap through, where typing why is
            the pause and the record at once. `categories_retired_shape` refuses
            a blank one, so the form and the database agree.
          */}
          <form
            className="space-y-2"
            action={async (data) => setResult(await retire(data))}
          >
            <input type="hidden" name="slug" value={category.slug} />
            <div className="space-y-1.5">
              <Label htmlFor={`why-${category.slug}`}>{t("why")}</Label>
              <Input
                id={`why-${category.slug}`}
                name="reason"
                required
                minLength={4}
                autoComplete="off"
              />
              <p className="text-caption text-muted-foreground">
                {t("retireMeans")}
              </p>
            </div>
            <Submit
              label={t("retire")}
              busy={t("working")}
              variant="destructive"
            />
            <Outcome result={result} />
          </form>
        </>
      )}
    </div>
  );
}

/**
 * Open a trade.
 *
 * ELEVEN FIELDS, ALL REQUIRED, INCLUDING FOUR NEPALI ONES. `addArea`'s rule
 * with more of them: a trade with English words and no Nepali ones renders
 * Latin script into a Nepali page, where it reads as a trade name somebody
 * chose not to translate rather than as a missing field.
 *
 * THE SLUG IS TYPED RATHER THAN DERIVED FROM THE NAME, which is `AddArea`'s
 * reasoning and stronger here. The string lands in `bookings.category_slug`,
 * `provider_categories`, `category_price_bands`, `category_pricing_signals`,
 * the keys of `GUARANTEE_WINDOWS`, every `KEYWORD_RULES` entry and the
 * `/services/[slug]` URL — with no foreign key behind most of them. A derived
 * slug would be whatever the slug rule happens to be that week.
 *
 * NO PROVENANCE FIELD BESIDE THE BAND, deliberately. A figure typed here is
 * `invented` and `addCategory` writes exactly that: offering a dropdown would
 * let somebody declare their own guess `researched` and route around
 * `check:blockers`, which is the one gate that reads the column. The sentence
 * under the boxes says so rather than leaving it to be discovered.
 *
 * THE ICON IS A SELECT FROM `CATEGORY_ICONS` and never free text — `icon` is a
 * text column and `categoryIcon` resolves an unknown name to `Wrench`, so a
 * typo would be a silently wrong glyph on the landing grid.
 */
export function AddCategory({
  add,
  icons,
}: {
  add: Action;
  /** `CATEGORY_ICONS` — the icon map's own keys, so this cannot drift. */
  icons: readonly string[];
}) {
  const t = useTranslations("admin.content.standing");
  const [result, setResult] = React.useState<Result | null>(null);
  const [survey, setSurvey] = React.useState(false);

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
            <Label htmlFor="cat-slug">{t("slugLabel")}</Label>
            <Input
              id="cat-slug"
              name="slug"
              required
              placeholder="gardening"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-caption text-muted-foreground">
              {t("slugHelp")}
            </p>
          </div>

          <Pair
            idA="cat-name"
            nameA="nameEn"
            labelA={t("nameLabel")}
            idB="cat-name-ne"
            nameB="nameNe"
            labelB={t("nameNeLabel")}
          />
          <Pair
            idA="cat-descriptor"
            nameA="descriptor"
            labelA={t("descriptorLabel")}
            idB="cat-descriptor-ne"
            nameB="descriptorNe"
            labelB={t("descriptorNeLabel")}
          />
          <Pair
            idA="cat-description"
            nameA="description"
            labelA={t("descriptionLabel")}
            idB="cat-description-ne"
            nameB="descriptionNe"
            labelB={t("descriptionNeLabel")}
          />
          <Pair
            idA="cat-cta"
            nameA="ctaLabel"
            labelA={t("ctaLabel")}
            idB="cat-cta-ne"
            nameB="ctaLabelNe"
            labelB={t("ctaNeLabel")}
          />

          <div className="space-y-1.5">
            <Label htmlFor="cat-icon">{t("iconLabel")}</Label>
            <select
              id="cat-icon"
              name="icon"
              required
              defaultValue=""
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-body-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="" disabled>
                {t("iconPlaceholder")}
              </option>
              {icons.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </div>

          {/*
            SURVEY HIDES THE BOXES RATHER THAN IGNORING THEM. A trade priced
            after a free survey publishes no range anywhere — `categoryQuote`
            answers `survey` first and never reads the figures — so leaving two
            inputs on screen would invite somebody to type a band that nothing
            will ever show.
          */}
          <fieldset className="space-y-2">
            <legend className="text-body-sm font-medium">
              {t("pricingLabel")}
            </legend>
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="radio"
                name="pricingModel"
                value="band"
                checked={!survey}
                onChange={() => setSurvey(false)}
              />
              {t("pricingBand")}
            </label>
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="radio"
                name="pricingModel"
                value="survey"
                checked={survey}
                onChange={() => setSurvey(true)}
              />
              {t("pricingSurvey")}
            </label>
          </fieldset>

          {survey ? (
            <p className="animate-rise text-caption text-muted-foreground">
              {t("surveyMeans")}
            </p>
          ) : (
            <div className="animate-rise space-y-1.5">
              <div className="flex flex-wrap gap-3">
                <div className="min-w-32 flex-1 space-y-1.5">
                  <Label htmlFor="cat-band-min">{t("bandMinLabel")}</Label>
                  <Input
                    id="cat-band-min"
                    name="bandMin"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <div className="min-w-32 flex-1 space-y-1.5">
                  <Label htmlFor="cat-band-max">{t("bandMaxLabel")}</Label>
                  <Input
                    id="cat-band-max"
                    name="bandMax"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
              </div>
              <p className="text-caption text-muted-foreground">
                {t("bandIsAGuess")}
              </p>
            </div>
          )}

          <Submit label={t("add")} busy={t("working")} />
          <Outcome result={result} />
        </form>
      </div>
    </details>
  );
}

/** Two sides of one sentence, English beside Nepali so neither is forgotten. */
function Pair({
  idA,
  nameA,
  labelA,
  idB,
  nameB,
  labelB,
}: {
  idA: string;
  nameA: string;
  labelA: string;
  idB: string;
  nameB: string;
  labelB: string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="min-w-32 flex-1 space-y-1.5">
        <Label htmlFor={idA}>{labelA}</Label>
        <Input id={idA} name={nameA} required autoComplete="off" />
      </div>
      <div className="min-w-32 flex-1 space-y-1.5">
        <Label htmlFor={idB}>{labelB}</Label>
        <Input id={idB} name={nameB} required lang="ne" autoComplete="off" />
      </div>
    </div>
  );
}
