import type {
  Account, ActionItem, AdminDepositIntent, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, AffiliateStats, AffiliateSummary, CalculateResult, Category, ChargeUsageResult, DashboardData, DepositIntent, Dispute, PayosWebhookEventRow, AdminAccountWallet, FundOverview, AccountAdminRow, PaginatedAccounts, LogEntry, Order, OrderStats, PaginatedAffiliateSummary, PaginatedOrderResponse, PaginatedProducts, PricingField, PricingOptions, ProductDetail, AdminProductDetail, Product, ProductOperations, ProxyState, ProxyRotateResult, ProxyWhitelistResult, Review, SellerApplication, SellerProduct, SellerStats, ServiceTask, Transaction, Variant, Wallet, WithdrawRequest, Provider, ProviderHealth, Alert, Resource, ResourceSummary, ResourceSellerFacet, InventoryVariant, SellerSummary, SellerProfile, SellerApiKey, SellerApiKeyCreated,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL
  ?? (typeof window !== "undefined" ? "/api" : (process.env.API_URL ?? "http://localhost:8001"));
const TOKEN_KEY = "dx_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

console.log('[env] NEXT_PUBLIC_API_URL =', process.env.NEXT_PUBLIC_API_URL, '| API_URL =', process.env.API_URL, '| runtime =', typeof window !== "undefined" ? "client" : "server", '| BASE =', BASE);
console.log('4');
export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string>) };
  if (auth) {
    const tok = getToken();
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Không thể kết nối tới máy chủ, vui lòng kiểm tra kết nối mạng và thử lại.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) {
      setToken(null);
      if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:session-expired"));
      throw new ApiError(401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
    }
    const detail = body && (body.detail || body.message);
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Có lỗi xảy ra, vui lòng thử lại.");
  }
  return body as T;
}

export const api = {
  register: (email: string, password: string, referralCode?: string) => {
    const body: Record<string, string> = { email, password };
    if (referralCode) body.referral_code = referralCode;
    return request<Account>("/auth/register", { method: "POST", body: JSON.stringify(body) });
  },
  login: (email: string, password: string) =>
    request<{ access_token: string; token_type: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<Account>("/me", {}, true),

  categories: () => request<Category[]>("/categories"),
  createCategory: (data: Record<string, unknown>) =>
    request<Category>("/admin/categories", { method: "POST", body: JSON.stringify(data) }, true),
  updateCategory: (id: number, data: Record<string, unknown>) =>
    request<Category>(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  deleteCategory: (id: number) =>
    request<void>(`/admin/categories/${id}`, { method: "DELETE" }, true),
  // Không truyền page = backend trả TOÀN BỘ trong 1 lượt (trang chủ/hub cần đủ
  // dữ liệu để đếm tổng); categoryId lọc theo CẢ NHÁNH danh mục ngay tại server.
  products: (opts: { categoryId?: number; sellerId?: number; page?: number; perPage?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.categoryId) q.set("category_id", String(opts.categoryId));
    if (opts.sellerId) q.set("seller_id", String(opts.sellerId));
    if (opts.page) q.set("page", String(opts.page));
    if (opts.perPage) q.set("per_page", String(opts.perPage));
    const qs = q.toString();
    return request<PaginatedProducts>(`/products${qs ? `?${qs}` : ""}`);
  },
  productsBySeller: (sellerId: number) =>
    request<PaginatedProducts>(`/products?seller_id=${sellerId}`),
  product: (id: number) => request<ProductDetail>(`/products/${id}`),

  wallet: () => request<Wallet>("/wallet", {}, true),
  transactions: () => request<Transaction[]>("/wallet/transactions", {}, true),
  demoTopup: (amount: number) => request<Wallet>("/wallet/demo-topup", { method: "POST", body: JSON.stringify({ amount }) }, true),

  orders: (params: { status?: string; search?: string; date_from?: string; date_to?: string; sort?: string; page?: number; per_page?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.search) q.set("search", params.search);
    if (params.date_from) q.set("date_from", params.date_from);
    if (params.date_to) q.set("date_to", params.date_to);
    if (params.sort) q.set("sort", params.sort);
    if (params.page) q.set("page", String(params.page));
    if (params.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<PaginatedOrderResponse>(`/orders${qs ? `?${qs}` : ""}`, {}, true);
  },
  orderStats: () => request<OrderStats>("/orders/stats", {}, true),
  getOrder: (orderId: number) => request<Order>(`/orders/${orderId}`, {}, true),
  createOrder: (variantId: number, quantity: number) =>
    request<Order>("/orders", { method: "POST", body: JSON.stringify({ variant_id: variantId, quantity }) }, true),

  confirmOrder: (orderId: number) =>
    request<Order>(`/orders/${orderId}/confirm`, { method: "POST" }, true),
  openDispute: (orderId: number, reason: string, evidenceType?: string, evidence?: Record<string, string>) =>
    request<Dispute>(`/orders/${orderId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason, evidence_type: evidenceType ?? null, evidence: evidence ?? null }),
    }, true),
  orderDispute: (orderId: number) => request<Dispute>(`/orders/${orderId}/dispute`, {}, true),

  orderProxyState: (orderId: number) => request<ProxyState>(`/orders/${orderId}/proxy`, {}, true),
  rotateOrderProxy: (orderId: number) =>
    request<ProxyRotateResult>(`/orders/${orderId}/proxy/rotate`, { method: "POST" }, true),
  setOrderProxyWhitelist: (orderId: number, ips: string[]) =>
    request<ProxyWhitelistResult>(
      `/orders/${orderId}/proxy/whitelist`,
      { method: "PUT", body: JSON.stringify({ ips }) },
      true,
    ),

  sellerApply: (data: { business_name: string; description?: string; contact?: string }) =>
    request<SellerApplication>("/seller/apply", { method: "POST", body: JSON.stringify(data) }, true),
  mySellerApplication: () => request<SellerApplication | null>("/seller/applications/me", {}, true),
  adminSellerApplications: () => request<SellerApplication[]>("/admin/seller-applications", {}, true),
  adminApproveSellerApplication: (id: number) =>
    request<SellerApplication>(`/admin/seller-applications/${id}/approve`, { method: "POST" }, true),
  adminRejectSellerApplication: (id: number, reason: string) =>
    request<SellerApplication>(`/admin/seller-applications/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, true),

  sellerProducts: () => request<SellerProduct[]>("/seller/products", {}, true),
  // Như api.product() nhưng kèm cả biến thể đã tắt — trang quản lý cần thấy chúng để bật lại.
  sellerProduct: (id: number) => request<ProductDetail>(`/seller/products/${id}/detail`, {}, true),
  sellerStats: () => request<SellerStats>("/seller/stats", {}, true),
  sellerOrders: () => request<Order[]>("/seller/orders", {}, true),
  createSellerApiKey: () => request<SellerApiKeyCreated>("/seller/api-keys", { method: "POST" }, true),
  listSellerApiKeys: () => request<SellerApiKey[]>("/seller/api-keys", {}, true),
  revokeSellerApiKey: (id: number) => request<SellerApiKey>(`/seller/api-keys/${id}`, { method: "DELETE" }, true),
  createProduct: (data: Record<string, unknown>) =>
    request<Product>("/seller/products", { method: "POST", body: JSON.stringify(data) }, true),
  updateProduct: (id: number, data: Record<string, unknown>) =>
    request<Product>(`/seller/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  deleteProduct: (id: number) =>
    request<void>(`/seller/products/${id}`, { method: "DELETE" }, true),
  createVariant: (productId: number, data: Record<string, unknown>) =>
    request<Variant>(`/seller/products/${productId}/variants`, { method: "POST", body: JSON.stringify(data) }, true),
  updateVariant: (variantId: number, data: Record<string, unknown>) =>
    request<Variant>(`/seller/variants/${variantId}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  deleteVariant: (variantId: number) =>
    request<void>(`/seller/variants/${variantId}`, { method: "DELETE" }, true),
  addResources: (variantId: number, items: string[]) =>
    request<void>(`/seller/variants/${variantId}/resources`, { method: "POST", body: JSON.stringify({ items }) }, true),
  sellerVariantResources: (variantId: number) =>
    request<Resource[]>(`/seller/variants/${variantId}/resources`, {}, true),
  inventorySummary: () => request<InventoryVariant[]>("/seller/inventory/summary", {}, true),
  updateResource: (resourceId: number, data: string) =>
    request<Resource>(`/seller/resources/${resourceId}`, { method: "PATCH", body: JSON.stringify({ data }) }, true),
  deleteResource: (resourceId: number) =>
    request<void>(`/seller/resources/${resourceId}`, { method: "DELETE" }, true),
  sellerAcceptOrder: (orderId: number) =>
    request<Order>(`/seller/orders/${orderId}/accept`, { method: "POST" }, true),
  sellerDeliverOrder: (orderId: number, data: string) =>
    request<Order>(`/seller/orders/${orderId}/deliver`, { method: "POST", body: JSON.stringify({ data }) }, true),

  productOperations: (id: number) => request<ProductOperations>(`/products/${id}/operations`, {}, true),

  adminProducts: () => request<AdminProduct[]>("/admin/products", {}, true),
  // Bản duy nhất còn commission_rate — trường này đã rút khỏi GET /products{,/{id}}.
  adminProduct: (id: number) => request<AdminProductDetail>(`/admin/products/${id}`, {}, true),
  adminUpdateProduct: (id: number, data: Record<string, unknown>) =>
    request<Product>(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  adminAccounts: (params?: { search?: string; page?: number; per_page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<PaginatedAccounts>(`/admin/accounts${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminUpdateRoles: (id: number, roles: string[]) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/roles`, { method: "PATCH", body: JSON.stringify({ roles }) }, true),
  adminUpdateSellerTier: (id: number, sellerTier: string) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/tier`, { method: "PATCH", body: JSON.stringify({ seller_tier: sellerTier }) }, true),
  adminOrders: () => request<Order[]>("/admin/orders", {}, true),
  adminOrderDetail: (orderId: number) => request<AdminOrderDetail>(`/admin/orders/${orderId}`, {}, true),
  adminAlerts: () => request<Alert[]>("/admin/alerts", {}, true),
  dismissAlert: (id: number) => request<Alert>(`/admin/alerts/${id}/dismiss`, { method: "POST" }, true),
  dismissSellerAlert: (id: number) => request<Alert>(`/seller/alerts/${id}/dismiss`, { method: "POST" }, true),
  buyerActionItems: () => request<ActionItem[]>("/orders/action-items", {}, true),
  sellerActionItems: () => request<ActionItem[]>("/seller/action-items", {}, true),
  adminActionItems: () => request<ActionItem[]>("/admin/action-items", {}, true),
  adminDisputes: () => request<Dispute[]>("/admin/disputes", {}, true),
  adminDisputeDetail: (id: number) => request<AdminDisputeDetail>(`/admin/disputes/${id}`, {}, true),
  refundDispute: (id: number, adminNote: string) =>
    request<Dispute>(`/admin/disputes/${id}/refund`, { method: "POST", body: JSON.stringify({ admin_note: adminNote }) }, true),
  rejectDispute: (id: number, adminNote: string) =>
    request<Dispute>(`/admin/disputes/${id}/reject`, { method: "POST", body: JSON.stringify({ admin_note: adminNote }) }, true),
  partialRefundDispute: (id: number, adminNote: string, refundAmount: number) =>
    request<Dispute>(`/admin/disputes/${id}/partial-refund`, { method: "POST", body: JSON.stringify({ admin_note: adminNote, refund_amount: refundAmount }) }, true),
  replaceDispute: (id: number, adminNote: string) =>
    request<Dispute>(`/admin/disputes/${id}/replace`, { method: "POST", body: JSON.stringify({ admin_note: adminNote }) }, true),
  extendWarrantyDispute: (id: number, adminNote: string, extraDays: number) =>
    request<Dispute>(`/admin/disputes/${id}/extend-warranty`, { method: "POST", body: JSON.stringify({ admin_note: adminNote, extra_days: extraDays }) }, true),
  adminWithdrawals: () => request<WithdrawRequest[]>("/admin/withdrawals", {}, true),
  approveWithdrawal: (id: number) => request<WithdrawRequest>(`/admin/withdrawals/${id}/approve`, { method: "POST" }, true),
  rejectWithdrawal: (id: number) => request<WithdrawRequest>(`/admin/withdrawals/${id}/reject`, { method: "POST" }, true),
  requestWithdraw: (amount: number, bank: { bank_name: string; bank_account_number: string; bank_account_holder: string; bank_bin?: string }) =>
    request<WithdrawRequest>("/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount, ...bank }) }, true),
  markWithdrawalPaid: (id: number, payoutReference: string) =>
    request<WithdrawRequest>(`/admin/withdrawals/${id}/paid`, { method: "POST", body: JSON.stringify({ payout_reference: payoutReference }) }, true),
  myWithdrawals: () => request<WithdrawRequest[]>("/wallet/withdrawals", {}, true),
  // --- Nạp tiền thật qua PayOS (src/payments) ---
  createDeposit: (amount: number) =>
    request<DepositIntent>("/wallet/deposits", { method: "POST", body: JSON.stringify({ amount }) }, true),
  myDeposits: () => request<DepositIntent[]>("/wallet/deposits/me", {}, true),
  cancelDeposit: (id: number) =>
    request<DepositIntent>(`/wallet/deposits/${id}/cancel`, { method: "POST" }, true),
  adminDeposits: (status?: string) =>
    request<AdminDepositIntent[]>(`/admin/deposits${status ? `?status=${status}` : ""}`, {}, true),
  adminReconcileDeposit: (id: number) =>
    request<{ id: number; status: string }>(`/admin/deposits/${id}/reconcile`, { method: "POST" }, true),
  adminPayosEvents: (orderCode?: number) =>
    request<PayosWebhookEventRow[]>(`/admin/payos-events${orderCode != null ? `?order_code=${orderCode}` : ""}`, {}, true),
  adminAccountWallet: (accountId: number) =>
    request<AdminAccountWallet>(`/admin/accounts/${accountId}/wallet`, {}, true),
  adminAccountTransactions: (accountId: number) =>
    request<Transaction[]>(`/admin/accounts/${accountId}/transactions`, {}, true),
  adminTopup: (accountId: number, amount: number) =>
    request<Wallet>("/wallet/topup", { method: "POST", body: JSON.stringify({ account_id: accountId, amount }) }, true),
  topSellers: (limit = 6) => request<SellerSummary[]>(`/sellers/top?limit=${limit}`),
  sellerProfile: (id: number) => request<SellerProfile>(`/sellers/${id}`),
  sellerDispute: (orderId: number) => request<Dispute>(`/seller/orders/${orderId}/dispute`, {}, true),
  sellerRespondDispute: (disputeId: number, sellerNote: string) =>
    request<Dispute>(`/seller/disputes/${disputeId}/respond`, { method: "POST", body: JSON.stringify({ seller_note: sellerNote }) }, true),
  providers: () => request<Provider[]>("/providers", {}, true),
  createProvider: (data: Record<string, unknown>) =>
    request<Provider>("/admin/providers", { method: "POST", body: JSON.stringify(data) }, true),
  providerHealth: (id: number) => request<ProviderHealth[]>(`/providers/${id}/health`, {}, true),
  approveProvider: (id: number, note?: string) =>
    request<Provider>(`/admin/providers/${id}/approve`, { method: "POST", body: JSON.stringify({ note: note ?? null }) }, true),
  rejectProvider: (id: number, note?: string) =>
    request<Provider>(`/admin/providers/${id}/reject`, { method: "POST", body: JSON.stringify({ note: note ?? null }) }, true),

  // Seller self-service — seller đăng ký backend của chính họ (spec 2026-07-21).
  sellerProviders: () => request<Provider[]>("/seller/providers", {}, true),
  createSellerProvider: (data: { name: string; adapter_type: string; config: Record<string, unknown> }) =>
    request<Provider>("/seller/providers", { method: "POST", body: JSON.stringify(data) }, true),
  updateSellerProvider: (id: number, data: Record<string, unknown>) =>
    request<Provider>(`/seller/providers/${id}`, { method: "PUT", body: JSON.stringify(data) }, true),
  testSellerProvider: (id: number) =>
    request<{ health: Record<string, unknown>; provision_test: Record<string, unknown> | null }>(`/seller/providers/${id}/test`, { method: "POST" }, true),

  submitReview: (orderId: number, rating: number, comment?: string) =>
    request<Review>(`/orders/${orderId}/review`, { method: "POST", body: JSON.stringify({ rating, comment: comment || null }) }, true),
  productReviews: (productId: number) =>
    request<Review[]>(`/products/${productId}/reviews`),

  orderDashboard: (orderId: number) => request<DashboardData>(`/orders/${orderId}/dashboard`, {}, true),
  chargeUsage: (orderId: number, endpoint: string, units = 1) =>
    request<ChargeUsageResult>(`/orders/${orderId}/usage`, { method: "POST", body: JSON.stringify({ endpoint, units }) }, true),
  orderResources: (orderId: number) => request<Resource[]>(`/orders/${orderId}/resources`, {}, true),
  markResourceError: (resourceId: number) => request<Resource>(`/seller/resources/${resourceId}/error`, { method: "POST" }, true),
  adminResources: (params: { status?: string; seller_id?: number; search?: string; page?: number; per_page?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.seller_id) q.set("seller_id", String(params.seller_id));
    if (params.search) q.set("search", params.search);
    if (params.page) q.set("page", String(params.page));
    if (params.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<AdminResourceListResponse>(`/admin/resources${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminResourceSummary: () => request<ResourceSummary>("/admin/resources/summary", {}, true),
  adminResourceSellers: () => request<ResourceSellerFacet[]>("/admin/resources/sellers", {}, true),

  pricingOptions: (productId: number) =>
    request<PricingOptions>(`/products/${productId}/pricing-options`),
  calculatePrice: (productId: number, userConfig: Record<string, unknown>) =>
    request<CalculateResult>(`/products/${productId}/calculate`, { method: "POST", body: JSON.stringify({ user_config: userConfig }) }),
  createOrderWithConfig: (productId: number, userConfig: Record<string, unknown>, quantity: number) =>
    request<Order>("/orders", { method: "POST", body: JSON.stringify({ product_id: productId, user_config: userConfig, quantity }) }, true),

  providerProducts: (id: number) =>
    request<{ id: number; title: string; service_type: string; status: string; pricing_strategy: string | null; pricing_params: Record<string, unknown> | null; order_count: number; revenue: number; compat_level: "ok" | "warn" | "block"; compat_message: string | null }[]>(`/admin/providers/${id}/products`, {}, true),
  updateProvider: (id: number, data: Record<string, unknown>) =>
    request<Provider>(`/admin/providers/${id}`, { method: "PUT", body: JSON.stringify(data) }, true),
  testProvider: (id: number) =>
    // Backend key is `provision_test` (nullable — DProxy never returns one,
    // see src/providers/router.py::_run_provider_test), not `provision`.
    request<{ health: Record<string, unknown>; provision_test: Record<string, unknown> | null }>(`/admin/providers/${id}/test`, { method: "POST" }, true),
  adapterCompatibility: () =>
    request<Record<string, string[] | "*">>("/admin/adapter-compatibility", {}, true),
  adminTasks: (status?: string) =>
    request<ServiceTask[]>(`/admin/tasks${status ? `?status=${status}` : ""}`, {}, true),
  updateTask: (id: number, data: Record<string, unknown>) =>
    request<ServiceTask>(`/admin/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }, true),

  updateProductOperations: (productId: number, data: Record<string, unknown>) =>
    request<void>(`/admin/products/${productId}/operations`, { method: "PUT", body: JSON.stringify(data) }, true),
  updateSellerPricing: (productId: number, data: Record<string, unknown>) =>
    request<void>(`/seller/products/${productId}/pricing`, { method: "PUT", body: JSON.stringify(data) }, true),

  adminLogs: (params: { request_id?: string; job_id?: string; order_id?: number; level?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.request_id) q.set("request_id", params.request_id);
    if (params.job_id) q.set("job_id", params.job_id);
    if (params.order_id != null) q.set("order_id", String(params.order_id));
    if (params.level) q.set("level", params.level);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<LogEntry[]>(`/admin/logs${qs ? `?${qs}` : ""}`, {}, true);
  },

  affiliateClick: (code: string, visitorId?: string) =>
    request<void>("/affiliate/click", {
      method: "POST",
      body: JSON.stringify({ code, visitor_id: visitorId ?? null }),
    }),
  affiliateMe: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    const qs = q.toString();
    return request<AffiliateStats>(`/affiliate/me${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminAffiliates: (params?: { search?: string; page?: number; per_page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<PaginatedAffiliateSummary>(`/admin/affiliates${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminAffiliateDetail: (id: number, params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    const qs = q.toString();
    return request<AffiliateStats>(`/admin/affiliates/${id}${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminUpdateAffiliateCode: (id: number, code: string) =>
    request<{ id: number; affiliate_code: string }>(`/admin/affiliates/${id}/code`, { method: "PATCH", body: JSON.stringify({ code }) }, true),
  adminFund: () => request<FundOverview>("/admin/affiliate-fund", {}, true),
  adminFundTopup: (amount: number, note?: string) =>
    request<FundOverview>("/admin/affiliate-fund/topup", { method: "POST", body: JSON.stringify({ amount, note }) }, true),
};

export type { Account, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, AffiliateStats, AffiliateSummary, CalculateResult, Category, DashboardData, Dispute, FundOverview, AccountAdminRow, PaginatedAccounts, LogEntry, Order, OrderStats, PaginatedAffiliateSummary, PaginatedOrderResponse, PricingField, PricingOptions, Product, ProductDetail, ProductOperations, Review, SellerApplication, SellerProduct, SellerStats, SellerSummary, SellerProfile, ServiceTask, Transaction, Variant, Wallet, WithdrawRequest, Provider, ProviderHealth, Alert, Resource, ResourceSummary, InventoryVariant, SellerApiKey, SellerApiKeyCreated };

/** Money formatter sống ở lib/utils/format — re-export để 22 chỗ đang
 * `import { vnd } from "@/lib/api"` không phải sửa cùng lúc; import mới
 * nên lấy thẳng từ "@/lib/utils". */
export { vnd } from "./utils/format";
