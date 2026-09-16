"use client";

import { useParams } from "next/navigation";
import { EditProductPage } from "@/features/seller-product-form";

/** `[id]` is the product's public key (legacy numeric ids still resolve). */
export default function EditProduct() {
  const { id } = useParams<{ id: string }>();
  return <EditProductPage productRef={id} />;
}
