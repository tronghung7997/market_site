"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError, apiErrorFromResponse } from "@/lib/api-error";
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
  contentDispositionFileName,
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
  // `variantId` kept for call sites: every inventory view shares one prefix.
  return (_variantId?: number) => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerInventory() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerProducts() }),
    queryClient.invalidateQueries({ queryKey: ["seller-dashboard"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.actionItems() }),
    // Package pages (cached by route ref), stock lists and the switcher all sit
    // under the ["seller-inventory"] prefix above; invalidating them again here
    // fired a second, duplicate package request after every restock.
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
  options: { onProgress?: (progress: RestockProgress) => void; signal?: AbortSignal } = {},
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
  return runRestockBatches(items, (batch) => api.addResources(variantId, batch), options);
}

export function useRestock(variantId: number) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ items, onProgress, signal }: { items: string[]; onProgress?: (progress: RestockProgress) => void; signal?: AbortSignal }) =>
      addResourcesInBatches(variantId, items, { onProgress, signal }),
    // Also after a partial failure or a stop: earlier batches are already in stock.
    onSettled: () => void invalidate(variantId),
  });
}

/** Server preview (stock lookups) for a whole upload, batch by batch. The
 * caller owns the signal: a newer paste aborts the older run between batches. */
export async function previewRestockInBatches(
  variantId: number,
  items: readonly string[],
  { onProgress, signal }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
) {
  const unique = [...new Set(items)];
  let done = 0;
  onProgress?.(0, unique.length);
  const batches = await runInRestockBatches(unique, (batch) => api.restockPreview(variantId, batch), {
    signal,
    onBatch: (batch) => { done += batch.length; onProgress?.(done, unique.length); },
  });
  return summarizeRestockPreview(items, batches);
}

export function useBulkResourceAction(variantId: number) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: BulkResourceActionInput) => api.bulkResourceAction(variantId, input),
    onSettled: () => void invalidate(variantId),
  });
}

/** Full content of one stock line, fetched only when the seller opens it. The
 * key sits outside the ["seller-inventory"] prefix so list refreshes never
 * re-reveal (each reveal is audited), and it is dropped once the view closes. */
export function useRevealedResource(resourceId: number) {
  return useQuery({
    queryKey: ["seller-resource-reveal", resourceId],
    queryFn: () => api.revealResource(resourceId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function revealResourceData(resourceId: number): Promise<string> {
  return api.revealResource(resourceId).then((row) => row.data);
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

/**
 * Download the goods export through the BFF with visible progress instead of a
 * bare link: bytes received are reported as they stream (the proxy drops
 * Content-Length, so there is no percentage), the seller can cancel, and a
 * failure surfaces as a coded ApiError rather than a broken download.
 */
export async function downloadInventoryExport(
  params: InventoryExportParams,
  { onProgress, signal, locale }: { onProgress?: (receivedBytes: number) => void; signal?: AbortSignal; locale?: string } = {},
): Promise<void> {
  const url = api.inventoryExportUrl(params);
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw apiErrorFromResponse(url, response.status, body, { auth: true, locale });
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(received);
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    chunks.push(buffer);
    onProgress?.(buffer.byteLength);
  }
  const blob = new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = contentDispositionFileName(response.headers.get("content-disposition")) ?? `inventory.${params.format ?? "txt"}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
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
