import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "messages");
}

export default function MessagesLayout({ children }: { children: ReactNode }) {
  return children;
}
