import type { Metadata } from "next";
import { SiteAuditWorkbench } from "@/features/site-audit";

export const metadata: Metadata = {
  title: "Audit giao diện",
  robots: { index: false, follow: false },
};

export default function AdminSiteAuditPage() {
  return <SiteAuditWorkbench />;
}
