"use client";

import { useTranslations } from "next-intl";
import { Check, MapPin, Plus } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NewAddressDraft } from "@/lib/booking/flow-state";
import { cn } from "@/lib/utils";

export type SavedAddress = {
  id: string;
  label: string;
  tole: string;
  landmark: string;
  /** Canonical ward key — the shortlist is ranked against it. */
  areaKey: string;
  areaLabel: string;
};

export type AreaGroup = {
  city: string;
  options: Array<{ value: string; label: string }>;
};

const selectClass =
  "h-12 w-full rounded-lg border border-input bg-card px-3 text-body-md transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Step b — where.
 *
 * Saved addresses come first when there are any, because the returning
 * customer's whole job here is one tap.
 *
 * Landmark is required, and the helper line says why. In Nepal there is no
 * house number a stranger on a motorbike can use; the landmark is the field
 * that actually gets someone to the door. A required field with no explanation
 * reads as bureaucracy, so the explanation is part of the field.
 */
export function StepAddress({
  saved,
  areas,
  addressId,
  draft,
  errors,
  onSelect,
  onDraft,
}: {
  saved: SavedAddress[];
  areas: AreaGroup[];
  addressId: string | null;
  draft: NewAddressDraft;
  errors: Partial<Record<string, string>>;
  onSelect: (id: string | null) => void;
  onDraft: (patch: Partial<NewAddressDraft>) => void;
}) {
  const t = useTranslations("booking.flow.address");
  const tErr = useTranslations("booking.flow.errors");
  const addingNew = addressId === null;

  return (
    <div className="flex flex-col gap-5">
      {saved.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-semibold">{t("savedTitle")}</p>
          {saved.map((address) => {
            const active = addressId === address.id;
            return (
              <button
                key={address.id}
                type="button"
                onClick={() => onSelect(address.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <MapPin
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body-md font-semibold">
                    {address.label}
                  </span>
                  <span className="mt-0.5 block text-body-sm text-muted-foreground">
                    {address.tole} · {address.areaLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                    {address.landmark}
                  </span>
                </span>
                {active ? (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={addingNew}
            className={cn(
              "flex items-center gap-2 rounded-xl border border-dashed p-4 text-left text-body-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              addingNew
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            <Plus aria-hidden="true" className="size-4" />
            {t("addAnother")}
          </button>
        </div>
      ) : null}

      {addingNew ? (
        <div className={cn("flex flex-col gap-4", saved.length > 0 && "step-forward")}>
          <div>
            <Label htmlFor="area">{t("areaLabel")}</Label>
            <select
              id="area"
              value={draft.area}
              onChange={(event) => onDraft({ area: event.target.value })}
              className={cn(selectClass, "mt-2")}
              aria-describedby="area-error"
            >
              <option value="" disabled>
                {t("areaPlaceholder")}
              </option>
              {areas.map((group) => (
                <optgroup key={group.city} label={group.city}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <FieldError
              id="area-error"
              lines={1}
              message={errors.area ? tErr(errors.area) : null}
            />
          </div>

          <div>
            <Label htmlFor="tole">{t("toleLabel")}</Label>
            <Input
              id="tole"
              value={draft.tole}
              onChange={(event) => onDraft({ tole: event.target.value })}
              placeholder={t("tolePlaceholder")}
              className="mt-2 h-12"
              aria-describedby="tole-error"
              aria-invalid={Boolean(errors.tole)}
            />
            <FieldError
              id="tole-error"
              lines={1}
              message={errors.tole ? tErr(errors.tole) : null}
            />
          </div>

          <div>
            <Label htmlFor="landmark">{t("landmarkLabel")}</Label>
            <p className="mt-1 text-caption text-muted-foreground">
              {t("landmarkHelp")}
            </p>
            <Input
              id="landmark"
              value={draft.landmark}
              onChange={(event) => onDraft({ landmark: event.target.value })}
              placeholder={t("landmarkPlaceholder")}
              className="mt-2 h-12"
              aria-describedby="landmark-error"
              aria-invalid={Boolean(errors.landmark)}
            />
            <FieldError
              id="landmark-error"
              lines={1}
              message={errors.landmark ? tErr(errors.landmark) : null}
            />
          </div>

          <div>
            <Label htmlFor="directions">{t("directionsLabel")}</Label>
            <Input
              id="directions"
              value={draft.directionsNote}
              onChange={(event) =>
                onDraft({ directionsNote: event.target.value })
              }
              placeholder={t("directionsPlaceholder")}
              className="mt-2 h-12"
            />
          </div>

          <div>
            <Label htmlFor="label">{t("labelLabel")}</Label>
            <Input
              id="label"
              value={draft.label}
              onChange={(event) => onDraft({ label: event.target.value })}
              placeholder={t("labelPlaceholder")}
              className="mt-2 h-12 max-w-48"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-3 text-body-sm">
            <input
              type="checkbox"
              checked={draft.saveForNextTime}
              onChange={(event) =>
                onDraft({ saveForNextTime: event.target.checked })
              }
              className="size-4 rounded border-input accent-primary"
            />
            {t("saveForNextTime")}
          </label>
        </div>
      ) : null}
    </div>
  );
}
