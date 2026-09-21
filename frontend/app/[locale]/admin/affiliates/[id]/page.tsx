"use client";

import { useParams } from "next/navigation";
import { AdminAffiliateDetail } from "@/features/admin-affiliates";

export default function AdminAffiliateDetailPage() {
  const params = useParams<{ id: string }>();
  return <AdminAffiliateDetail id={Number(params.id)} />;
}
