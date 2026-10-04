"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CATEGORY_ICONS, categoryIcon } from "@/lib/config/icons";
import type { Category } from "@/lib/config/services";
import { cn } from "@/lib/utils";

/**
 * One category's words, its icon and where it sits in the grid.
 *
 * BOTH LANGUAGES BESIDE EACH OTHER, the same arrangement as the string editor and for
 * the same reason: renaming a category in English and leaving the Nepali is how the two
 * halves of the catalogue come to describe different trades, and nothing automated can
 * catch it because both are valid strings. Seeing them together is the only guard there
 * is.
 *
 * THE ICON IS PICKED, NEVER TYPED, AND IT IS DRAWN RATHER THAN NAMED. A dropdown of
 * twenty lucide names tells somebody nothing about what a customer will see — "AirVent"
 * and "Wind" are a coin toss from the word alone, which is exactly the confusion that got
 * `ac-servicing` wrong once already. So every option renders its own glyph.
 *
 * NO PRICE FIELD. The band is `/admin/bands`, where a proposal carries its evidence and a
 * rejection is stored. The current band is shown read-only so somebody editing the words
 * can see what the card will say beside them.
 *
 * NO AI, as decided. Nothing suggests a Nepali name.
 */
export function CategoryEditor({ category }: { category: Category }) {
  const t = useTranslations("admin.content.categories");
  const [icon, setIcon] = React.useState(category.icon);
  const [open, setOpen] = React.useState(false);
  const Current = categoryIcon(icon);

  return (
    <form action={save}>
      <input type="hidden" name="slug" value={category.slug} />
      <input type="hidden" name="icon" value={icon} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <Current aria-hidden="true" className="size-5" />
          </span>
          <code className="text-caption font-mono text-muted-foreground">
            {category.slug}
          </code>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("changeIcon")}
        </button>
      </div>

      {open ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("iconSet")}>
          {CATEGORY_ICONS.map((name) => {
            const Glyph = categoryIcon(name);
            const chosen = name === icon;
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => {
                    setIcon(name);
                    setOpen(false);
                  }}
                  aria-pressed={chosen}
                  title={name}
                  className={cn(
                    // 44px, so this clears the target-size minimum on a phone.
                    "btn-tactile grid size-11 place-items-center rounded-lg border transition-colors",
                    chosen
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Glyph aria-hidden="true" className="size-5" />
                  <span className="sr-only">{name}</span>
                  {chosen ? <Check aria-hidden="true" className="sr-only" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field name="nameEn" label={t("name")} hint="EN" value={category.nameEn} />
        <Field
          name="nameNe"
          label={t("name")}
          hint="ने"
          value={category.nameNe}
          locale="ne"
        />
        <Field
          name="descriptor"
          label={t("descriptor")}
          hint="EN"
          value={category.descriptor}
        />
        <Field
          name="descriptorNe"
          label={t("descriptor")}
          hint="ने"
          value={category.descriptorNe}
          locale="ne"
        />
        <Field
          name="description"
          label={t("description")}
          hint="EN"
          value={category.description}
          rows={3}
        />
        <Field
          name="descriptionNe"
          label={t("description")}
          hint="ने"
          value={category.descriptionNe}
          rows={3}
          locale="ne"
        />
        <Field
          name="ctaLabel"
          label={t("ctaLabel")}
          hint="EN"
          value={category.ctaLabel}
        />
        <Field
          name="ctaLabelNe"
          label={t("ctaLabel")}
          hint="ने"
          value={category.ctaLabelNe}
          locale="ne"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-body-sm">
          <span className="block font-medium">{t("sortOrder")}</span>
          <input
            type="number"
            name="sortOrder"
            defaultValue={category.sortOrder}
            min={0}
            step={1}
            required
            className="mt-1 h-11 w-24 rounded-lg border border-input bg-background px-3 text-body-sm"
          />
        </label>

        {/* Read-only on purpose. The band moves on /admin/bands and nowhere else. */}
        <p className="text-caption text-muted-foreground">
          {t("bandReadOnly", {
            min: String(category.basePriceMin),
            max: String(category.basePriceMax),
          })}
        </p>

        <SaveButton label={t("save")} />
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  value,
  rows = 2,
  locale,
}: {
  name: string;
  label: string;
  hint: string;
  value: string;
  rows?: number;
  locale?: "ne";
}) {
  const id = `${name}-field`;
  return (
    <div className="flex flex-col">
      <label className="text-caption font-medium" htmlFor={id}>
        {label} <span className="text-muted-foreground">{hint}</span>
      </label>
      <textarea
        id={id}
        name={name}
        defaultValue={value}
        rows={rows}
        required
        maxLength={400}
        lang={locale}
        className="mt-1 w-full rounded-lg border border-input bg-background p-2.5 text-body-sm"
      />
    </div>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" className="btn-tactile" disabled={pending}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}

/** Bound at call time so this stays a plain client component. */
async function save(formData: FormData) {
  const { setCategoryAction } = await import(
    "@/app/[locale]/(admin)/admin/content/categories/actions"
  );
  await setCategoryAction(formData);
}
