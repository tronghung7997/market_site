"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { queryKeys } from "@/lib/query-keys";
import type {
  BulkResourceActionInput,
  InventoryExportParams,
  InventoryPackage,
  InventoryReportParams,
  SellerResourceQuery,
} from "@/lib/types";
import {
  RESOURCE_LINE_MAX_LENGTH,
  runInRestockBatches,
  runRestockBatches,
  summarizeRestockPreview,
  tooLongRestockLines,
  type RestockProgress,
} from "./logic";
import { PACKAGE_PAGE_SIZE, type InventoryFilters } from "./model";

export function useInventoryPackages(filters: InventoryFilters) {
  const params = {
    page: filters.page,
    perPage: PACKAGE_PAGE_SIZE,
    search: filters.search.trim(),
    categoryIds: filters.categoryIds,
    productStatus: filters.productStatus,
    stock: filters.tab,
    includeInactive: !filters.hideInactive,
    sort: filters.sort,
    view: filters.grouped ? ("grouped" as const) : ("flat" as const),
  };
  return useQuery({
    queryKey: queryKeys.sellerInventory({ ...params }),
    queryFn: () => api.inventoryPackages(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useInventoryPackage(variantRef: string | null) {
  return useQuery({
    queryKey: queryKeys.sellerInventoryPackage(variantRef ?? ""),
    queryFn: () => api.inventoryPackage(variantRef as string),
    enabled: !!variantRef,
    staleTime: 15_000,
  });
}

const ALL_PAGE = 100;
const ALL_MAX = 2_000;

/** Every managed package the seller owns (all product statuses, inactive
 *  included) — feeds the scope tree on the export page and the package
 *  switcher's cross-product search. */
export function useAllInventoryPackages(enabled = true) {
  return useQuery({
    queryKey: queryKeys.sellerInventoryAll(),
    queryFn: async () => {
      const rows: InventoryPackage[] = [];
      for (let page = 1; rows.length < ALL_MAX; page++) {
        const res = await api.inventoryPackages({
          page, perPage: ALL_PAGE, view: "flat", productStatus: "all", includeInactive: true, sort: "title",
        });
        rows.push(...res.items);
        if (res.items.length < ALL_PAGE || rows.length >= res.total) return { items: rows, lowStockThreshold: res.low_stock_threshold };
      }
      return { items: rows, lowStockThreshold: 20 };
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useInventoryResources(variantId: number, query: SellerResourceQuery) {
  return useQuery({
    queryKey: queryKeys.sellerInventoryResources(variantId, { ...query }),
    queryFn: () => api.sellerVariantResources(variantId, query),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}

export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return (variantId?: number) => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerInventory() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerProducts() }),
    queryClient.invalidateQueries({ queryKey: ["seller-dashboard"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.actionItems() }),
    // Package pages are cached by route ref (key or legacy id), so refresh them all.
    variantId ? queryClient.invalidateQueries({ queryKey: ["seller-inventory", "package"] }) : Promise.resolve(),
  ]);
}

export function useBulkPackageStatus() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ ids, isActive }: { ids: number[]; isActive: boolean }) => api.bulkPackageStatus(ids, isActive),
    onSettled: () => void invalidate(),
  });
}

/**
 * Bulk add in request-sized batches (see `runRestockBatches`). Over-long lines
 * are rejected up front, before any batch is saved, with the same coded error
 * the backend would return — but with line numbers from the whole upload.
 */
export async function addResourcesInBatches(
  variantId: number,
  items: readonly string[],
  onProgress?: (progress: RestockProgress) => void,
) {
  const tooLong = tooLongRestockLines(items);
  if (tooLong.length > 0) {
    throw new ApiError(
      422,
      `Line ${tooLong[0]} is longer than ${RESOURCE_LINE_MAX_LENGTH} characters`,
      "RESOURCE_TOO_LONG",
      { line: tooLong[0], max: RESOURCE_LINE_MAX_LENGTH },
    );
  }
  return runRestockBatches(items, (batch) => api.addResources(variantId, batch), onProgress);
}

export function useRestock(variantId: number) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ items, onProgress }: { items: string[]; onProgress?: (progress: RestockProgress) => void }) =>
      addResourcesInBatches(variantId, items, onProgress),
    // Also after a partial failure: earlier batches are already in stock.
    onSettled: () => void invalidate(variantId),
  });
}

export function useRestockPreview(variantId: number) {
  return useMutation({
    mutationFn: async (items: string[]) => {
      const batches = await runInRestockBatches([...new Set(items)], (batch) => api.restockPreview(variantId, batch));
      return summarizeRestockPreview(items, batches);
    },
  });
}

export function useBulkResourceAction(variantId: number) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: BulkResourceActionInput) => api.bulkResourceAction(variantId, input),
    onSettled: () => void invalidate(variantId),
  });
}

export function useResourceMutations(variantId: number) {
  const invalidate = useInvalidateInventory();
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: string }) => api.updateResource(id, data),
    onSettled: () => void invalidate(variantId),
  });
  const restockOne = useMutation({
    mutationFn: ({ id, data }: { id: number; data: string }) => api.restockResource(id, data),
    onSettled: () => void invalidate(variantId),
  });
  const archive = useMutation({
    mutationFn: (id: number) => api.archiveResource(id),
    onSettled: () => void invalidate(variantId),
  });
  const restore = useMutation({
    mutationFn: (id: number) => api.restoreResource(id),
    onSettled: () => void invalidate(variantId),
  });
  return { update, restockOne, archive, restore };
}

export function useInventoryReport(params: InventoryReportParams | null) {
  return useQuery({
    queryKey: queryKeys.sellerInventoryReport({ ...(params ?? {}) }),
    queryFn: () => api.inventoryReport(params as InventoryReportParams),
    enabled: params != null,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useInventoryExportPreview(params: InventoryExportParams | null, limit = 20) {
  return useQuery({
    queryKey: queryKeys.sellerInventoryExportPreview({ ...(params ?? {}), limit }),
    queryFn: () => api.inventoryExportPreview(params as InventoryExportParams, limit),
    enabled: params != null,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}
