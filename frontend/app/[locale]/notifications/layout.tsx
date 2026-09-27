import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "notifications");
}

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return children;
}
