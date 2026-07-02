import type {
  Account, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, CalculateResult, Category, DashboardData, Dispute, LogEntry, Order, OrderStats, PaginatedOrderResponse, PricingField, PricingOptions, ProductDetail, Product, ProductOperations, Review, SellerProduct, SellerStats, ServiceTask, Transaction, Variant, Wallet, Provider, ProviderHealth, Alert, Resource, ResourceSummary,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL
  ?? (typeof window !== "undefined" ? "/api" : (process.env.API_URL ?? "http://localhost:8001"));
const TOKEN_KEY = "dx_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

console.log('base', BASE);
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
    throw new ApiError(0, "Cannot reach the API. Is marketplace-svc running on :8001?");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body && (body.detail || body.message)) || res.statusText;
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return body as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<Account>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ access_token: string; token_type: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<Account>("/me", {}, true),

  categories: () => request<Category[]>("/categories"),
  products: (categoryId?: number) =>
    request<Product[]>(`/products${categoryId ? `?category_id=${categoryId}` : ""}`),
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
  createOrder: (variantId: number, quantity: number) =>
    request<Order>("/orders", { method: "POST", body: JSON.stringify({ variant_id: variantId, quantity }) }, true),

  confirmOrder: (orderId: number) =>
    request<Order>(`/orders/${orderId}/confirm`, { method: "POST" }, true),
  openDispute: (orderId: number, reason: string) =>
    request<Dispute>(`/orders/${orderId}/dispute`, { method: "POST", body: JSON.stringify({ reason }) }, true),

  sellerProducts: () => request<SellerProduct[]>("/seller/products", {}, true),
  sellerStats: () => request<SellerStats>("/seller/stats", {}, true),
  sellerOrders: () => request<Order[]>("/seller/orders", {}, true),
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
  sellerAcceptOrder: (orderId: number) =>
    request<Order>(`/seller/orders/${orderId}/accept`, { method: "POST" }, true),
  sellerDeliverOrder: (orderId: number, data: string) =>
    request<Order>(`/seller/orders/${orderId}/deliver`, { method: "POST", body: JSON.stringify({ data }) }, true),

  productOperations: (id: number) => request<ProductOperations>(`/products/${id}/operations`, {}, true),

  adminProducts: () => request<AdminProduct[]>("/admin/products", {}, true),
  adminOrders: () => request<Order[]>("/admin/orders", {}, true),
  adminOrderDetail: (orderId: number) => request<AdminOrderDetail>(`/admin/orders/${orderId}`, {}, true),
  adminAlerts: () => request<Alert[]>("/admin/alerts", {}, true),
  dismissAlert: (id: number) => request<Alert>(`/admin/alerts/${id}/dismiss`, { method: "POST" }, true),
  adminDisputes: () => request<Dispute[]>("/admin/disputes", {}, true),
  adminDisputeDetail: (id: number) => request<AdminDisputeDetail>(`/admin/disputes/${id}`, {}, true),
  refundDispute: (id: number, adminNote: string) =>
    request<Dispute>(`/admin/disputes/${id}/refund`, { method: "POST", body: JSON.stringify({ admin_note: adminNote }) }, true),
  rejectDispute: (id: number, adminNote: string) =>
    request<Dispute>(`/admin/disputes/${id}/reject`, { method: "POST", body: JSON.stringify({ admin_note: adminNote }) }, true),
  sellerDispute: (orderId: number) => request<Dispute>(`/seller/orders/${orderId}/dispute`, {}, true),
  sellerRespondDispute: (disputeId: number, sellerNote: string) =>
    request<Dispute>(`/seller/disputes/${disputeId}/respond`, { method: "POST", body: JSON.stringify({ seller_note: sellerNote }) }, true),
  providers: () => request<Provider[]>("/providers", {}, true),
  providerHealth: (id: number) => request<ProviderHealth[]>(`/providers/${id}/health`, {}, true),

  submitReview: (orderId: number, rating: number, comment?: string) =>
    request<Review>(`/orders/${orderId}/review`, { method: "POST", body: JSON.stringify({ rating, comment: comment || null }) }, true),
  productReviews: (productId: number) =>
    request<Review[]>(`/products/${productId}/reviews`),

  orderDashboard: (orderId: number) => request<DashboardData>(`/orders/${orderId}/dashboard`, {}, true),
  orderResources: (orderId: number) => request<Resource[]>(`/orders/${orderId}/resources`, {}, true),
  markResourceError: (resourceId: number) => request<Resource>(`/seller/resources/${resourceId}/error`, { method: "POST" }, true),
  adminResources: (params: { status?: string; search?: string; page?: number; per_page?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.search) q.set("search", params.search);
    if (params.page) q.set("page", String(params.page));
    if (params.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<AdminResourceListResponse>(`/admin/resources${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminResourceSummary: () => request<ResourceSummary>("/admin/resources/summary", {}, true),

  pricingOptions: (productId: number) =>
    request<PricingOptions>(`/products/${productId}/pricing-options`),
  calculatePrice: (productId: number, userConfig: Record<string, unknown>) =>
    request<CalculateResult>(`/products/${productId}/calculate`, { method: "POST", body: JSON.stringify({ user_config: userConfig }) }),
  createOrderWithConfig: (productId: number, userConfig: Record<string, unknown>, quantity: number) =>
    request<Order>("/orders", { method: "POST", body: JSON.stringify({ product_id: productId, user_config: userConfig, quantity }) }, true),

  providerProducts: (id: number) =>
    request<{ id: number; title: string; service_type: string; pricing_strategy: string | null; order_count: number; revenue: number }[]>(`/admin/providers/${id}/products`, {}, true),
  updateProvider: (id: number, data: Record<string, unknown>) =>
    request<Provider>(`/admin/providers/${id}`, { method: "PUT", body: JSON.stringify(data) }, true),
  testProvider: (id: number) =>
    request<{ health: Record<string, unknown>; provision: Record<string, unknown> }>(`/admin/providers/${id}/test`, { method: "POST" }, true),
  adminTasks: (status?: string) =>
    request<ServiceTask[]>(`/admin/tasks${status ? `?status=${status}` : ""}`, {}, true),
  updateTask: (id: number, data: Record<string, unknown>) =>
    request<ServiceTask>(`/admin/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }, true),

  updateProductOperations: (productId: number, data: Record<string, unknown>) =>
    request<void>(`/admin/products/${productId}/operations`, { method: "PUT", body: JSON.stringify(data) }, true),

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
};

export type { Account, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, CalculateResult, Category, DashboardData, Dispute, LogEntry, Order, OrderStats, PaginatedOrderResponse, PricingField, PricingOptions, Product, ProductDetail, ProductOperations, Review, SellerProduct, SellerStats, ServiceTask, Transaction, Variant, Wallet, Provider, ProviderHealth, Alert, Resource, ResourceSummary };

/** Money helpers. Backend stores an integer amount; for this Vietnamese
 * marketplace we render it as đồng (no sub-unit), e.g. 7000 → "7.000 ₫". */
export function vnd(amount: number): string {
  return amount.toLocaleString("vi-VN") + " ₫";
}
