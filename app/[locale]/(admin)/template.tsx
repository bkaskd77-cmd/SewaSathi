import { RouteTransition } from "@/components/shared/route-transition";

/** The one route entrance, the same as the app and auth groups use. */
export default function AdminTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteTransition>{children}</RouteTransition>;
}
