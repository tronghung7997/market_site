import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AdminTakedownConsole } from "@/features/admin-takedown";

/* Filters, search and paging live in the URL; `useSearchParams` needs a Suspense boundary. */
export default function AdminTakedownPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-card" />}>
      <AdminTakedownConsole />
    </Suspense>
  );
}
