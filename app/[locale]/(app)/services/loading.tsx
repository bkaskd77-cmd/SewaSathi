import { CategoryGridSkeleton } from "@/components/services/skeletons";

/** Shown while the catalogue's two queries are in flight. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <CategoryGridSkeleton />
    </div>
  );
}
