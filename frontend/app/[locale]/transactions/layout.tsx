import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "transactions");
}

export default function TransactionsLayout({ children }: { children: ReactNode }) {
  return children;
}
