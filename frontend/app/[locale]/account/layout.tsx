import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "account");
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
