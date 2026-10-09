"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ConfigChangeRequest, ConfigSaved, ConfigSectionKey } from "@/lib/types";
import { useToast } from "@/components/toast";
import { isQueued, reasonOk } from "./model";

/** Props a settings save bar needs to collect the maker's reason (structural,
 *  so the save bar does not depend on this feature). */
export interface ApprovalFooterState {
  required: boolean;
  needsReason: boolean;
  reason: string;
  onReason: (value: string) => void;
  blocked: boolean;
}

// Queries that show a section's live values: refreshed once a change is approved.
const SECTION_QUERIES: Partial<Record<ConfigSectionKey, readonly (readonly unknown[])[]>> = {
  fee_config: [queryKeys.adminFeeConfig(), queryKeys.feeConfig()],
  site_status: [queryKeys.adminSiteStatus(), queryKeys.siteStatus()],
  affiliate_config: [queryKeys.adminAffiliateConfig()],
  auth_config: [queryKeys.adminAuthConfig()],
  seller_config: [queryKeys.adminSellerConfig()],
  seller_tier_config: [queryKeys.adminSellerTierConfig()],
  seller_trust_config: [["admin-seller-trust-config"], ["admin-seller-tier-review"]],
  buyer_tier_config: [["admin-buyer-tier-config"]],
};

/** Invalidate everything that shows pending settings changes (and, after a
 *  decision, the live values of that section). */
export function useRefreshConfigChanges() {
  const queryClient = useQueryClient();
  return (section?: string) => {
    for (const key of SECTION_QUERIES[section as ConfigSectionKey] ?? []) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminConfigChanges() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.actionItemsFor("admin") });
    void queryClient.invalidateQueries({ queryKey: ["admin", "notification-feed"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "logs"] });
  };
}

/**
 * One settings section under two-step approval: its pending request (if any),
 * the maker's reason, and how to read a save response.
 */
export function useConfigApproval(section: ConfigSectionKey) {
  const t = useTranslations("adminConfigApproval");
  const toast = useToast();
  const refresh = useRefreshConfigChanges();
  const query = useQuery({
    queryKey: queryKeys.adminConfigChanges({ state: "pending", section }),
    queryFn: () => api.adminConfigChanges({ state: "pending", section, limit: 1 }),
    staleTime: 15_000,
  });
  const [reason, setReason] = useState("");
  // Until the first answer, assume approval is on: the reason field shows and
  // nothing is sent without one.
  const required = query.data?.approval_required ?? true;
  const pending: ConfigChangeRequest | null = query.data?.items[0] ?? null;

  /** Announce a save and return the config to show (queued saves return the
   *  section as it is now, i.e. without the pending change). `savedMessage`
   *  null = the caller announces (one toast for a save bar that saves two sections). */
  function settle<T, C>(result: ConfigSaved<T, C>, savedMessage: string | null): { queued: boolean; config: T | C } {
    refresh();
    setReason("");
    if (isQueued(result)) {
      if (savedMessage !== null) toast.success(t("submitted"));
      return { queued: true, config: result.config };
    }
    if (savedMessage !== null) toast.success(savedMessage);
    return { queued: false, config: result };
  }

  /** Save-bar state; `gatedDirty` = the draft changes something that needs approval. */
  function footer(gatedDirty = true): ApprovalFooterState {
    return {
      required,
      needsReason: required && gatedDirty,
      reason,
      onReason: setReason,
      blocked: required && gatedDirty && pending !== null,
    };
  }

  /** Reason to send, or undefined when no approval applies. */
  const reasonToSend = required ? reason.trim() : undefined;

  return {
    required, pending, loading: query.isPending, reason, setReason,
    reasonReady: !required || reasonOk(reason), reasonToSend, settle, footer, refresh,
  };
}
