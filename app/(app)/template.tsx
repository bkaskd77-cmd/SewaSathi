import { RouteTransition } from "@/components/shared/route-transition";

/** Same entrance as the auth flow, so moving around signed in feels the same. */
export default function AppTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteTransition>{children}</RouteTransition>;
}
