"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminShell from "@/components/admin/AdminShell";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { account, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!account || !account.roles.includes("admin"))) {
      router.push("/login");
    }
  }, [account, loading, router]);

  if (loading) return <div className="py-20"><Spinner /></div>;
  if (!account || !account.roles.includes("admin")) return null;

  return (
    <TooltipProvider>
      <AdminShell>{children}</AdminShell>
    </TooltipProvider>
  );
}
