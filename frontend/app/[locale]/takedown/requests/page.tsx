import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { TakedownList } from "@/features/takedown";

/* Tab and search live in the URL; `useSearchParams` needs a Suspense boundary. */
export default function TakedownRequestsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[420px] rounded-card" />}>
      <TakedownList />
    </Suspense>
  );
}
