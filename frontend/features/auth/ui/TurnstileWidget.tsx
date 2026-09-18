"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = SCRIPT_SRC;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { scriptPromise = null; reject(new Error("turnstile script failed")); };
      document.head.appendChild(el);
    });
  }
  return scriptPromise;
}

export function usePublicAuthConfig() {
  return useQuery({ queryKey: ["public-auth-config"], queryFn: api.publicAuthConfig, staleTime: 5 * 60_000 });
}

/**
 * Cloudflare Turnstile challenge. Renders nothing when the admin has not
 * configured a site key (then the backend does not require a token either).
 * `onToken(null)` fires when the token expires so the form can disable submit.
 */
export function TurnstileWidget({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const locale = useLocale();
  const { data } = usePublicAuthConfig();
  const siteKey = data?.turnstile_site_key || "";
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey || !host.current) return;
    let cancelled = false;
    const el = host.current;
    loadScript().then(() => {
      if (cancelled || !window.turnstile || !el) return;
      widgetId.current = window.turnstile.render(el, {
        sitekey: siteKey,
        language: locale,
        theme: "light",
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    }).catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
      }
      widgetId.current = null;
    };
  }, [siteKey, locale, resetKey]);

  if (!siteKey) return null;
  return <div ref={host} className="min-h-[65px]" />;
}

/** True once the config is known and a challenge token is needed before submit. */
export function useCaptchaGate(token: string | null): { required: boolean; ready: boolean } {
  const { data, isPending } = usePublicAuthConfig();
  const required = Boolean(data?.turnstile_site_key);
  return { required, ready: isPending ? false : !required || Boolean(token) };
}
