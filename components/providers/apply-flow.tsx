"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Loader2 } from "lucide-react";

import { DocumentCapture } from "@/components/providers/document-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The eight steps, and the motion that makes moving between them legible.
 *
 * ONE STEP ON SCREEN AT A TIME, entering from the side it came from. A long
 * form that re-renders in place reads as a glitch: the eye cannot tell
 * "saved, here is the next thing" from "nothing happened, it redrew". The
 * direction carries the meaning, so going back animates backwards.
 *
 * THE PROGRESS BAR IS A PROMISE. Somebody on step three of eight has decided
 * whether to finish based on how much is left, so the count is honest and the
 * fill travels rather than jumping — a bar that snaps looks like a page load.
 *
 * WHY THE STEP DATA IS NOT HELD HERE. Each step posts to a server action and
 * the page re-renders from the database. Holding it in React state would mean
 * a dropped connection loses everything typed since the last step, and a
 * dropped connection is the normal case for this audience.
 */

export type ApplyDraft = {
  id: string;
  step: number;
  status: string;
  fullName: string | null;
  fullNameNe: string | null;
  dateOfBirth: string | null;
  trades: string[];
  yearsExperience: number | null;
  serviceAreas: string[];
  citizenshipNumber: string | null;
  panNumber: string | null;
  payoutMethod: string | null;
  payoutAccount: string | null;
  payoutBankName: string | null;
  hasConsent: boolean;
};

export type ApplyResult = { ok: true; step?: number } | { ok: false; error: string };

export type ApplyFlowProps = {
  draft: ApplyDraft;
  totalSteps: number;
  categories: Array<{ slug: string; name: string }>;
  areas: Array<{ key: string; label: string }>;
  documents: Array<{
    kind: string;
    required: boolean;
    expires: boolean;
    uploaded: boolean;
  }>;
  references: Array<{ id: string; name: string; relationship: string | null }>;
  missing: string[];
  consentAction: (
    previous: ApplyResult | null,
    formData: FormData,
  ) => Promise<ApplyResult>;
  saveStepAction: (
    previous: ApplyResult | null,
    formData: FormData,
  ) => Promise<ApplyResult>;
  addReferenceAction: (
    previous: ApplyResult | null,
    formData: FormData,
  ) => Promise<ApplyResult>;
  submitAction: (
    previous: ApplyResult | null,
    formData: FormData,
  ) => Promise<ApplyResult>;
  uploadDocumentAction: (input: {
    applicationId: string;
    kind: string;
    base64: string;
    captureQuality?: number;
    expiresOn?: string | null;
  }) => Promise<ApplyResult>;
};

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="btn-tactile" disabled={pending}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {pending ? busy : label}
    </Button>
  );
}

export function ApplyFlow(props: ApplyFlowProps) {
  const t = useTranslations("join.apply");

  /*
   * The step the person is LOOKING at, which is not always the furthest they
   * have reached — going back to fix a spelling must not throw away the rest.
   * The server keeps the high-water mark; this is only what is on screen.
   */
  const [viewing, setViewing] = React.useState(props.draft.step);
  const [direction, setDirection] = React.useState<"forward" | "back">("forward");

  const step = Math.min(Math.max(viewing, 1), props.totalSteps);

  const go = React.useCallback((next: number, how: "forward" | "back") => {
    setDirection(how);
    setViewing(next);
  }, []);

  // When a server action advances the draft, follow it.
  React.useEffect(() => {
    if (props.draft.step > viewing) {
      setDirection("forward");
      setViewing(props.draft.step);
    }
    // Only react to the server's own movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draft.step]);

  const percent = Math.round((step / props.totalSteps) * 100);

  return (
    <div>
      {/* The promise: how much is left, and a fill that travels. */}
      <div className="mb-6">
        <p className="text-caption text-muted-foreground">
          {t("progress", { step: String(step), total: String(props.totalSteps) })}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div
        key={step}
        className={cn(
          direction === "forward" ? "animate-step-in" : "animate-step-back",
        )}
      >
        {step === 1 ? (
          <ConsentStep {...props} />
        ) : step === 2 ? (
          <DetailsStep {...props} />
        ) : step === 3 ? (
          <TradesStep {...props} />
        ) : step === 4 ? (
          <AreasStep {...props} />
        ) : step === 5 ? (
          <DocumentsStep {...props} onDone={() => go(6, "forward")} />
        ) : step === 6 ? (
          <PayoutStep {...props} />
        ) : step === 7 ? (
          <ReferencesStep {...props} onDone={() => go(8, "forward")} />
        ) : (
          <ReviewStep {...props} onEdit={(to) => go(to, "back")} />
        )}
      </div>

      {step > 1 ? (
        <Button
          type="button"
          variant="ghost"
          className="btn-tactile mt-6"
          onClick={() => go(step - 1, "back")}
        >
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

function Problem({ error }: { error: string | null }) {
  const t = useTranslations("join.apply");
  if (!error) return null;
  return (
    <p className="animate-rise mt-3 text-body-sm text-destructive" role="alert">
      {t(`errors.${error}` as "errors.generic")}
    </p>
  );
}

function ConsentStep(props: ApplyFlowProps) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.consentAction,
    null,
  );
  const [agreed, setAgreed] = React.useState(props.draft.hasConsent);

  const points = ["whatWeCollect", "yourFace", "why", "whoSees", "howLong"] as const;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={props.draft.id} />
      <h2 className="font-display text-heading-md">{t("consent.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("consent.lead")}</p>

      <ul className="space-y-3">
        {points.map((point, index) => (
          <li
            key={point}
            className="animate-rise rounded-md border border-border p-3 text-body-sm"
            style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
          >
            {t(`consent.${point}` as "consent.why")}
          </li>
        ))}
      </ul>

      <label className="flex items-start gap-2.5 text-body-md">
        <input
          type="checkbox"
          name="agree"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span>{t("consent.agree")}</span>
      </label>

      {state && !state.ok && state.error === "mustAgree" ? (
        <p className="animate-rise text-body-sm text-destructive" role="alert">
          {t("consent.mustAgree")}
        </p>
      ) : (
        <Problem error={state && !state.ok ? state.error : null} />
      )}

      <Submit label={t("consent.continue")} busy={t("saving")} />
    </form>
  );
}

function DetailsStep(props: ApplyFlowProps) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.saveStepAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={props.draft.id} />
      <input type="hidden" name="step" value={2} />
      <h2 className="font-display text-heading-md">{t("details.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("details.lead")}</p>

      <Field label={t("details.fullName")} name="fullName" defaultValue={props.draft.fullName} required />
      <Field label={t("details.fullNameNe")} name="fullNameNe" defaultValue={props.draft.fullNameNe} />
      <Field label={t("details.dob")} name="dateOfBirth" type="date" defaultValue={props.draft.dateOfBirth} />
      <Field
        label={t("details.citizenship")}
        name="citizenshipNumber"
        defaultValue={props.draft.citizenshipNumber}
        hint={t("details.citizenshipHint")}
        required
      />
      <Field
        label={t("details.pan")}
        name="panNumber"
        defaultValue={props.draft.panNumber}
        hint={t("details.panHint")}
      />

      <Problem error={state && !state.ok ? state.error : null} />
      <Submit label={t("next")} busy={t("saving")} />
    </form>
  );
}

function TradesStep(props: ApplyFlowProps) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.saveStepAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={props.draft.id} />
      <input type="hidden" name="step" value={3} />
      <h2 className="font-display text-heading-md">{t("trades.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("trades.lead")}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {props.categories.map((category, index) => (
          <label
            key={category.slug}
            className="animate-rise flex items-center gap-2.5 rounded-md border border-border p-3 text-body-md transition-colors hover:border-primary/50"
            style={{ animationDelay: `${Math.min(index * 0.04, 0.25)}s` }}
          >
            <input
              type="checkbox"
              name="trades"
              value={category.slug}
              defaultChecked={props.draft.trades.includes(category.slug)}
              className="size-4 shrink-0 accent-primary"
            />
            {category.name}
          </label>
        ))}
      </div>

      <Field
        label={t("trades.experience")}
        name="yearsExperience"
        type="number"
        defaultValue={
          props.draft.yearsExperience === null
            ? null
            : String(props.draft.yearsExperience)
        }
      />

      <Problem error={state && !state.ok ? state.error : null} />
      <Submit label={t("next")} busy={t("saving")} />
    </form>
  );
}

function AreasStep(props: ApplyFlowProps) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.saveStepAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={props.draft.id} />
      <input type="hidden" name="step" value={4} />
      <h2 className="font-display text-heading-md">{t("areas.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("areas.lead")}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {props.areas.map((area, index) => (
          <label
            key={area.key}
            className="animate-rise flex items-center gap-2.5 rounded-md border border-border p-3 text-body-sm transition-colors hover:border-primary/50"
            style={{ animationDelay: `${Math.min(index * 0.03, 0.25)}s` }}
          >
            <input
              type="checkbox"
              name="serviceAreas"
              value={area.key}
              defaultChecked={props.draft.serviceAreas.includes(area.key)}
              className="size-4 shrink-0 accent-primary"
            />
            {area.label}
          </label>
        ))}
      </div>

      <Problem error={state && !state.ok ? state.error : null} />
      <Submit label={t("next")} busy={t("saving")} />
    </form>
  );
}

function DocumentsStep(props: ApplyFlowProps & { onDone: () => void }) {
  const t = useTranslations("join.apply");

  return (
    <div className="space-y-4">
      <h2 className="font-display text-heading-md">{t("documents.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("documents.lead")}</p>

      <div className="space-y-3">
        {props.documents.map((document, index) => (
          <div
            key={document.kind}
            className="animate-rise"
            style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
          >
            <DocumentCapture
              kind={document.kind}
              label={t(`documents.${document.kind}` as "documents.citizenship")}
              hint={
                document.kind === "selfie"
                  ? t("documents.selfieHint")
                  : document.kind === "police_clearance"
                    ? t("documents.policeHint")
                    : document.kind === "ctevt"
                      ? t("documents.ctevtHint")
                      : undefined
              }
              required={document.required}
              alreadyUploaded={document.uploaded}
              wantsExpiry={document.expires}
              onUpload={async (input) => {
                const result = await props.uploadDocumentAction({
                  applicationId: props.draft.id,
                  ...input,
                });
                return result.ok
                  ? { ok: true }
                  : { ok: false, error: result.error };
              }}
            />
          </div>
        ))}
      </div>

      <Button type="button" className="btn-tactile" onClick={props.onDone}>
        {t("next")}
      </Button>
    </div>
  );
}

function PayoutStep(props: ApplyFlowProps) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.saveStepAction,
    null,
  );
  const [method, setMethod] = React.useState(props.draft.payoutMethod ?? "esewa");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={props.draft.id} />
      <input type="hidden" name="step" value={6} />
      <h2 className="font-display text-heading-md">{t("payout.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("payout.lead")}</p>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-body-sm font-medium">
          {t("payout.method")}
        </legend>
        {(["esewa", "khalti", "bank"] as const).map((option) => (
          <label
            key={option}
            className={cn(
              "flex items-center gap-2.5 rounded-md border p-3 text-body-md transition-colors",
              method === option ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <input
              type="radio"
              name="payoutMethod"
              value={option}
              checked={method === option}
              onChange={() => setMethod(option)}
              className="size-4 accent-primary"
            />
            {t(`payout.${option}` as "payout.esewa")}
          </label>
        ))}
      </fieldset>

      <Field
        label={
          method === "bank" ? t("payout.account") : t("payout.accountEsewa")
        }
        name="payoutAccount"
        defaultValue={props.draft.payoutAccount}
        required
      />
      {method === "bank" ? (
        <Field
          label={t("payout.bankName")}
          name="payoutBankName"
          defaultValue={props.draft.payoutBankName}
        />
      ) : null}

      <Problem error={state && !state.ok ? state.error : null} />
      <Submit label={t("next")} busy={t("saving")} />
    </form>
  );
}

function ReferencesStep(props: ApplyFlowProps & { onDone: () => void }) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.addReferenceAction,
    null,
  );

  return (
    <div className="space-y-4">
      <h2 className="font-display text-heading-md">{t("references.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("references.lead")}</p>

      {props.references.length > 0 ? (
        <ul className="space-y-2">
          {props.references.map((reference) => (
            <li
              key={reference.id}
              className="animate-rise flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-body-sm"
            >
              <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {reference.name}
            </li>
          ))}
        </ul>
      ) : null}

      <form action={action} className="space-y-3 rounded-lg border border-border p-4">
        <input type="hidden" name="applicationId" value={props.draft.id} />
        <Field label={t("references.name")} name="name" required />
        <Field label={t("references.phone")} name="phone" type="tel" required />
        <div className="space-y-1.5">
          <Label htmlFor="relationship">{t("references.relationship")}</Label>
          <select
            id="relationship"
            name="relationship"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-body-md"
          >
            {(["employer", "customer", "colleague", "other"] as const).map(
              (option) => (
                <option key={option} value={option}>
                  {t(`references.${option}` as "references.employer")}
                </option>
              ),
            )}
          </select>
        </div>
        <Problem error={state && !state.ok ? state.error : null} />
        <Submit label={t("references.add")} busy={t("saving")} />
      </form>

      {props.references.length < 2 ? (
        <p className="text-body-sm text-muted-foreground">
          {t("references.needTwo")}
        </p>
      ) : null}

      <Button
        type="button"
        className="btn-tactile"
        disabled={props.references.length < 2}
        onClick={props.onDone}
      >
        {t("next")}
      </Button>
    </div>
  );
}

function ReviewStep(props: ApplyFlowProps & { onEdit: (step: number) => void }) {
  const t = useTranslations("join.apply");
  const [state, action] = useFormState<ApplyResult | null, FormData>(
    props.submitAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={props.draft.id} />
      <h2 className="font-display text-heading-md">{t("review.title")}</h2>
      <p className="text-body-md text-muted-foreground">{t("review.lead")}</p>

      <dl className="space-y-2 rounded-lg border border-border p-4 text-body-sm">
        <Row label={t("details.fullName")} value={props.draft.fullName} onEdit={() => props.onEdit(2)} />
        <Row label={t("trades.title")} value={props.draft.trades.join(", ")} onEdit={() => props.onEdit(3)} />
        <Row label={t("areas.title")} value={props.draft.serviceAreas.join(", ")} onEdit={() => props.onEdit(4)} />
        <Row label={t("payout.title")} value={props.draft.payoutAccount} onEdit={() => props.onEdit(6)} />
        <Row
          label={t("references.title")}
          value={t("references.added", { count: String(props.references.length) })}
          onEdit={() => props.onEdit(7)}
        />
      </dl>

      {props.missing.length > 0 ? (
        <div className="animate-rise rounded-lg border border-warning/40 bg-warning/5 p-4">
          <p className="text-body-sm font-medium">{t("review.missingHeading")}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {t("documents.missing", { list: props.missing.join(", ") })}
          </p>
        </div>
      ) : null}

      <p className="text-caption text-muted-foreground">{t("review.afterSubmit")}</p>

      <Problem error={state && !state.ok ? state.error : null} />
      {props.missing.length > 0 ? (
        <p className="text-body-sm text-muted-foreground">
          {t("review.cannotSubmit")}
        </p>
      ) : (
        <Submit label={t("review.submit")} busy={t("review.submitting")} />
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function Field(props: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | null;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
      />
      {props.hint ? (
        <p className="text-caption text-muted-foreground">{props.hint}</p>
      ) : null}
    </div>
  );
}

function Row(props: {
  label: string;
  value: string | null;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="flex items-baseline gap-2 text-right">
        <span>{props.value || "—"}</span>
        <button
          type="button"
          onClick={props.onEdit}
          className="text-caption underline underline-offset-2 hover:text-foreground"
        >
          ✎
        </button>
      </dd>
    </div>
  );
}
