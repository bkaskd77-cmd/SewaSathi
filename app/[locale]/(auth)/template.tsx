import { RouteTransition } from "@/components/shared/route-transition";

/** /login to /verify to /onboarding as one flow. See RouteTransition. */
export default function AuthTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteTransition>{children}</RouteTransition>;
}
