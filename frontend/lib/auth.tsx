"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { Account } from "./types";

interface AuthState {
  account: Account | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

  const refresh = async () => {
    if (!getToken()) {
      setAccount(null);
      setLoading(false);
      return;
    }
    try {
      setAccount(await api.me());
    } catch {
      setToken(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleExpired() {
      setAccount(null);
      if (pathname === "/login") return;
      // Kèm `next` để đăng nhập lại đưa buyer về ĐÚNG chỗ đang dở (trang sản
      // phẩm, trang đơn…), thay vì thả về trang chủ và bắt tìm lại từ đầu —
      // form login đã đọc sẵn tham số này.
      router.push(`/login?expired=1&next=${encodeURIComponent(pathname)}`);
    }
    window.addEventListener("auth:session-expired", handleExpired);
    return () => window.removeEventListener("auth:session-expired", handleExpired);
  }, [pathname, router]);

  const login = async (email: string, password: string) => {
    const { access_token } = await api.login(email, password);
    setToken(access_token);
    await refresh();
  };

  const register = async (email: string, password: string, referralCode?: string) => {
    await api.register(email, password, referralCode);
    await login(email, password);
  };

  const logout = () => {
    setToken(null);
    setAccount(null);
  };

  return (
    <AuthContext.Provider value={{ account, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
