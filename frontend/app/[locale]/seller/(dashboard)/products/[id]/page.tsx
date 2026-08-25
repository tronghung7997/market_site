"use client";

import { useParams } from "next/navigation";
import { SellerProductEditor } from "@/features/seller-workbench";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  return <SellerProductEditor productId={Number(id)} />;
}
