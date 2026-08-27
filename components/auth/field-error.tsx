import { cn } from "@/lib/utils";

/**
 * Error slot with reserved height.
 *
 * Always occupies its space whether or not there is a message, so the button
 * underneath does not jump the moment validation fails — on a phone that
 * shift is how people end up tapping the wrong thing.
 *
 * `lines` is the height to reserve. One line is not always enough: at 390px a
 * sentence like "That's a landline. We can only text a mobile." wraps, and
 * reserving a single line still moved the submit button by 8px.
 */
export function FieldError({
  id,
  message,
  lines = 2,
  className,
}: {
  id: string;
  message?: string | null;
  lines?: 1 | 2;
  className?: string;
}) {
  return (
    <p
      id={id}
      role={message ? "alert" : undefined}
      className={cn(
        "text-caption text-destructive-ink",
        lines === 2 ? "min-h-[2.5rem]" : "min-h-[1.25rem]",
        className,
      )}
    >
      {message ?? " "}
    </p>
  );
}
