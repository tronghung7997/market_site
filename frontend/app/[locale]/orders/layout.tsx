import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "orders");
}

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return children;
}
