"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { uploadLimitBytes } from "@/lib/media";
import { queryKeys } from "@/lib/query-keys";

/** The admin's image upload cap (Settings › System), read from the public
 *  site status the storefront already polls, so a picker can refuse an
 *  oversized file before it is sent. Falls back to the env default. */
export function useUploadLimit(): { bytes: number; mb: number } {
  const { data } = useQuery({ queryKey: queryKeys.siteStatus(), queryFn: api.publicSiteStatus, staleTime: 30_000 });
  const bytes = uploadLimitBytes(data?.media_max_upload_mb);
  return { bytes, mb: Math.round(bytes / (1024 * 1024)) };
}
