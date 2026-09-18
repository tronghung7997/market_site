"use client";

import { Suspense } from "react";
import { ResetPasswordForm } from "@/features/auth";
import { Spinner } from "@/components/ui";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="grid flex-1 place-items-center py-24"><Spinner /></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
