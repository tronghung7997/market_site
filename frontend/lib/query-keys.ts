import type { HelpdeskRole } from "./types";

/**
 * Centralized query keys to avoid magic strings
 */
export const queryKeys = {
  chat: () => ["chat"] as const,
  chatList: () => ["chat", "list"] as const,
  chatDetail: (id: string) => ["chat", "detail", id] as const,
  helpdesk: (role: HelpdeskRole) => ["chat", "helpdesk", role] as const,
  productQuestions: (productId: number, page: number) => ["product-questions", productId, page] as const,
  myProductQuestions: (productId: number) => ["product-questions", productId, "mine"] as const,
  sellerQuestions: (status: string, page: number) => ["seller-questions", status, page] as const,
  // Orders
  orders: (filters?: Record<string, unknown> | null, accountId?: number | null) =>
    accountId == null
      ? (filters == null ? ["orders"] as const : ["orders", filters] as const)
      : ["orders", accountId, filters ?? null] as const,
  /** Everything the buyer console caches for one account (lists + by-ref detail). */
  ordersScope: (accountId: number | null | undefined) => ["orders", accountId ?? null] as const,
  /** One order fetched by code/legacy id for a deep link that is not on the current page. */
  orderByRef: (ref: string, accountId?: number | null) => ["orders", accountId ?? null, "detail", ref] as const,
  orderDetail: (id: number) => ["order", id] as const,
  /** Delivered lines of one order (paged); `revision` refetches after a dispute change. */
  orderLines: (orderId: string | number, revision = 0) => ["order-lines", String(orderId), revision] as const,
  orderStats: (accountId?: number | null) =>
    accountId == null ? ["order-stats"] as const : ["order-stats", accountId] as const,

  // Buyer proxy console — prefix ["proxies", accountId] covers lines + tags.
  proxiesScope: (accountId: number | null | undefined) => ["proxies", accountId ?? null] as const,
  proxyLines: (params: Record<string, unknown>, accountId: number | null | undefined) =>
    ["proxies", accountId ?? null, "lines", params] as const,
  proxyTags: (accountId: number | null | undefined) => ["proxies", accountId ?? null, "tags"] as const,
  proxyIpChanges: (accountId: number | null | undefined, lineId: string) =>
    ["proxies", accountId ?? null, "ip-changes", lineId] as const,

  // Products
  products: () => ["products"] as const,
  /** Storefront category browse — one entry per list request shape. */
  categoryProducts: (opts: Record<string, unknown>) => ["products", "browse", opts] as const,
  // Storefront search — typeahead keyed by locale + normalised query.
  searchSuggest: (locale: string, q: string) => ["search", "suggest", locale, q] as const,
  categoriesTree: () => ["categories"] as const,
  adminCategories: () => ["admin", "categories"] as const,
  adminBusinessAnalytics: (params: Record<string, unknown>) => ["admin", "business-analytics", params] as const,
  adminBusinessFilterOptions: () => ["admin", "business-analytics", "filters"] as const,
  /** Public reviews of one shop (all its products), by page and star filter. */
  shopReviews: (sellerKey: string, params: { page: number; rating: number | null }) =>
    ["shop-reviews", sellerKey, params] as const,
  sellerReviews: (params?: Record<string, unknown>) =>
    params ? (["seller-reviews", params] as const) : (["seller-reviews"] as const),
  adminReviews: (params?: Record<string, unknown>) =>
    params ? (["admin-reviews", params] as const) : (["admin-reviews"] as const),
  productDetail: (id: number) => ["product", id] as const,

  // Disputes
  disputes: () => ["disputes"] as const,
  disputeDetail: (id: number) => ["dispute", id] as const,

  // Alerts
  alerts: () => ["alerts"] as const,
  actionItems: () => ["action-items"] as const,
  notifications: () => ["notifications"] as const,
  notificationCounts: () => ["notifications", "counts"] as const,
  notificationFeed: (category: string) => ["notifications", "feed", category] as const,
  actionItemsFor: (endpoint: "account" | "buyer" | "seller" | "admin") =>
    ["action-items", endpoint] as const,

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

  // Wallet (buyer) — cả cụm chung prefix ["wallet"]: invalidate một phát
  // ({ queryKey: ["wallet"] }) là số dư + giao dịch + lệnh nạp + lệnh rút
  // cùng làm mới. Đây là chìa khoá cho "mua xong số dư tự nhảy".
  wallet: () => ["wallet"] as const,
  walletBalance: () => ["wallet", "balance"] as const,
  walletTransactions: () => ["wallet", "transactions"] as const,
  walletLedger: (params: object) => ["wallet", "ledger", params] as const,
  walletDeposits: () => ["wallet", "deposits"] as const,
  walletWithdrawals: () => ["wallet", "withdrawals"] as const,
  // Standing transfer code + QR: never changes, so kept outside the ["wallet"]
  // prefix that the deposit poll invalidates.
  bankDepositAccount: () => ["bank-deposit-account"] as const,

  // Affiliate
  affiliateMe: (params?: Record<string, unknown>) => ["affiliate-me", params ?? null] as const,
  adminAffiliates: (params?: Record<string, unknown>) => ["admin-affiliates", params ?? null] as const,
  adminAffiliateDetail: (id: number, params?: Record<string, unknown>) =>
    ["admin-affiliate", id, params ?? null] as const,

  // Seller overview
  sellerDashboard: (params: Record<string, unknown>) => ["seller-dashboard", params] as const,

  // Seller orders console — prefix ["seller-orders"] invalidates list + detail.
  sellerOrders: (params?: Record<string, unknown> | null) =>
    params == null ? ["seller-orders"] as const : ["seller-orders", "list", params] as const,
  sellerOrderDetail: (id: string | number) => ["seller-orders", "detail", String(id)] as const,
  sellerDispute: (orderId: string | number) => ["seller-orders", "dispute", String(orderId)] as const,
  sellerOrderResources: (orderId: string | number) => ["seller-orders", "resources", String(orderId)] as const,

  // Seller products console
  // Seller inventory console — prefix ["seller-inventory"] invalidates every view.
  sellerInventory: (params?: Record<string, unknown> | null) =>
    params == null ? ["seller-inventory"] as const : ["seller-inventory", "packages", params] as const,
  // Keyed by the route ref (public key, or a legacy id) — one cache entry per URL.
  sellerInventoryPackage: (variantRef: string) => ["seller-inventory", "package", variantRef] as const,
  sellerInventoryResources: (variantId: number, params: Record<string, unknown>) =>
    ["seller-inventory", "resources", variantId, params] as const,
  sellerInventoryAll: () => ["seller-inventory", "all-packages"] as const,
  sellerInventoryReport: (params: Record<string, unknown>) => ["seller-inventory", "report", params] as const,
  sellerInventoryExportPreview: (params: Record<string, unknown>) => ["seller-inventory", "export-preview", params] as const,
  adminSellerConfig: () => ["admin-seller-config"] as const,
  adminSellerTierConfig: () => ["admin-seller-tier-config"] as const,
  adminAnalyticsConfig: () => ["admin-analytics-config"] as const,
  adminAffiliateConfig: () => ["admin-affiliate-config"] as const,
  adminContentFilter: () => ["admin-content-filter"] as const,
  adminAuthConfig: () => ["admin-auth-config"] as const,
  siteStatus: () => ["site-status"] as const,
  adminSiteStatus: () => ["admin-site-status"] as const,
  adminLedgerRuns: () => ["admin-ledger-runs"] as const,
  adminFeeConfig: () => ["admin-fee-config"] as const,
  feeConfig: () => ["fee-config"] as const,
  adminLoginEvents: (accountId: number) => ["admin-login-events", accountId] as const,
  adminAiConfig: () => ["admin-ai-config"] as const,
  adminAiPrompts: () => ["admin-ai-prompts"] as const,
  adminAiUsage: (days: number) => ["admin-ai-usage", days] as const,
  trustSeedBatches: (productId?: number) => ["trust-seed-batches", productId ?? null] as const,
  trustSeedSummary: (productId: number) => ["trust-seed-summary", productId] as const,
  sellerProducts: (params?: Record<string, unknown> | null) =>
    params == null ? ["seller-products"] as const : ["seller-products", "list", params] as const,
} as const;
