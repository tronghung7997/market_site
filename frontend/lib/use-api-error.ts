"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { ApiError } from "@/lib/api";

/** Localizes coded API errors while preserving the server's string detail as a
 * compatibility fallback for endpoints that have not adopted error codes. */
export function useApiErrorMessage() {
  const t = useTranslations("errors");
  return useCallback((error: unknown, fallback?: string) => {
    if (error instanceof ApiError && error.errorCode) {
      try { return t(error.errorCode, error.params as Record<string, string | number | Date>); } catch { /* unknown code */ }
    }
    return error instanceof Error ? error.message : fallback ?? t("UNKNOWN");
  }, [t]);
}
