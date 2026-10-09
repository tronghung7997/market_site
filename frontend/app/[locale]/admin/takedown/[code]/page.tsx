import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AdminTakedownDetail } from "@/features/admin-takedown";

/** /admin/takedown/TD-XXXXXXXX — one request in full. */
export default async function AdminTakedownRequestPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-card" />}>
      <AdminTakedownDetail code={decodeURIComponent(code)} />
    </Suspense>
  );
}
