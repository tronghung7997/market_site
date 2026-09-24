"use client";

import { Suspense } from "react";
import { AnalyticsDashboard } from "@/features/admin-analytics";

export default function AdminAnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsDashboard />
    </Suspense>
  );
}
