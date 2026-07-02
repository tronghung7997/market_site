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

export default function ReferralCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref) return;
    setCookie("aff_ref", ref, 365);
    if (alreadyClickedRecently(ref)) return;
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
  }, [searchParams]);

  return null;
}
