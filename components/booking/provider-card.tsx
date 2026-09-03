import { Phone, ShieldCheck, User } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";

/**
 * Who is coming, and how to reach them.
 *
 * Deliberately a Server Component with no interactivity: the only action is a
 * `tel:` link, which needs no JavaScript at all and works on a phone that has
 * given up loading the bundle — which is exactly the phone of someone standing
 * in a hallway waiting for a plumber.
 *
 * CALLING IS THE PRIMARY ACTION AND IT IS SIZED LIKE IT. When somebody is
 * waiting, "where are you" is the only thing they want to do, and on a phone
 * it should be one thumb-sized tap, not a number to read out and retype.
 *
 * The phone arrives already filtered: `provider_contacts` has an RLS policy
 * that releases it only while a job of theirs is accepted, on the way or under
 * way. So null here means both "no number recorded" and "not yours to see",
 * and the support line is the right answer to both — which is why this
 * component does not need to know which it was.
 */
export function ProviderCard({
  name,
  photoUrl,
  phone,
  verified,
  labels,
}: {
  name: string;
  photoUrl: string | null;
  /** E.164, or null. Never rendered as text when null. */
  phone: string | null;
  verified: boolean;
  labels: {
    heading: string;
    call: string;
    callSupport: string;
    verified: string;
    noPhone: string;
    supportPhone: string;
  };
}) {
  return (
    <section className="animate-rise mt-6 rounded-xl border border-border p-4">
      <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        {labels.heading}
      </h2>

      <div className="mt-3 flex items-center gap-3">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed URL from private storage; next/image would need it allow-listed and it expires.
          <img
            src={photoUrl}
            alt=""
            className="size-12 shrink-0 rounded-full border border-border object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-muted"
          >
            <User className="size-5 text-muted-foreground" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-body-md font-semibold">{name}</p>
          {verified ? (
            <p className="mt-0.5 flex items-center gap-1 text-caption text-success-ink">
              <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
              {labels.verified}
            </p>
          ) : null}
        </div>
      </div>

      {phone ? (
        <a
          href={`tel:${phone}`}
          className={buttonVariants({ size: "lg", className: "btn-tactile mt-4 w-full" })}
        >
          <Phone aria-hidden="true" className="size-4" />
          {labels.call}
        </a>
      ) : (
        <>
          <p className="mt-4 text-caption text-muted-foreground">
            {labels.noPhone}
          </p>
          <a
            href={`tel:${labels.supportPhone}`}
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "btn-tactile mt-2 w-full",
            })}
          >
            <Phone aria-hidden="true" className="size-4" />
            {labels.callSupport}
          </a>
        </>
      )}
    </section>
  );
}
