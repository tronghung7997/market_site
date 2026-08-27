"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { ReactNode } from "react";
import { api } from "./api";
import { sessionExpiryRedirect } from "./session-expiry";
import type { Account } from "./types";

interface AuthState {
  account: Account | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, referralCode?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      setAccount(await api.me());
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleExpired() {
      setAccount(null);
      const redirectTo = sessionExpiryRedirect(pathname);
      if (!redirectTo) return;
      // Kèm `next` để đăng nhập lại đưa buyer về ĐÚNG chỗ đang dở (trang sản
      // phẩm, trang đơn…), thay vì thả về trang chủ và bắt tìm lại từ đầu —
      // form login đã đọc sẵn tham số này.
      router.push(redirectTo);
    }
    window.addEventListener("auth:session-expired", handleExpired);
    return () => window.removeEventListener("auth:session-expired", handleExpired);
  }, [pathname, router]);

  const login = async (email: string, password: string) => {
    await api.login(email, password);
    await refresh();
  };

  const adminLogin = async (email: string, password: string) => {
    await api.adminLogin(email, password);
    await refresh();
  };

  const register = async (email: string, password: string, referralCode?: string) => {
    await api.register(email, password, referralCode);
    await login(email, password);
  };

  const logout = () => {
    void api.logout();
    setAccount(null);
  };

  return (
    <AuthContext.Provider value={{ account, loading, login, adminLogin, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
