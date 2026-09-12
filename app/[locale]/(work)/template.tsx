import { RouteTransition } from "@/components/shared/route-transition";

/**
 * Same entrance as the rest of the signed-in product.
 *
 * The chrome differs; the motion does not. A professional moving between their
 * jobs and their listing should feel the same product they book a plumber in,
 * and a second transition style would be a second thing to keep in step.
 */
export default function WorkTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteTransition>{children}</RouteTransition>;
}
