"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { setCookie } from "@/lib/utils";

export default function ReferralCapture() {
  const searchParams = useSearchParams();
  const firedRef = useRef(false);

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref || firedRef.current) return;
    firedRef.current = true;
    setCookie("aff_ref", ref, 365);
    api.affiliateClick(ref).catch(() => {});
  }, [searchParams]);

  return null;
}
