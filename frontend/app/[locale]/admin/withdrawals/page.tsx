import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { AdminWithdrawalsConsole } from "@/features/admin-withdrawals";

export default function AdminWithdrawalsPage() {
  return (
    <Suspense fallback={<Spinner label="Đang tải yêu cầu rút tiền…" />}>
      <AdminWithdrawalsConsole />
    </Suspense>
  );
}
