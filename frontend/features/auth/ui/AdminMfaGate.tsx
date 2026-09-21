"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Admin console guard: when the policy requires TOTP and this admin has not
 * enabled it, every console page bounces to the security page (the backend
 * already refuses the /admin API with MFA_SETUP_REQUIRED).
 */
export function AdminMfaGate() {
  const { account, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (loading || !account?.mfa_setup_required) return;
    if (pathname?.includes("/admin/login")) return;
    router.replace("/account?tab=security&setup=2fa");
  }, [account, loading, pathname, router]);
  return null;
}
