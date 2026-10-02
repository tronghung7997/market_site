"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { ReactNode } from "react";
import { api } from "./api";
import { ApiError } from "./api-error";
import { getQueryClient } from "./query-client";
import { clearUserScopedStorage, identityChanged, SESSION_BROADCAST_KEY, type SessionIdentity } from "./session-identity";
import { sessionExpiryRedirect } from "./session-expiry";
import type { Account } from "./types";

interface AuthState {
  account: Account | null;
  loading: boolean;
  /** Resolves with the MFA challenge token when a TOTP code is still needed; undefined when signed in. */
  login: (email: string, password: string, captchaToken?: string) => Promise<string | undefined>;
  loginMfa: (mfaToken: string, code: string) => Promise<void>;
  adminLogin: (email: string, password: string, captchaToken?: string) => Promise<string | undefined>;
  register: (email: string, password: string, referralCode?: string, locale?: string, captchaToken?: string) => Promise<{ verificationRequired: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped whenever the signed-in identity changes; it keys the subtree so
  // every client component (and its local state) starts over for the new
  // person instead of showing what the previous one had loaded.
  const [generation, setGeneration] = useState(0);
  const identity = useRef<SessionIdentity>(undefined);
  const router = useRouter();
  const pathname = usePathname();

  const setAccount = useCallback((next: Account | null) => {
    const nextId = next?.id ?? null;
    if (identityChanged(identity.current, nextId)) {
      // Nothing cached for the previous identity may survive: queries are
      // keyed without the account, so B would otherwise get A's data.
      const queryClient = getQueryClient();
      void queryClient.cancelQueries();
      queryClient.clear();
      try { clearUserScopedStorage(window.localStorage); } catch { /* storage blocked */ }
      setGeneration((g) => g + 1);
    }
    identity.current = nextId;
    setAccountState(next);
  }, []);

  // `/me` answers can arrive out of order (one sent with the old cookie, one
  // with the new): only the latest check may set the account.
  const checkSeq = useRef(0);
  const checkSession = useCallback(async () => {
    const seq = ++checkSeq.current;
    try {
      const me = await api.me();
      if (seq === checkSeq.current) setAccount(me);
    } catch (err) {
      if (seq !== checkSeq.current) return;
      // A network blip while re-checking (tab focus, another tab's signal)
      // must not sign the person out locally; only the server saying "no
      // session" does. The very first check still resolves to signed out.
      const signedOut = err instanceof ApiError && (err.status === 401 || err.status === 403);
      if (signedOut || identity.current === undefined) setAccount(null);
    } finally {
      if (seq === checkSeq.current) setLoading(false);
    }
  }, [setAccount]);

  // Background re-checks (refused calls, tab focus, another tab's signal)
  // share the one in flight; sign-in flows call checkSession for a fresh one.
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    inflight.current ??= checkSession().finally(() => { inflight.current = null; });
    return inflight.current;
  }, [checkSession]);

  /** Tell other tabs to re-check who is signed in. */
  const broadcast = useCallback(() => {
    try { window.localStorage.setItem(SESSION_BROADCAST_KEY, String(Date.now())); } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The session cookie is shared by every tab: a sign-in/sign-out in one tab
  // must not leave another tab showing (and acting as) the old account.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SESSION_BROADCAST_KEY) void refresh();
    }
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    // The BFF refused a call made as the identity this tab still shows.
    function onChanged() { void refresh(); }
    window.addEventListener("auth:session-changed", onChanged);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("auth:session-changed", onChanged);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    function handleExpired() {
      // Already signed out here (sign-out button, another tab): the 401s of
      // pages re-rendering as a guest are expected, not an expired session.
      if (identity.current === null) return;
      checkSeq.current += 1;
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
  }, [pathname, router, setAccount]);

  const login = async (email: string, password: string, captchaToken?: string) => {
    const result = await api.login(email, password, captchaToken);
    if (result.mfa_required) return result.mfa_token;
    await checkSession();
    broadcast();
  };

  const adminLogin = async (email: string, password: string, captchaToken?: string) => {
    const result = await api.adminLogin(email, password, captchaToken);
    if (result.mfa_required) return result.mfa_token;
    await checkSession();
    broadcast();
  };

  const loginMfa = async (mfaToken: string, code: string) => {
    await api.loginMfa(mfaToken, code);
    await checkSession();
    broadcast();
  };

  const register = async (email: string, password: string, referralCode?: string, locale?: string, captchaToken?: string) => {
    // /auth/register issues the first session itself (the BFF sets the
    // cookies); a follow-up /auth/login would need a fresh captcha token.
    // With email verification required there is no session yet.
    const result = await api.register(email, password, referralCode, locale, captchaToken);
    if (result.verification_required) return { verificationRequired: true };
    await checkSession();
    broadcast();
    return { verificationRequired: false };
  };

  const logout = async () => {
    // Wait for the cookie to be revoked before wiping the cache: a refetch
    // racing a still-valid cookie would re-cache the old account's data.
    try { await api.logout(); } catch { /* signed out locally either way */ }
    checkSeq.current += 1; // a `/me` still in flight was sent with the old cookie
    setAccount(null);
    broadcast();
  };

  return (
    <AuthContext.Provider value={{ account, loading, login, loginMfa, adminLogin, register, logout, refresh }}>
      <Fragment key={generation}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
