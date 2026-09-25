"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { allCells, type CostMap, type PriceGrid } from "./model";

/** Nguồn có bảng giá vốn theo gói (`AdapterSpec.proxy_source` phía backend). */
const COST_SOURCES = new Set(["dproxy", "topproxy"]);
/** Giới hạn của `/proxy-plans/quote` (ProxyPlanQuoteRequest). */
const QUOTE_LIMIT = 200;

export const pricingGridKeys = {
  meta: (productId: number) => ["pricing-grid", productId, "meta"] as const,
  quote: (productId: number, signature: string) => ["pricing-grid", productId, "quote", signature] as const,
};

export interface GridCosts {
  /** Nguồn này có giá vốn theo gói không (DProxy/TopProxy). */
  available: boolean;
  loading: boolean;
  error: boolean;
  costs: CostMap;
  minMarginPct: number;
  /** Bảng có nhiều ô hơn giới hạn quote — phần dư không có giá vốn. */
  truncated: boolean;
  retry: () => void;
}

/** Giá vốn + ô nào nguồn mua được, cho mọi ô của bảng (kể cả ô chưa bán).
 *  Chỉ quote lại khi trục đổi; sửa giá không gọi mạng — lãi tính tại chỗ. */
export function useGridCosts(productId: number, adapter: string | null | undefined, grid: PriceGrid): GridCosts {
  const available = Boolean(adapter && COST_SOURCES.has(adapter));
  const cells = allCells(grid);
  const quoted = cells.slice(0, QUOTE_LIMIT);
  const signature = quoted.map((c) => c.key).join(",");

  const meta = useQuery({
    queryKey: pricingGridKeys.meta(productId),
    queryFn: () => api.productProxyPlans(productId),
    enabled: available,
    staleTime: 60_000,
  });

  const quote = useQuery({
    queryKey: pricingGridKeys.quote(productId, signature),
    queryFn: () => api.quoteProductProxyPlans(productId, quoted.map(({ type, network, days }) => ({ type, network, days }))),
    enabled: available && quoted.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const costs: CostMap = {};
  for (const row of quote.data ?? []) costs[row.plan_key] = { cost: row.cost_price, supported: row.supported };

  return {
    available,
    loading: available && (meta.isPending || (quoted.length > 0 && quote.isPending)),
    error: available && (meta.isError || quote.isError),
    costs,
    minMarginPct: meta.data?.min_margin_pct ?? 0,
    truncated: cells.length > QUOTE_LIMIT,
    retry: () => { void meta.refetch(); void quote.refetch(); },
  };
}
