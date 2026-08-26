import type { ReactNode } from "react";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import SellerDashboardFrame from "./SellerDashboardFrame";

export const metadata = PRIVATE_ROBOTS;

export default function SellerDashboardLayout({ children }: { children: ReactNode }) {
  return <SellerDashboardFrame>{children}</SellerDashboardFrame>;
}
