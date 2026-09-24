"use client";

import { use } from "react";
import { OrderPage } from "@/features/admin-order";

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <OrderPage id={Number(id)} />;
}
