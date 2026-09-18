"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { getCookie, setCookie } from "@/lib/utils";

const CLICK_WINDOW_MS = 24 * 60 * 60 * 1000;

function getOrCreateVisitorId(): string {
  let vid = getCookie("aff_vid");
  if (!vid) {
    vid = crypto.randomUUID();
    setCookie("aff_vid", vid, 365);
  }
  return vid;
}

// The backend dedups per (affiliate, visitor) per 24h regardless; this
// localStorage guard just avoids firing redundant requests on refresh.
function alreadyClickedRecently(code: string): boolean {
  try {
    const at = localStorage.getItem(`aff_click_${code}`);
    return at !== null && Date.now() - Number(at) < CLICK_WINDOW_MS;
  } catch {
    return false;
  }
}

// Fallback when the config request fails; the admin value normally wins.
const DEFAULT_ATTRIBUTION_DAYS = 30;

export default function ReferralCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref) return;
    let cancelled = false;
    // Cookie lifetime is the admin's attribution window (Settings › Affiliate),
    // fetched only on a `?ref=` landing so ordinary page views pay nothing.
    setCookie("aff_ref", ref, DEFAULT_ATTRIBUTION_DAYS);
    api
      .publicAffiliateConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg.enabled) return;
        setCookie("aff_ref", ref, Math.max(1, cfg.attribution_days));
      })
      .catch(() => {});
    if (alreadyClickedRecently(ref)) return () => { cancelled = true; };
    const visitorId = getOrCreateVisitorId();
    api
      .affiliateClick(ref, visitorId)
      .then(() => {
        try {
          localStorage.setItem(`aff_click_${ref}`, String(Date.now()));
        } catch {
          // storage unavailable (private mode) — backend dedup still applies
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [searchParams]);

  return null;
}
