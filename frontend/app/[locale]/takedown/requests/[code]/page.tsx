import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { TakedownDetail } from "@/features/takedown";

/** /takedown/requests/TD-XXXXXXXX — one link request. */
export default async function TakedownRequestPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-[360px] rounded-card" />}>
      <TakedownDetail code={decodeURIComponent(code)} />
    </Suspense>
  );
}
