import type { ReactNode } from "react";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { AdminAuthFrame } from "@/features/admin-console";

export const metadata = PRIVATE_ROBOTS;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminAuthFrame>{children}</AdminAuthFrame>;
}
