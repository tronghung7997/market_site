/**
 * Centralized query keys to avoid magic strings
 */
export const queryKeys = {
  chat: () => ["chat"] as const,
  chatList: () => ["chat", "list"] as const,
  chatDetail: (id: string) => ["chat", "detail", id] as const,
  adminSupportList: () => ["chat", "admin-support"] as const,
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
} as const;
