"use client";

import { Suspense } from "react";
import { SecurityPage } from "@/features/auth";
import { Spinner } from "@/components/ui";

export default function AccountSecurityPage() {
  return (
    <Suspense fallback={<div className="grid flex-1 place-items-center py-24"><Spinner /></div>}>
      <SecurityPage />
    </Suspense>
  );
}
