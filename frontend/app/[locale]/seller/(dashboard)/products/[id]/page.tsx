"use client";

import { useParams } from "next/navigation";
import { EditProductPage } from "@/features/seller-product-form";

export default function EditProduct() {
  const { id } = useParams<{ id: string }>();
  return <EditProductPage productId={Number(id)} />;
}
