/**
 * Centralized query keys to avoid magic strings
 */
export const queryKeys = {
  // Orders
  orders: (filters?: Record<string, unknown> | null) =>
    ["orders", filters ?? null] as const,
  orderDetail: (id: number) => ["order", id] as const,
  orderStats: () => ["order-stats"] as const,

  // Products
  products: () => ["products"] as const,
  productDetail: (id: number) => ["product", id] as const,

  // Disputes
  disputes: () => ["disputes"] as const,
  disputeDetail: (id: number) => ["dispute", id] as const,

  // Alerts
  alerts: () => ["alerts"] as const,

  // Providers
  providers: () => ["providers"] as const,
  providerHealth: (id: number) => ["provider-health", id] as const,
  providerProducts: (id: number) => ["provider-products", id] as const,

  // Resources
  resources: (params?: Record<string, unknown>) =>
    ["resources", params] as const,
  resourceSummary: () => ["resource-summary"] as const,

  // Tasks
  tasks: (status?: string) => ["tasks", status] as const,

  // Logs
  logs: (params?: Record<string, unknown>) => ["logs", params] as const,

  // Affiliate
  affiliateMe: (params?: Record<string, unknown>) => ["affiliate-me", params ?? null] as const,
  adminAffiliates: (params?: Record<string, unknown>) => ["admin-affiliates", params ?? null] as const,
  adminAffiliateDetail: (id: number, params?: Record<string, unknown>) =>
    ["admin-affiliate", id, params ?? null] as const,
} as const;
