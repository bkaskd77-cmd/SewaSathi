import { cn } from "@/lib/utils";

export function Section({
  id,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-20 py-16 sm:py-22", className)}
      {...props}
    >
      <div className="container">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  className,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <p className="text-overline uppercase text-gold-ink">{eyebrow}</p>
      <h2 className="mt-2 text-balance font-display text-display-md">
        {title}
      </h2>
      {lead ? (
        <p className="mt-3 text-pretty text-body-md text-muted-foreground">
          {lead}
        </p>
      ) : null}
    </div>
  );
}
