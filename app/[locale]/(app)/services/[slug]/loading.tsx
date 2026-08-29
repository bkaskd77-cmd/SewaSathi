import { CategoryPageSkeleton } from "@/components/services/skeletons";
import { ProviderListSkeleton } from "@/components/services/provider-list";

/**
 * The list already has its own Suspense boundary for filter changes. This is
 * the other case: arriving at the page cold, where the header and the filter
 * bar are waiting on the category read too.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <CategoryPageSkeleton />
      <ProviderListSkeleton />
    </div>
  );
}
