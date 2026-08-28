/* eslint-disable @next/next/no-img-element -- see the note below: the
   storage host for provider photos is not chosen yet, and next/image needs
   that host in next.config before a single photo could render. */
import { cn } from "@/lib/utils";

/**
 * A provider's face, or their initials.
 *
 * Initials are the normal case, not the error case: the seed has no photos and
 * real ones only arrive with provider onboarding, so this has to look
 * deliberate rather than broken. Brand jade, display face, same square as a
 * photo would occupy — the list does not reflow when photos start appearing.
 *
 * Plain `<img>` rather than next/image: the eventual sources are provider
 * uploads on a storage domain we have not chosen yet, and next/image would
 * need that host in the config before a single photo could render. Width and
 * height are set, so there is no layout shift either way.
 */
export function ProviderAvatar({
  name,
  photoUrl,
  size = 56,
  className,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  const shared = cn(
    "shrink-0 overflow-hidden rounded-lg object-cover",
    className,
  );

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={shared}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        shared,
        "grid place-items-center bg-primary font-display font-bold text-primary-foreground",
        size >= 56 ? "text-lg" : "text-body-sm",
      )}
    >
      {initials || "?"}
    </span>
  );
}
