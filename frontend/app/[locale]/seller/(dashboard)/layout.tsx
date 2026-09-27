import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";
import SellerDashboardFrame from "./SellerDashboardFrame";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "seller");
}

export default function SellerDashboardLayout({ children }: { children: ReactNode }) {
  return <SellerDashboardFrame>{children}</SellerDashboardFrame>;
}
