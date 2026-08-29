"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import type { ShortlistEntry } from "@/app/[locale]/(app)/book/actions";
import { BookingProgress } from "@/components/booking/progress";
import {
  StepAddress,
  type AreaGroup,
  type SavedAddress,
} from "@/components/booking/step-address";
import {
  StepProblem,
  type CategoryOption,
} from "@/components/booking/step-problem";
import { StepProvider } from "@/components/booking/step-provider";
import { StepReview, type ReviewRow } from "@/components/booking/step-review";
import { StepWhen } from "@/components/booking/step-when";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  clearDraft,
  FLOW_STEPS,
  initialState,
  loadDraft,
  saveDraft,
  stepComplete,
  type FlowState,
  type FlowStep,
} from "@/lib/booking/flow-state";
import { formatSlotInstant } from "@/lib/booking/schedule";

/**
 * The booking flow.
 *
 * One client component owns the state because the five steps are one form
 * split across five screens, not five forms. Everything it can do without the
 * network it does without the network; the only round trips are the photo
 * upload, the shortlist, and the confirm.
 *
 * The three things this file exists to get right:
 *
 * 1. **Nothing is lost.** The draft is written to sessionStorage on every
 *    change, so a refresh, a dropped connection or a trip through the login
 *    screen returns the customer to the step they were on with their input
 *    intact. This is the whole reason logged-out visitors are allowed through
 *    steps a-c at all.
 * 2. **Direction is visible.** Going back looks like going back. In a
 *    five-step form on a phone, an entrance that ignores direction loses
 *    people.
 * 3. **Confirm cannot fire twice.** A ref, not state — state updates are
 *    batched and a second tap can land inside the same tick.
 */
export function BookingFlow({
  seed,
  categories,
  savedAddresses,
  areas,
  preselectedProvider,
  signedIn,
  loginHref,
  areaLabels,
}: {
  seed: {
    category?: string | null;
    provider?: string | null;
    urgency?: string | null;
    description?: string | null;
    triageLogId?: string | null;
  };
  categories: CategoryOption[];
  savedAddresses: SavedAddress[];
  areas: AreaGroup[];
  preselectedProvider: ShortlistEntry | null;
  signedIn: boolean;
  /** Where to send a signed-out customer at the provider step. */
  loginHref: string;
  /** Ward key to its label. A map rather than a formatter, because a function
   * cannot cross the server/client boundary. */
  areaLabels: Record<string, string>;
}) {
  const t = useTranslations("booking.flow");
  const router = useRouter();

  const [state, setState] = React.useState<FlowState>(() =>
    initialState({
      ...seed,
      // A saved default address means the returning customer starts with one
      // chosen rather than an empty form.
      provider: seed.provider,
    }),
  );
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ id: string; reference: string } | null>(
    null,
  );
  const [restored, setRestored] = React.useState(false);
  // Held outside the draft on purpose: a preview is a ~900 kB data URL and
  // sessionStorage is a few megabytes. After a refresh the photo is still
  // attached — the path survives — it just no longer shows a thumbnail, which
  // is a fair trade for not blowing the quota mid-booking.
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null);
  const submitted = React.useRef(false);

  // Restore before first paint of the flow body, so a returning customer never
  // sees step one flash past on the way to step four.
  React.useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setState(() => ({
        ...draft,
        // The URL wins over the draft for the professional: arriving from a
        // provider card means they just chose that person.
        providerId: seed.provider ?? draft.providerId,
        autoAssign: seed.provider ? false : draft.autoAssign,
      }));
    } else if (savedAddresses.length > 0) {
      setState((current) => ({ ...current, addressId: savedAddresses[0].id }));
    }
    setRestored(true);
    // Restoring once on mount is the intent; seed and addresses are static per
    // page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (restored) saveDraft(state);
  }, [state, restored]);

  const patch = React.useCallback((next: Partial<FlowState>) => {
    setState((current) => ({ ...current, ...next }));
    setErrors({});
  }, []);

  const index = FLOW_STEPS.indexOf(state.step);

  function goTo(step: FlowStep) {
    setDirection(FLOW_STEPS.indexOf(step) > index ? 1 : -1);
    setState((current) => ({ ...current, step }));
    setErrors({});
    // A five-step form on a phone scrolls; the next step must start at its top.
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  function next() {
    if (!stepComplete(state, state.step)) {
      setErrors(errorsFor(state));
      return;
    }
    // Signing in is deferred to exactly here: steps a-c are the ones a
    // stranger will fill in, and gating them at step one is where funnels die.
    if (state.step === "when" && !signedIn) {
      saveDraft(state);
      window.location.href = loginHref;
      return;
    }
    goTo(FLOW_STEPS[Math.min(index + 1, FLOW_STEPS.length - 1)]);
  }

  function back() {
    goTo(FLOW_STEPS[Math.max(index - 1, 0)]);
  }

  async function confirm() {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    setErrors({});

    try {
      const { confirmBookingAction } = await import(
        "@/app/[locale]/(app)/book/actions"
      );

      const result = await confirmBookingAction({
        booking: {
          category: state.category,
          provider: state.autoAssign ? null : state.providerId,
          urgency:
            state.timing === "emergency"
              ? "emergency"
              : state.timing === "today"
                ? "soon"
                : "routine",
          description: state.description,
          photoUrl: state.photoPath,
          scheduledFor: state.timing === "scheduled" ? state.slot : null,
          paymentMethod: state.paymentMethod,
          triageLogId: state.triageLogId,
        },
        addressId: state.addressId,
        newAddress: state.addressId
          ? null
          : {
              label: state.newAddress.label,
              area: state.newAddress.area,
              tole: state.newAddress.tole,
              landmark: state.newAddress.landmark,
              directionsNote: state.newAddress.directionsNote,
              saveForNextTime: state.newAddress.saveForNextTime,
            },
      });

      if (result.ok) {
        clearDraft();
        setDone({ id: result.id, reference: result.reference });
        // The success state resolves before the route changes, so the confirm
        // reads as finishing rather than as the page vanishing.
        setTimeout(() => router.push(`/bookings/${result.id}`), 1100);
        return;
      }

      setErrors(result.errors as Record<string, string>);
      submitted.current = false;

      // Send them back to the step that owns the problem rather than showing a
      // validation error under a confirm button that cannot fix it.
      const owner = stepForError(result.errors as Record<string, string>);
      if (owner) goTo(owner);
    } catch {
      setErrors({ form: "saveFailed" });
      submitted.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="animate-pop-in rounded-xl border border-success/30 bg-success/[0.07] p-8 text-center"
      >
        <CheckCircle2
          aria-hidden="true"
          className="mx-auto size-12 text-success-ink"
        />
        <h2 className="mt-4 font-display text-display-sm">
          {t("success.title")}
        </h2>
        <p className="mt-2 text-body-md text-muted-foreground">
          {t("success.body")}
        </p>
        <p className="mt-4 font-display text-display-sm tracking-wide tabular-nums">
          {done.reference}
        </p>
      </div>
    );
  }

  const selectedCategory = categories.find((c) => c.slug === state.category);
  const areaKey = state.addressId
    ? (savedAddresses.find((a) => a.id === state.addressId)?.areaKey ?? null)
    : state.newAddress.area || null;

  return (
    <div>
      <BookingProgress
        current={state.step}
        onJump={submitting ? undefined : goTo}
        reachable={(step) =>
          FLOW_STEPS.slice(0, FLOW_STEPS.indexOf(step)).every((earlier) =>
            stepComplete(state, earlier),
          )
        }
      />

      <div
        key={state.step}
        className={direction === 1 ? "step-forward mt-6" : "step-back mt-6"}
      >
        <h2 className="font-display text-display-sm">
          {t(`titles.${state.step}`)}
        </h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t(`leads.${state.step}`)}
        </p>

        <div className="mt-5">
          {state.step === "problem" ? (
            <StepProblem
              categories={categories}
              category={state.category}
              description={state.description}
              photoPath={state.photoPath}
              photoPreview={photoPreview}
              error={errors.description ?? errors.category}
              onChange={patch}
              onPhoto={({ path, preview }) => {
                setPhotoPreview(preview);
                patch({ photoPath: path });
              }}
            />
          ) : null}

          {state.step === "address" ? (
            <StepAddress
              saved={savedAddresses}
              areas={areas}
              addressId={state.addressId}
              draft={state.newAddress}
              errors={errors}
              onSelect={(id) => patch({ addressId: id })}
              onDraft={(next) =>
                setState((current) => ({
                  ...current,
                  newAddress: { ...current.newAddress, ...next },
                }))
              }
            />
          ) : null}

          {state.step === "when" ? (
            <StepWhen
              timing={state.timing}
              day={state.day}
              slot={state.slot}
              fromTriage={seed.urgency === "emergency"}
              error={errors.scheduledFor}
              onChange={patch}
            />
          ) : null}

          {state.step === "provider" ? (
            <StepProvider
              category={state.category}
              area={areaKey}
              urgency={state.timing === "emergency" ? "emergency" : null}
              providerId={state.providerId}
              autoAssign={state.autoAssign}
              preselected={preselectedProvider}
              onChoose={patch}
            />
          ) : null}

          {state.step === "review" ? (
            <StepReview
              rows={reviewRows({
                t,
                state,
                categories,
                savedAddresses,
                areaLabels,
              })}
              quoteLabel={selectedCategory?.quoteLabel ?? ""}
              payment={state.paymentMethod}
              error={errors.form ?? errors.provider ?? errors.category}
              onJump={goTo}
              onPayment={(method) => patch({ paymentMethod: method })}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        {index > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={back}
            disabled={submitting}
          >
            <ArrowLeft aria-hidden="true" />
            {t("back")}
          </Button>
        ) : null}

        <div className="flex-1" />

        {state.step === "review" ? (
          <Button
            type="button"
            variant="gold"
            size="lg"
            className="btn-tactile"
            onClick={() => void confirm()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                {t("confirming")}
              </>
            ) : (
              <>
                {t("confirm")}
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="gold"
            size="lg"
            className="btn-tactile"
            onClick={next}
          >
            {state.step === "when" && !signedIn ? t("continueSignIn") : t("next")}
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Which field is missing, phrased as message keys the steps understand. */
function errorsFor(state: FlowState): Record<string, string> {
  switch (state.step) {
    case "problem":
      if (!state.category) return { category: "pickCategory" };
      return { description: "describeTheProblem" };
    case "address":
      if (!state.newAddress.area) return { area: "pickArea" };
      if (state.newAddress.tole.trim().length < 2)
        return { tole: "toleTooShort" };
      return { landmark: "landmarkRequired" };
    case "when":
      return { scheduledFor: "pickSlot" };
    default:
      return {};
  }
}

/** The step that owns a server-side error, so the customer lands where they can fix it. */
function stepForError(errors: Record<string, string>): FlowStep | null {
  if (errors.description || errors.category) return "problem";
  if (errors.address) return "address";
  if (errors.scheduledFor) return "when";
  if (errors.provider) return "provider";
  return null;
}

function reviewRows({
  t,
  state,
  categories,
  savedAddresses,
  areaLabels,
}: {
  t: ReturnType<typeof useTranslations<"booking.flow">>;
  state: FlowState;
  categories: CategoryOption[];
  savedAddresses: SavedAddress[];
  areaLabels: Record<string, string>;
}): ReviewRow[] {
  const category = categories.find((c) => c.slug === state.category);
  const saved = savedAddresses.find((a) => a.id === state.addressId);

  const addressValue = saved
    ? `${saved.tole} · ${saved.areaLabel}`
    : `${state.newAddress.tole} · ${areaLabels[state.newAddress.area] ?? state.newAddress.area}`;
  const landmark = saved ? saved.landmark : state.newAddress.landmark;

  let when = t("review.asap");
  if (state.timing === "scheduled" && state.slot) {
    // Formatted in Nepal Time, not UTC. The stored instant is UTC and slicing
    // the ISO string shows a Kathmandu reader a time 5h45m off the one they
    // picked.
    when = formatSlotInstant(state.slot);
  } else if (state.timing === "emergency") {
    when = t("review.emergency");
  }

  const rows: ReviewRow[] = [
    {
      step: "problem",
      label: t("review.problem"),
      value: state.description,
      hint: category?.label ?? null,
    },
    {
      step: "address",
      label: t("review.address"),
      value: addressValue,
      hint: landmark ? t("review.landmarkHint", { landmark }) : null,
    },
    { step: "when", label: t("review.when"), value: when },
    {
      step: "provider",
      label: t("review.provider"),
      value: state.autoAssign ? t("review.autoAssigned") : t("review.chosen"),
    },
  ];

  if (state.photoPath) {
    rows.splice(1, 0, {
      step: "problem",
      label: t("review.photo"),
      value: t("review.photoAttached"),
    });
  }

  return rows;
}
