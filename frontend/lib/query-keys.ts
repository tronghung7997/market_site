/**
 * Centralized query keys to avoid magic strings
 */
export const queryKeys = {
  chat: () => ["chat"] as const,
  chatList: () => ["chat", "list"] as const,
  chatDetail: (id: string) => ["chat", "detail", id] as const,
  adminSupportList: () => ["chat", "admin-support"] as const,
  // Orders
  orders: (filters?: Record<string, unknown> | null, accountId?: number | null) =>
    accountId == null
      ? (filters == null ? ["orders"] as const : ["orders", filters] as const)
      : ["orders", accountId, filters ?? null] as const,
  orderDetail: (id: number) => ["order", id] as const,
  orderStats: (accountId?: number | null) =>
    accountId == null ? ["order-stats"] as const : ["order-stats", accountId] as const,

  // Products
  products: () => ["products"] as const,
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
  walletDeposits: () => ["wallet", "deposits"] as const,
  walletWithdrawals: () => ["wallet", "withdrawals"] as const,

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
  sellerOrderDetail: (id: number) => ["seller-orders", "detail", id] as const,
  sellerDispute: (orderId: number) => ["seller-orders", "dispute", orderId] as const,
  sellerOrderResources: (orderId: number) => ["seller-orders", "resources", orderId] as const,

  // Seller products console
  // Seller inventory console — prefix ["seller-inventory"] invalidates every view.
  sellerInventory: (params?: Record<string, unknown> | null) =>
    params == null ? ["seller-inventory"] as const : ["seller-inventory", "packages", params] as const,
  sellerInventoryPackage: (variantId: number) => ["seller-inventory", "package", variantId] as const,
  sellerInventoryResources: (variantId: number, params: Record<string, unknown>) =>
    ["seller-inventory", "resources", variantId, params] as const,
  sellerInventoryAll: () => ["seller-inventory", "all-packages"] as const,
  sellerInventoryReport: (params: Record<string, unknown>) => ["seller-inventory", "report", params] as const,
  sellerInventoryExportPreview: (params: Record<string, unknown>) => ["seller-inventory", "export-preview", params] as const,
  adminSellerConfig: () => ["admin-seller-config"] as const,
  sellerProducts: (params?: Record<string, unknown> | null) =>
    params == null ? ["seller-products"] as const : ["seller-products", "list", params] as const,
} as const;
