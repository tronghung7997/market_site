import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "wallet");
}

export default function WalletLayout({ children }: { children: ReactNode }) {
  return children;
}
