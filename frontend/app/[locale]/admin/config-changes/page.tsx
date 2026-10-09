import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { ConfigChangesInbox } from "@/features/admin-config-approval";

export default function AdminConfigChangesPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center py-16"><Spinner /></div>}>
      <ConfigChangesInbox />
    </Suspense>
  );
}
