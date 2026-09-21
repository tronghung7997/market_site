"use client";

import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { AccountPage } from "@/features/account";

export default function AccountRoute() {
  return (
    <Suspense fallback={<div className="grid flex-1 place-items-center py-24"><Spinner /></div>}>
      <AccountPage />
    </Suspense>
  );
}
