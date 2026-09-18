"use client";

import { Suspense } from "react";
import { RegisterForm } from "@/features/auth";
import { Spinner } from "@/components/ui";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="grid flex-1 place-items-center py-24"><Spinner /></div>}>
      <RegisterForm />
    </Suspense>
  );
}
