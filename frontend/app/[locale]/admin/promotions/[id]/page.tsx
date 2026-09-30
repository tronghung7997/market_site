"use client";

import { use } from "react";
import { PromotionPage } from "@/features/admin-promotions";

export default function AdminPromotionRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PromotionPage id={Number(id)} />;
}
