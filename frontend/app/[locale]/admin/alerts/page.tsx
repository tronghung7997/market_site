"use client";

import { Suspense } from "react";
import { AlertsInbox } from "@/features/admin-alerts";

export default function AdminAlertsPage() {
  return (
    <Suspense>
      <AlertsInbox />
    </Suspense>
  );
}
