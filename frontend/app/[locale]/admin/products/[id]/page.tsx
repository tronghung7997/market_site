"use client";

import { useParams } from "next/navigation";
import { AdminProductEditor } from "@/features/admin-products";

export default function AdminProductPage() {
  const { id } = useParams<{ id: string }>();
  return <AdminProductEditor productId={Number(id)} />;
}
