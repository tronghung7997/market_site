import type {
  Account, ActionItem, AdminDepositIntent, AdminDepositLedgerQuery, AdminDepositLedgerResponse, AdminDepositTransaction, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, AffiliateStats, AffiliateSummary, CalculateResult, Category, ChargeUsageResult, ChatConversationDetail, ChatConversationList, ChatMessage, DashboardData, DepositIntent, DepositMethods, DepositReconcileResult, DepositRailConfigAdmin, DepositRailConfigUpdate, Dispute, SePayWebhookEventRow, AdminAccountWallet, FundOverview, AccountAdminRow, PaginatedAccounts, LogEntry, MailConfigAdmin, MailConfigUpdate, MailOutboxList, MailSendTestResponse, MailTemplatePreview, MailTemplateRow, MoneyConfigAdmin, MoneyConfigPublic, MoneyConfigUpdate, Order, OrderStats, PaginatedAffiliateSummary, PaginatedOrderResponse, PaginatedProducts, PricingField, PricingOptions, ProductDetail, AdminProductDetail, Product, ProductLocale, ProductOperations, ProductTranslation, ProxyState, ProxyRotateResult, ProxyWhitelistResult, Review, SellerApplication, SellerProduct, SellerStats, ServiceTask, TikTokLookupResponse, Transaction, Variant, Wallet, WithdrawRequest, Provider, ProviderHealth, Alert, Resource, ResourceSummary, ResourceSellerFacet, InventoryVariant, SellerSummary, SellerProfile, SellerDisputeResource, SellerDisputeResourceList, SellerReplacementResourceList, BulkResourceActionResult,
} from "./types";
import type { PaginatedDisputes } from "./types";
import type { PaginatedAdminProducts, PaginatedInventoryVariants, PaginatedSellerProducts } from "./types";
import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  apiErrorFromResponse,
} from "./api-error";
import { SERVER_API_BASE } from "./server-api";
import { chunkDisputeResourceIds, chunkPairedDisputeResources } from "./dispute-batches";

export { ApiError, apiErrorFromResponse } from "./api-error";

// Browser requests are always same-origin. This prevents a production bundle
// from calling the visitor's localhost or bypassing the controlled Next proxy.
const BASE = typeof window !== "undefined" ? "/api" : SERVER_API_BASE;

function browserLocale(): string {
  if (typeof document === "undefined") return "en";
  const fromCookie = document.cookie.match(/(?:^|; )NEXT_LOCALE=(en|vi)(?:;|$)/)?.[1];
  if (fromCookie) return fromCookie;
  // First visit to /vi may not have the cookie yet — derive from the path.
  const fromPath = window.location.pathname.match(/^\/(en|vi)(?:\/|$)/)?.[1];
  return fromPath ?? "en";
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(path: string, init: RequestInit = {}, auth: boolean | "silent" = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Language": browserLocale(),
    ...(init.headers as Record<string, string>),
  };
  let res: Response;
  try {
    if (typeof window === "undefined") {
      const { signedBackendFetch } = await import("./bff-request-signing");
      res = await signedBackendFetch(path, { ...init, headers });
    } else {
      res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "same-origin" });
    }
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, "NETWORK");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth === true && typeof window !== "undefined") {
      window.dispatchEvent(new Event("auth:session-expired"));
    }
    throw apiErrorFromResponse(path, res.status, body, { auth, locale: browserLocale() });
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
    request<{ token_type: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  adminLogin: (email: string, password: string) =>
    request<{ token_type: string }>("/auth/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/session", { method: "DELETE" }),
  forgotPassword: (email: string, locale: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email, locale }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  me: () => request<Account>("/me", {}, "silent"),
  tiktokLookup: (value: string) =>
    request<TikTokLookupResponse>(`/internal/tiktok?url=${encodeURIComponent(value)}`),

  chatConversations: (perspective: "buyer" | "seller" | "all" = "all") =>
    request<ChatConversationList>(`/chat/conversations?perspective=${perspective}`, {}, true),
  chatConversation: (id: string, beforeId?: number) => {
    const cursor = beforeId == null ? "" : `?before_id=${beforeId}`;
    return request<ChatConversationDetail>(`/chat/conversations/${encodeURIComponent(id)}${cursor}`, {}, true);
  },
  createInquiry: (productId: number, initialMessage: string, clientMessageId: string) =>
    request<ChatConversationDetail>("/chat/inquiries", {
      method: "POST",
      body: JSON.stringify({
        product_id: productId,
        initial_message: initialMessage,
        client_message_id: clientMessageId,
      }),
    }, true),
  findProductInquiry: (productId: number) =>
    request<ChatConversationDetail>(`/chat/inquiries/by-product/${productId}`, {}, true),
  getOrCreateOrderChat: (orderId: number) =>
    request<ChatConversationDetail>(`/chat/orders/${orderId}`, { method: "POST" }, true),
  openMarketplaceChat: (orderId: number) =>
    request<ChatConversationDetail>(`/chat/orders/${orderId}/support`, { method: "POST" }, true),
  escalateMarketplaceReview: (orderId: number, note: string, idempotencyKey?: string) =>
    request<Dispute>(`/orders/${orderId}/dispute/escalate`, {
      method: "POST",
      body: JSON.stringify({
        note,
        idempotency_key: idempotencyKey ?? newIdempotencyKey(),
      }),
    }, true),
  adminSupportConversations: () =>
    request<ChatConversationList>("/chat/admin/support", {}, true),
  sendChatMessage: (conversationId: string, body: string, clientMessageId: string) =>
    request<ChatMessage>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, client_message_id: clientMessageId }),
    }, true),

  categories: () => request<Category[]>("/categories"),
  createCategory: (data: Record<string, unknown>) =>
    request<Category>("/admin/categories", { method: "POST", body: JSON.stringify(data) }, true),
  updateCategory: (id: number, data: Record<string, unknown>) =>
    request<Category>(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  deleteCategory: (id: number) =>
    request<void>(`/admin/categories/${id}`, { method: "DELETE" }, true),
  // Backend luôn phân trang; categoryId lọc theo cả nhánh danh mục.
  products: (opts: {
    categoryId?: number;
    sellerId?: number;
    search?: string;
    inStock?: boolean;
    fulfillment?: "instant";
    minPrice?: number;
    maxPrice?: number;
    sort?: "newest" | "bestseller" | "rating" | "price_asc" | "price_desc";
    page?: number;
    perPage?: number;
  } = {}) => {
    const q = new URLSearchParams();
    if (opts.categoryId) q.set("category_id", String(opts.categoryId));
    if (opts.sellerId) q.set("seller_id", String(opts.sellerId));
    if (opts.search) q.set("search", opts.search);
    if (opts.inStock) q.set("in_stock", "true");
    if (opts.fulfillment) q.set("fulfillment", opts.fulfillment);
    if (opts.minPrice != null) q.set("min_price", String(opts.minPrice));
    if (opts.maxPrice != null) q.set("max_price", String(opts.maxPrice));
    if (opts.sort && opts.sort !== "newest") q.set("sort", opts.sort);
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
  openDispute: (orderId: number, reason: string, evidenceType?: string, evidence?: Record<string, string>, resourceIds?: number[]) =>
    request<Dispute>(`/orders/${orderId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason, evidence_type: evidenceType ?? null, evidence: evidence ?? null, resource_ids: resourceIds ?? null, idempotency_key: resourceIds?.length ? newIdempotencyKey() : null }),
    }, true),
  appendDisputeClaims: (orderId: number, reason: string, resourceIds: number[]) =>
    request<Dispute>(`/orders/${orderId}/dispute/claims`, {
      method: "POST",
      body: JSON.stringify({ reason, resource_ids: resourceIds, idempotency_key: newIdempotencyKey() }),
    }, true),
  openDisputeBatched: async (
    orderId: number,
    reason: string,
    evidenceType?: string,
    evidence?: Record<string, string>,
    resourceIds: number[] = [],
  ) => {
    const batches = chunkDisputeResourceIds(resourceIds);
    const first = batches.shift();
    let dispute = await api.openDispute(orderId, reason, evidenceType, evidence, first);
    for (const batch of batches) {
      dispute = await api.appendDisputeClaims(orderId, reason, batch);
    }
    return dispute;
  },
  buyerDisputeMessage: (orderId: number, body: string) =>
    request<Dispute>(`/orders/${orderId}/dispute/messages`, { method: "POST", body: JSON.stringify({ body, idempotency_key: newIdempotencyKey() }) }, true),
  acceptDisputeResolution: (orderId: number) =>
    request<Dispute>(`/orders/${orderId}/dispute/accept`, { method: "POST" }, true),
  withdrawDispute: (orderId: number) =>
    request<Dispute>(`/orders/${orderId}/dispute/withdraw`, { method: "POST" }, true),
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

  sellerProducts: (params: { search?: string; page?: number; perPage?: number } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) });
    if (params.search?.trim()) q.set("search", params.search.trim());
    return request<PaginatedSellerProducts>(`/seller/products?${q}`, {}, true);
  },
  // Như api.product() nhưng kèm cả biến thể đã tắt — trang quản lý cần thấy chúng để bật lại.
  sellerProduct: (id: number) => request<ProductDetail>(`/seller/products/${id}/detail`, {}, true),
  sellerStats: () => request<SellerStats>("/seller/stats", {}, true),
  sellerOrders: () => request<Order[]>("/seller/orders", {}, true),
  createProduct: (data: Record<string, unknown>) =>
    request<Product>("/seller/products", { method: "POST", body: JSON.stringify(data) }, true),
  updateProduct: (id: number, data: Record<string, unknown>) =>
    request<Product>(`/seller/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  updateSellerProductStatus: (id: number, status: "active" | "paused") =>
    request<Product>(`/seller/products/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }, true),
  updateProductTranslation: (id: number, locale: ProductLocale, data: ProductTranslation) =>
    request<Product>(`/seller/products/${id}/translations/${locale}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  deleteProduct: (id: number) =>
    request<void>(`/seller/products/${id}`, { method: "DELETE" }, true),
  createVariant: (productId: number, data: Record<string, unknown>) =>
    request<Variant>(`/seller/products/${productId}/variants`, { method: "POST", body: JSON.stringify(data) }, true),
  updateVariant: (variantId: number, data: Record<string, unknown>) =>
    request<Variant>(`/seller/variants/${variantId}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  updateVariantTranslation: (variantId: number, locale: ProductLocale, name: string) =>
    request<Variant>(`/seller/variants/${variantId}/translations/${locale}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }, true),
  deleteVariant: (variantId: number) =>
    request<void>(`/seller/variants/${variantId}`, { method: "DELETE" }, true),
  addResources: (variantId: number, items: string[]) =>
    request<{ count: number }>(`/seller/variants/${variantId}/resources`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }, true),
  sellerVariantResources: async (
    variantId: number,
    opts: { page?: number; perPage?: number; status?: string; search?: string; archivedOnly?: boolean } = {},
  ) => {
    const q = new URLSearchParams({
      page: String(opts.page ?? 1),
      per_page: String(opts.perPage ?? 25),
    });
    if (opts.status && opts.status !== "all") {
      q.set("status", opts.status);
    }
    if (opts.search?.trim()) {
      q.set("search", opts.search.trim());
    }
    if (opts.archivedOnly) {
      q.set("archived_only", "true");
    }
    const path = `/seller/variants/${variantId}/resources?${q}`;
    const headers: Record<string, string> = { "Accept-Language": browserLocale() };
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { headers, credentials: "same-origin" });
    } catch {
      throw new ApiError(0, NETWORK_ERROR_MESSAGE, "NETWORK");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth:session-expired"));
      }
      throw apiErrorFromResponse(path, res.status, body, {
        auth: res.status === 401,
        locale: browserLocale(),
      });
    }
    return {
      items: Array.isArray(body) ? body as Resource[] : [],
      total: Number(res.headers.get("X-Total-Count") ?? (Array.isArray(body) ? body.length : 0)),
    };
  },
  inventorySummary: (params: { search?: string; page?: number; perPage?: number } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) });
    if (params.search?.trim()) q.set("search", params.search.trim());
    return request<PaginatedInventoryVariants>(`/seller/inventory/summary?${q}`, {}, true);
  },
  sellerResourceExportUrl: (
    variantId: number,
    params: { format: "csv" | "txt"; status?: string; search?: string; archivedOnly?: boolean },
  ) => {
    const q = new URLSearchParams({ format: params.format });
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.search?.trim()) q.set("search", params.search.trim());
    if (params.archivedOnly) q.set("archived_only", "true");
    return `/api/seller/variants/${variantId}/resources/export?${q}`;
  },
  updateResource: (resourceId: number, data: string) =>
    request<Resource>(`/seller/resources/${resourceId}`, { method: "PATCH", body: JSON.stringify({ data }) }, true),
  restockResource: (resourceId: number, data: string) =>
    request<Resource>(`/seller/resources/${resourceId}/restock`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }, true),
  archiveResource: (resourceId: number) =>
    request<Resource>(`/seller/resources/${resourceId}/archive`, {
      method: "POST",
    }, true),
  restoreResource: (resourceId: number) =>
    request<Resource>(`/seller/resources/${resourceId}/restore`, {
      method: "POST",
    }, true),
  bulkResourceAction: (variantId: number, action: "archive" | "restore" | "delete", resourceIds: number[]) =>
    request<BulkResourceActionResult>(`/seller/variants/${variantId}/resources/bulk-action`, {
      method: "POST",
      body: JSON.stringify({ action, resource_ids: resourceIds }),
    }, true),
  deleteResource: (resourceId: number) =>
    request<void>(`/seller/resources/${resourceId}`, { method: "DELETE" }, true),
  sellerAcceptOrder: (orderId: number) =>
    request<Order>(`/seller/orders/${orderId}/accept`, { method: "POST" }, true),
  sellerDeliverOrder: (orderId: number, data: string) =>
    request<Order>(`/seller/orders/${orderId}/deliver`, { method: "POST", body: JSON.stringify({ data }) }, true),

  productOperations: (id: number) => request<ProductOperations>(`/products/${id}/operations`, {}, true),

  adminProducts: (params: { search?: string; page?: number; perPage?: number } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) });
    if (params.search?.trim()) q.set("search", params.search.trim());
    return request<PaginatedAdminProducts>(`/admin/products?${q}`, {}, true);
  },
  // Bản duy nhất còn commission_rate — trường này đã rút khỏi GET /products{,/{id}}.
  adminProduct: (id: number) => request<AdminProductDetail>(`/admin/products/${id}`, {}, true),
  adminUpdateProduct: (id: number, data: Record<string, unknown>) =>
    request<Product>(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  adminUpdateProductTranslation: (id: number, locale: ProductLocale, data: ProductTranslation) =>
    request<Product>(`/admin/products/${id}/translations/${locale}`, { method: "PATCH", body: JSON.stringify(data) }, true),
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
  dismissOwnAlert: (id: number) => request<Alert>(`/me/alerts/${id}/dismiss`, { method: "POST" }, true),
  accountActionItems: () => request<ActionItem[]>("/me/action-items", {}, true),
  buyerActionItems: () => request<ActionItem[]>("/orders/action-items", {}, true),
  sellerActionItems: () => request<ActionItem[]>("/seller/action-items", {}, true),
  adminActionItems: () => request<ActionItem[]>("/admin/action-items", {}, true),
  adminDisputes: (page = 1, perPage = 100) =>
    request<PaginatedDisputes>(`/admin/disputes?page=${page}&per_page=${perPage}`, {}, true),
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
  rejectWithdrawal: (id: number, reason: string) =>
    request<WithdrawRequest>(`/admin/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, true),
  requestWithdraw: (amount: number, bank: { bank_name: string; bank_account_number: string; bank_account_holder: string; bank_bin?: string }) =>
    request<WithdrawRequest>("/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount, ...bank }) }, true),
  markWithdrawalPaid: (id: number, payoutReference: string) =>
    request<WithdrawRequest>(`/admin/withdrawals/${id}/paid`, { method: "POST", body: JSON.stringify({ payout_reference: payoutReference }) }, true),
  myWithdrawals: () => request<WithdrawRequest[]>("/wallet/withdrawals", {}, true),
  // --- Nạp tiền qua SePay / NOWPayments (src/payments) ---
  depositMethods: () =>
    request<DepositMethods>("/wallet/deposit-methods", {}, false),
  createDeposit: (
    amount: number,
    opts?: { method?: "sepay" | "nowpayments"; pay_currency?: string },
  ) =>
    request<DepositIntent>(
      "/wallet/deposits",
      {
        method: "POST",
        body: JSON.stringify({
          amount,
          method: opts?.method ?? "sepay",
          ...(opts?.pay_currency ? { pay_currency: opts.pay_currency } : {}),
        }),
      },
      true,
    ),
  myDeposits: () => request<DepositIntent[]>("/wallet/deposits/me", {}, true),
  cancelDeposit: (id: number) =>
    request<DepositIntent>(`/wallet/deposits/${id}/cancel`, { method: "POST" }, true),
  adminDeposits: (status?: string, provider?: string) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (provider) q.set("provider", provider);
    const qs = q.toString();
    return request<AdminDepositIntent[]>(`/admin/deposits${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminDepositTransactions: (id: number) =>
    request<AdminDepositTransaction[]>(`/admin/deposits/${id}/transactions`, {}, true),
  adminDepositLedger: (query: AdminDepositLedgerQuery = {}) => {
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 25));
    params.set("offset", String(query.offset ?? 0));
    if (query.provider) params.set("provider", query.provider);
    if (query.status) params.set("status", query.status);
    if (query.search) params.set("search", query.search);
    return request<AdminDepositLedgerResponse>(`/admin/deposit-ledger?${params.toString()}`, {}, true);
  },
  adminNowpaymentsEvents: (paymentId?: string) =>
    request<Array<Record<string, unknown>>>(
      `/admin/nowpayments-events${paymentId ? `?payment_id=${encodeURIComponent(paymentId)}` : ""}`,
      {},
      true,
    ),
  adminDepositRailConfig: () =>
    request<DepositRailConfigAdmin>("/admin/deposit-rail-config", {}, true),
  updateDepositRailConfig: (body: DepositRailConfigUpdate) =>
    request<DepositRailConfigAdmin>("/admin/deposit-rail-config", {
      method: "PATCH",
      body: JSON.stringify(body),
    }, true),
  resetDepositRailConfig: () =>
    request<DepositRailConfigAdmin>("/admin/deposit-rail-config/reset-to-env", {
      method: "POST",
    }, true),
  adminReconcileDeposit: (id: number) =>
    request<DepositReconcileResult>(`/admin/deposits/${id}/reconcile`, { method: "POST" }, true),
  adminSePayEvents: (paymentCode?: string) =>
    request<SePayWebhookEventRow[]>(
      `/admin/sepay-events${paymentCode ? `?payment_code=${encodeURIComponent(paymentCode)}` : ""}`,
      {},
      true,
    ),
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
  sellerDisputeResources: (
    disputeId: number,
    opts?: { search?: string; page?: number; per_page?: number; pending_only?: boolean; ids_only?: boolean },
  ) => {
    const query = new URLSearchParams();
    if (opts?.search) query.set("search", opts.search);
    if (opts?.page) query.set("page", String(opts.page));
    if (opts?.per_page) query.set("per_page", String(opts.per_page));
    if (opts?.pending_only) query.set("pending_only", "true");
    if (opts?.ids_only) query.set("ids_only", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<SellerDisputeResourceList>(`/seller/disputes/${disputeId}/resources${suffix}`, {}, true);
  },
  sellerDisputeReplacements: (
    disputeId: number,
    opts?: { search?: string; page?: number; per_page?: number; ids_only?: boolean },
  ) => {
    const query = new URLSearchParams();
    if (opts?.search) query.set("search", opts.search);
    if (opts?.page) query.set("page", String(opts.page));
    if (opts?.per_page) query.set("per_page", String(opts.per_page));
    if (opts?.ids_only) query.set("ids_only", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<SellerReplacementResourceList>(`/seller/disputes/${disputeId}/replacement-resources${suffix}`, {}, true);
  },
  sellerResolveDisputeResources: (
    disputeId: number,
    resourceIds: number[],
    action: "replace" | "refund",
    note?: string,
    replacementResourceIds?: number[],
  ) =>
    request<{ actions: unknown[] }>(`/seller/disputes/${disputeId}/resources/action`, {
      method: "POST",
      body: JSON.stringify({
        resource_ids: resourceIds,
        action,
        seller_note: note ?? null,
        replacement_resource_ids: replacementResourceIds ?? null,
        idempotency_key: newIdempotencyKey(),
      }),
    }, true),
  sellerResolveDisputeResourcesBatched: async (
    disputeId: number,
    resourceIds: number[],
    action: "replace" | "refund",
    note?: string,
    replacementResourceIds?: number[],
  ) => {
    const batches = chunkPairedDisputeResources(resourceIds, replacementResourceIds);
    const actions: unknown[] = [];
    for (const [index, batch] of batches.entries()) {
      const result = await api.sellerResolveDisputeResources(
        disputeId,
        batch.resourceIds,
        action,
        index === batches.length - 1 ? note : undefined,
        batch.replacementResourceIds,
      );
      actions.push(...result.actions);
    }
    return { actions };
  },
  sellerEscalateDispute: (disputeId: number, note: string, idempotencyKey?: string) =>
    request<Dispute>(`/seller/disputes/${disputeId}/escalate`, {
      method: "POST",
      body: JSON.stringify({
        seller_note: note,
        idempotency_key: idempotencyKey ?? newIdempotencyKey(),
      }),
    }, true),
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
    request<{ health: Record<string, unknown>; provision_test: Record<string, unknown> | null; provision_test_skipped_reason?: string | null }>(`/seller/providers/${id}/test`, { method: "POST" }, true),
  submitSellerProvider: (id: number) =>
    request<Provider>(`/seller/providers/${id}/submit`, { method: "POST" }, true),

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
    request<{
      health: Record<string, unknown>;
      provision_test: Record<string, unknown> | null;
      // Câu giải thích vì sao KHÔNG thử cấp phát (adapter tiêu tiền thật, hoặc
      // kết nối đang lỗi) — hiện thay cho một ô trống khó hiểu ở /admin/providers.
      provision_test_skipped_reason: string | null;
    }>(`/admin/providers/${id}/test`, { method: "POST" }, true),
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

  adminLogs: (params: {
    request_id?: string;
    job_id?: string;
    order_id?: number;
    level?: string;
    limit?: number;
    before_id?: number;
    since?: string;
    until?: string;
  } = {}) => {
    const q = new URLSearchParams();
    if (params.request_id) q.set("request_id", params.request_id);
    if (params.job_id) q.set("job_id", params.job_id);
    if (params.order_id != null) q.set("order_id", String(params.order_id));
    if (params.level) q.set("level", params.level);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.before_id != null) q.set("before_id", String(params.before_id));
    if (params.since) q.set("since", params.since);
    if (params.until) q.set("until", params.until);
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

  /** Public display FX config — no auth. */
  moneyConfig: () => request<MoneyConfigPublic>("/public/money-config"),
  adminMoneyConfig: () => request<MoneyConfigAdmin>("/admin/money-config", {}, true),
  adminUpdateMoneyConfig: (body: MoneyConfigUpdate) =>
    request<{
      display_fx_rate: number;
      display_currency_default: string;
      allow_user_toggle: boolean;
      allow_locale_toggle: boolean;
      show_fx_hints: boolean;
      old_rate: number | null;
      updated_at: string;
      updated_by_id: number;
    }>(
      "/admin/money-config",
      { method: "PATCH", body: JSON.stringify(body) },
      true,
    ),
  adminMailConfig: () => request<MailConfigAdmin>("/admin/mail-config", {}, true),
  adminUpdateMailConfig: (body: MailConfigUpdate) =>
    request<MailConfigAdmin>("/admin/mail-config", {
      method: "PATCH",
      body: JSON.stringify(body),
    }, true),
  adminResetMailConfigToEnv: () =>
    request<MailConfigAdmin>("/admin/mail-config/reset-to-env", { method: "POST" }, true),
  adminSendTestMail: (toEmail: string, locale: "vi" | "en") =>
    request<MailSendTestResponse>("/admin/mail-config/send-test", {
      method: "POST",
      body: JSON.stringify({ to_email: toEmail, locale }),
    }, true),
  adminMailOutbox: (query?: { status?: string; template?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    params.set("limit", String(query?.limit ?? 25));
    params.set("offset", String(query?.offset ?? 0));
    if (query?.status) params.set("status", query.status);
    if (query?.template) params.set("template", query.template);
    return request<MailOutboxList>(`/admin/mail-outbox?${params.toString()}`, {}, true);
  },
  adminRetryMailOutbox: (id: number) =>
    request<MailOutboxList["items"][number]>(`/admin/mail-outbox/${id}/retry`, { method: "POST" }, true),
  adminMailTemplates: () => request<{ items: MailTemplateRow[] }>("/admin/mail-templates", {}, true),
  adminUpdateMailTemplate: (body: { template: string; locale: "vi" | "en"; subject: string; body: string }) =>
    request<MailTemplateRow>("/admin/mail-templates", {
      method: "PATCH",
      body: JSON.stringify(body),
    }, true),
  adminResetMailTemplate: (template: string, locale: "vi" | "en") =>
    request<MailTemplateRow>("/admin/mail-templates/reset", {
      method: "POST",
      body: JSON.stringify({ template, locale }),
    }, true),
  adminPreviewMailTemplate: (body: { template: string; locale: "vi" | "en"; subject: string; body: string }) =>
    request<MailTemplatePreview>("/admin/mail-templates/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),

  adminResetMoneyConfigToEnv: () =>
    request<{
      display_fx_rate: number;
      display_currency_default: string;
      allow_user_toggle: boolean;
      allow_locale_toggle: boolean;
      show_fx_hints: boolean;
      old_rate: number | null;
      updated_at: string;
      updated_by_id: number;
    }>(
      "/admin/money-config/reset-to-env",
      { method: "POST" },
      true,
    ),
};

export type { Account, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, AffiliateStats, AffiliateSummary, CalculateResult, Category, DashboardData, Dispute, FundOverview, AccountAdminRow, PaginatedAccounts, LogEntry, Order, OrderStats, PaginatedAffiliateSummary, PaginatedOrderResponse, PricingField, PricingOptions, Product, ProductDetail, ProductOperations, Review, SellerApplication, SellerProduct, SellerStats, SellerSummary, SellerProfile, ServiceTask, Transaction, Variant, Wallet, WithdrawRequest, Provider, ProviderHealth, Alert, Resource, ResourceSummary, InventoryVariant };

/** Money formatter sống ở lib/utils/format — re-export để 22 chỗ đang
 * `import { vnd } from "@/lib/api"` không phải sửa cùng lúc; import mới
 * nên lấy thẳng từ "@/lib/utils". */
export { vnd } from "./utils/format";
