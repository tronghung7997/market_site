import type {
  Account, ActionItem, AdminDepositIntent, AdminDepositLedgerQuery, AdminDepositLedgerResponse, AdminDepositTransaction, AdminDisputeDetail, AdminOrderDetail, AdminProduct, AdminResourceListResponse, AffiliateStats, AffiliateSummary, CalculateResult, Category, ChargeUsageResult, ChatConversationDetail, ChatConversationList, ChatMessage, DashboardData, DepositIntent, DepositMethods, DepositReconcileResult, DepositRailConfigAdmin, DepositRailConfigUpdate, Dispute, SePayWebhookEventRow, AdminAccountWallet, FundOverview, AccountAdminRow, PaginatedAccounts, LogEntry, MailConfigAdmin, MailConfigUpdate, MailOutboxList, MailSendTestResponse, MailTemplatePreview, MailTemplateRow, MoneyConfigAdmin, MoneyConfigPublic, MoneyConfigUpdate, Order, OrderStats, PaginatedAffiliateSummary, PaginatedOrderResponse, PaginatedProducts, PricingField, PricingOptions, ProductDetail, AdminProductDetail, Product, ProductLocale, ProductOperations, ProductTranslation, ProxyPlanRow, ProxyProductPlans, ProxyState, ProxyRotateResult, ProxyWhitelistResult, ProxyLine, ProxyLineListResponse, ProxyLineQuery, ProxyTag, ProxyTagAssignRequest, ProxyTagTone, Review, SellerApplication, SellerDashboard, SellerDashboardRangeKey, SellerOrderQuery, PaginatedSellerOrders, SellerProduct, SellerProductBulkStatusResult, SellerProductSort, SellerStats, ServiceTask, TikTokLookupResponse, FacebookLookupResponse, Transaction, Variant, Wallet, WithdrawRequest, Provider, ProviderHealth, Alert, Resource, ResourceSummary, ResourceSellerFacet, InventoryVariant, SellerSummary, SellerProfile, SellerDisputeResource, SellerDisputeResourceList, SellerDisputeProxyLine, SellerReplacementResourceList, BulkResourceActionResult, ResourceReveal, SellerResourceRow,
  AdminReview,
  AdminReviewList,
  SellerReview,
  SellerReviewList,
  PublicReviewList,
  MarketplaceStats,
  SellerPublicReviewList,
  ShowcaseReview,
  CategoryContentAdmin,
  CategoryContentPublic,
  EscrowSchedule,
  SellerExperience,
  SellerReferralSource,
  SellerType,
  SearchSuggest,
  SearchQueryStat,
  SearchSynonymGroup,
} from "./types";
import type { PaginatedDisputes, SitePageAdmin, SitePageCreate, SitePageUpdate } from "./types";
import type { OrderQuote, OrderRequestBody, PromotionInput } from "./types";
import type { LedgerGroup, LedgerPage, LedgerStatement, LedgerSuggestion, LedgerSummary } from "./types";
import type { FinanceCloseChecklist, FinancePeriodClose, FinanceReport } from "./types";
import type {
  AdminPromotion, AdminPromotionPage, AdminPromotionQuery, AdminPromotionRedemptionPage, AdminPromotionStats,
  AuditEntityEvent, PromotionCodePage, PromotionCodeStatus, PromotionCodesCreate,
  AdminSupportQuery, AdminSupportStats, AdminTicket, AdminTicketContext, AdminTicketPage, CannedReply, CannedReplyInput,
  SupportTagCount, TicketStatusChange,
} from "./types";
import type { MyQuestion, PublicQuestionList, QuestionStatus, SellerQuestion, SellerQuestionList } from "./types";
import type { SellerTierDetail, SellerTierProgress, SellerTierReviewRow, SellerTrustConfig } from "./types";
import type { SellerTelegramEvent, SellerTelegramLinkCode, SellerTelegramLinkStatus, SellerTelegramState } from "./types";
import type { PostAdmin, PostList, PostWrite } from "./types";
import type { HelpdeskRole } from "./types";
import type { ApiKeyCreated, ApiKeyList, ApiKeyRow, ApiKeyScope } from "./types";
import type { NotificationCategory, NotificationCounts, NotificationPage } from "./types";
import type { CategoryAdminListResponse, CategoryCreateInput, CategoryUpdateInput } from "./types";
import type { AffiliateSort } from "./types";
import type { AdminProductActivity, AdminProductBulkAction, AdminProductBulkResult } from "./types";
import type { BusinessAnalytics, BusinessAnalyticsQuery, BusinessFilterOptions } from "./types";
import type { AdminAlert, AdminDisputeCase, AdminLogEntry, AdminOrderCase } from "./types";
import type {
  AccountBulkStatusResult, AccountOverview, AdminNote, AdminSellerApplicationDetail, AdminSellerApplicationList,
  AdminSellerApplicationRow, SellerApplicationInfoField, SellerApplicationStatus,
} from "./types";
import type { AdminOrderPage, AdminOrderQuery, AdminOrdersOverview, OrderResourcePage } from "./types";
import type { AdminMediaPage, AdminMediaStats, AuthSessionRow, MediaPurpose, MediaStatus, MySellerProfile, ProfileUpdate, UploadedMedia } from "./types";
import type {
  SourceArea, SourceCatalogPage, SourceCatalogQuery, SourceImportItem, SourceImportResult, SourceListing,
  SourceRepriceResult, SourceSyncResult, SupplierSource, SourceOffer, SourcePlanImportItem, SourcePlanImportResult,
  SourceRepriceRequest, SourcePurchasePage, SourcePurchaseQuery, SourceSettings, SourceSettingsUpdate, SourceListingUpdate,
  GatewayOverview, GatewayPackagesUpdate, GatewayRequestPage, GatewayTryResult,
  SourceKind, SourceSellerCandidate, SourceCreateRequest, SourceCreateResult, SourceTestResult,
} from "./types";
import type { PaginatedAdminProducts, PaginatedInventoryVariants, PaginatedSellerProducts } from "./types";
import type {
  BulkResourceActionInput, InventoryExportParams, InventoryExportPreview, InventoryPackageBulkStatusResult,
  InventoryPackageDetail, InventoryPackagesResponse, InventoryPackageSort, InventoryProductStatusFilter,
  InventoryReportParams, InventoryReportResponse, InventoryStockTab, RestockPreview, RestockResult,
  StockBatch, StockBatchList, StockUploadTarget,
  SellerResourceQuery, SellerRuntimeConfig, SiteAnalyticsConfig,
  LoginEvent, AffiliateRuntimeConfig, PublicAffiliateConfig, ContentFilterConfig, ContentFilterTestResult, AuthRuntimeConfig,
  LoginResult, RegisterResult, BankDepositAccount, UnmatchedTransfer, PublicAuthConfig, TotpSetup, SiteStatusPublic, SiteStatusAdmin, SiteStatusUpdate, LedgerRun, FeeConfigPublic, FeeConfigAdmin, FeeConfigUpdate, WithdrawQuote, SellerTierRule, SellerTierRulePatch, SellerTierName,
} from "./types";
import type {
  AiConnectionTestResult, AiPromptTemplate, AiProviderConfig, AiUsageSummary,
  TrustSeedApplyResponse, TrustSeedBatch, TrustSeedGenerateResponse, TrustSeedSummary,
} from "./types";
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

/** A fresh key for one logical mutation; keep it across retries of that same mutation. */
export function newIdempotencyKey(): string {
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
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw err;
    }
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

function inventoryExportQuery(params: InventoryExportParams) {
  const q = new URLSearchParams();
  if (params.variantIds?.length) q.set("variant_ids", params.variantIds.join(","));
  if (params.productIds?.length) q.set("product_ids", params.productIds.join(","));
  if (params.categoryIds?.length) q.set("category_ids", params.categoryIds.join(","));
  if (params.includeInactive) q.set("include_inactive", "true");
  if (params.statuses?.length) q.set("statuses", params.statuses.join(","));
  if (params.includeArchived) q.set("include_archived", "true");
  if (params.createdFrom) q.set("created_from", params.createdFrom);
  if (params.createdTo) q.set("created_to", params.createdTo);
  if (params.assignedFrom) q.set("assigned_from", params.assignedFrom);
  if (params.assignedTo) q.set("assigned_to", params.assignedTo);
  if (params.mask && params.mask !== "none") q.set("mask", params.mask);
  if (params.maskChar && params.maskChar !== "•") q.set("mask_char", params.maskChar);
  if (params.format) q.set("format", params.format);
  if (params.columns?.length) q.set("columns", params.columns.join(","));
  if (params.locale) q.set("locale", params.locale);
  return q;
}

function inventoryReportQuery(params: InventoryReportParams) {
  const q = new URLSearchParams({ range: params.range });
  if (params.variantIds?.length) q.set("variant_ids", params.variantIds.join(","));
  if (params.productIds?.length) q.set("product_ids", params.productIds.join(","));
  if (params.categoryIds?.length) q.set("category_ids", params.categoryIds.join(","));
  if (params.includeInactive) q.set("include_inactive", "true");
  if (params.range === "custom" && params.from && params.to) {
    q.set("from", params.from);
    q.set("to", params.to);
  }
  if (params.tz) q.set("tz", params.tz);
  if (params.groupBy) q.set("group_by", params.groupBy);
  if (params.basis) q.set("basis", params.basis);
  if (params.compare === false) q.set("compare", "false");
  if (params.lowOnly) q.set("low_only", "true");
  if (params.hasError) q.set("has_error", "true");
  if (params.noActivity) q.set("no_activity", "true");
  return q;
}

/** `?line=N` for the per-proxy order endpoints; empty when no line is given. */
function proxyLineQuery(line?: number): string {
  return line != null && Number.isInteger(line) && line >= 1 ? `?line=${line}` : "";
}

export interface LedgerQueryParams {
  start?: string;
  end?: string;
  direction?: "in" | "out" | "neutral";
  type?: string[];
  role?: "buyer" | "seller" | "platform";
  account_id?: number;
  group?: string;
  amount?: number;
  entry_id?: number;
}

function ledgerQueryString(params: object): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => q.append(key, String(v)));
    else q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface AdminAccountsQuery {
  search?: string;
  role?: string;
  /** Comma list on the wire (`new,verified`). */
  tier?: string[];
  status?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}

/** `?a=1&b=2` from defined, non-empty values (arrays joined by commas). */
function queryString(params?: object): string {
  return accountsQueryString(params as AdminAccountsQuery);
}

function accountsQueryString(params?: AdminAccountsQuery & { ids?: number[] }): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) { if (value.length) q.set(key, value.join(",")); continue; }
    q.set(key, String(value));
  }
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  register: (email: string, password: string, referralCode?: string, locale = "vi", captchaToken?: string) => {
    const body: Record<string, string> = { email, password, locale };
    if (referralCode) body.referral_code = referralCode;
    if (captchaToken) body.captcha_token = captchaToken;
    return request<RegisterResult>("/auth/register", { method: "POST", body: JSON.stringify(body) });
  },
  login: (email: string, password: string, captchaToken?: string) =>
    request<LoginResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password, captcha_token: captchaToken ?? null }) }),
  adminLogin: (email: string, password: string, captchaToken?: string) =>
    request<LoginResult>("/auth/admin/login", { method: "POST", body: JSON.stringify({ email, password, captcha_token: captchaToken ?? null }) }),
  loginMfa: (mfaToken: string, code: string) =>
    request<{ token_type: string }>("/auth/login/2fa", { method: "POST", body: JSON.stringify({ mfa_token: mfaToken, code }) }),
  publicAuthConfig: () => request<PublicAuthConfig>("/public/auth-config"),
  publicSiteStatus: () => request<SiteStatusPublic>("/public/site-status"),
  adminSiteStatus: () => request<SiteStatusAdmin>("/admin/site-status", {}, true),
  adminLedgerRuns: () => request<LedgerRun[]>("/admin/ledger/reconcile-runs", {}, true),
  feeConfig: () => request<FeeConfigPublic>("/public/fee-config"),
  withdrawQuote: (amount: number) => request<WithdrawQuote>(`/wallet/withdraw-quote?amount=${amount}`, {}, true),
  adminFeeConfig: () => request<FeeConfigAdmin>("/admin/fee-config", {}, true),
  updateAdminFeeConfig: (body: FeeConfigUpdate) =>
    request<FeeConfigAdmin>("/admin/fee-config", { method: "PATCH", body: JSON.stringify(body) }, true),
  runAdminLedgerReconcile: () => request<LedgerRun>("/admin/ledger/reconcile-runs", { method: "POST" }, true),
  updateAdminSiteStatus: (body: SiteStatusUpdate) =>
    request<SiteStatusAdmin>("/admin/site-status", { method: "PATCH", body: JSON.stringify(body) }, true),
  changePassword: (currentPassword: string, newPassword: string, locale: string) =>
    request<void>("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, locale }) }, true),
  changeEmail: (newEmail: string, password: string, locale: string) =>
    request<void>("/auth/change-email", { method: "POST", body: JSON.stringify({ new_email: newEmail, password, locale }) }, true),
  totpSetup: (password: string) =>
    request<TotpSetup>("/auth/2fa/setup", { method: "POST", body: JSON.stringify({ password }) }, true),
  totpEnable: (code: string) =>
    request<{ backup_codes: string[] }>("/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }, true),
  totpDisable: (password: string, code: string) =>
    request<void>("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, code }) }, true),
  totpBackupCodes: (code: string) =>
    request<{ backup_codes: string[] }>("/auth/2fa/backup-codes", { method: "POST", body: JSON.stringify({ code }) }, true),
  logoutAll: () => request<void>("/auth/logout-all", { method: "POST" }, true),
  logout: () => request<void>("/auth/session", { method: "DELETE" }),
  verifyEmail: (token: string) =>
    request<Account>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
  resendVerification: (locale: string) =>
    request<void>("/auth/verify-email/resend", { method: "POST", body: JSON.stringify({ locale }) }, true),
  resendVerificationPublic: (email: string, locale: string) =>
    request<void>("/auth/verify-email/resend-public", { method: "POST", body: JSON.stringify({ email, locale }) }),
  adminVerifyEmail: (id: number) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/verify-email`, { method: "POST" }, true),
  adminAuthConfig: () => request<AuthRuntimeConfig>("/admin/auth-config", {}, true),
  updateAdminAuthConfig: (body: Partial<Pick<AuthRuntimeConfig, "require_email_verification" | "verification_link_hours" | "mfa_feature_enabled" | "require_admin_2fa" | "require_2fa_for_withdrawal" | "turnstile_site_key">>) =>
    request<AuthRuntimeConfig>("/admin/auth-config", { method: "PATCH", body: JSON.stringify(body) }, true),
  forgotPassword: (email: string, locale: string, captchaToken?: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email, locale, captcha_token: captchaToken ?? null }),
    }),
  resetPassword: (token: string, password: string, locale: string) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password, locale }),
    }),
  me: () => request<Account>("/me", {}, "silent"),
  updateMe: (data: ProfileUpdate) => request<Account>("/me", { method: "PATCH", body: JSON.stringify(data) }, true),
  mySessions: () => request<AuthSessionRow[]>("/me/sessions", {}, true),
  revokeSession: (id: string) => request<void>(`/me/sessions/${id}`, { method: "DELETE" }, true),
  myLoginEvents: (limit = 30) => request<LoginEvent[]>(`/me/login-events?limit=${limit}`, {}, true),
  /** Raw image bytes (not multipart); prepare it with lib/media.ts first. */
  uploadMedia: (image: Blob, purpose: MediaPurpose, signal?: AbortSignal) =>
    request<UploadedMedia>(`/media/uploads?purpose=${purpose}`, {
      method: "POST",
      body: image,
      headers: { "Content-Type": image.type || "application/octet-stream" },
      signal,
    }, true),
  adminMediaStats: () => request<AdminMediaStats>("/admin/media/stats", {}, true),
  adminMedia: (params: { purpose?: MediaPurpose | ""; status?: MediaStatus | ""; owner?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params.purpose) query.set("purpose", params.purpose);
    if (params.status) query.set("status", params.status);
    if (params.owner?.trim()) query.set("owner", params.owner.trim());
    query.set("page", String(params.page ?? 1));
    return request<AdminMediaPage>(`/admin/media?${query.toString()}`, {}, true);
  },
  adminRemoveMedia: (id: string, reason: string) =>
    request<{ id: string; status: MediaStatus }>(`/admin/media/${encodeURIComponent(id)}/remove`, { method: "POST", body: JSON.stringify({ reason }) }, true),
  myApiKeys: () => request<ApiKeyList>("/account/api-keys", {}, true),
  createApiKey: (data: { name: string; scopes: ApiKeyScope[]; allowed_ips: string[] | null; daily_spend_limit: number | null }) =>
    request<ApiKeyCreated>("/account/api-keys", { method: "POST", body: JSON.stringify(data) }, true),
  updateApiKey: (id: number, data: { name?: string; allowed_ips?: string[] | null; daily_spend_limit?: number | null }) =>
    request<ApiKeyRow>(`/account/api-keys/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  revokeApiKey: (id: number) => request<void>(`/account/api-keys/${id}`, { method: "DELETE" }, true),
  mySellerProfile: () => request<MySellerProfile>("/seller/profile", {}, true),
  updateMySellerProfile: (data: { business_name?: string; description?: string; contact?: string; logo_id?: string | null; banner_id?: string | null }) =>
    request<MySellerProfile>("/seller/profile", { method: "PATCH", body: JSON.stringify(data) }, true),
  tiktokLookup: (value: string) =>
    request<TikTokLookupResponse>(`/internal/tiktok?url=${encodeURIComponent(value)}`),
  facebookLookup: (value: string, signal?: AbortSignal) =>
    request<FacebookLookupResponse>(`/internal/facebook?url=${encodeURIComponent(value)}`, { signal }),

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
  getOrCreateOrderChat: (orderId: string | number) =>
    request<ChatConversationDetail>(`/chat/orders/${orderId}`, { method: "POST" }, true),
  openMarketplaceChat: (orderId: string | number) =>
    request<ChatConversationDetail>(`/chat/orders/${orderId}/support`, { method: "POST" }, true),
  escalateMarketplaceReview: (orderId: string | number, note: string, idempotencyKey?: string) =>
    request<Dispute>(`/orders/${orderId}/dispute/escalate`, {
      method: "POST",
      body: JSON.stringify({
        note,
        idempotency_key: idempotencyKey ?? newIdempotencyKey(),
      }),
    }, true),
  /** Dispute-review and helpdesk threads for the admin desk inbox. */
  adminSupportConversations: () =>
    request<ChatConversationList>("/chat/admin/support", {}, true),
  /** The caller's standing thread with the Marketplace desk as a buyer, or
   *  for their shop; null before the first message. */
  helpdeskConversation: (role: HelpdeskRole) =>
    request<ChatConversationDetail | null>(`/chat/helpdesk?role=${role}`, {}, true),
  /** Sends to the Marketplace desk, opening that role's thread on the first message. */
  postHelpdeskMessage: (role: HelpdeskRole, body: string, clientMessageId: string, attachments: string[] = []) =>
    request<ChatConversationDetail>(`/chat/helpdesk/messages?role=${role}`, {
      method: "POST",
      body: JSON.stringify({ body, client_message_id: clientMessageId, attachments }),
    }, true),
  sendChatMessage: (conversationId: string, body: string, clientMessageId: string, attachments: string[] = []) =>
    request<ChatMessage>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, client_message_id: clientMessageId, attachments }),
    }, true),

  categories: () => request<Category[]>("/categories"),
  /** Every category (hidden ones too) with product counts — admin console only. */
  adminCategories: () => request<CategoryAdminListResponse>("/admin/categories", {}, true),
  createCategory: (data: CategoryCreateInput) =>
    request<Category>("/admin/categories", { method: "POST", body: JSON.stringify(data) }, true),
  updateCategory: (id: number, data: CategoryUpdateInput) =>
    request<Category>(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  deleteCategory: (id: number) =>
    request<void>(`/admin/categories/${id}`, { method: "DELETE" }, true),
  /** Sibling ids in the wanted order. */
  reorderCategories: (ids: number[]) =>
    request<void>("/admin/categories/reorder", { method: "POST", body: JSON.stringify({ ids }) }, true),
  // Backend luôn phân trang; categoryId lọc theo cả nhánh danh mục.
  products: (opts: {
    categoryId?: number;
    /** Seller `{handle}-{key}` or bare key. */
    seller?: string;
    search?: string;
    inStock?: boolean;
    fulfillment?: "instant" | "sla" | "api" | "task" | "proxy";
    minPrice?: number;
    maxPrice?: number;
    /** 1–5: average at least this many stars; unrated products are left out. */
    minRating?: number;
    sort?: "relevance" | "newest" | "bestseller" | "rating" | "price_asc" | "price_desc";
    page?: number;
    perPage?: number;
    signal?: AbortSignal;
  } = {}) => {
    const q = new URLSearchParams();
    if (opts.categoryId) q.set("category_id", String(opts.categoryId));
    if (opts.seller) q.set("seller", opts.seller);
    if (opts.search) q.set("search", opts.search);
    if (opts.inStock) q.set("in_stock", "true");
    if (opts.fulfillment) q.set("fulfillment", opts.fulfillment);
    if (opts.minPrice != null) q.set("min_price", String(opts.minPrice));
    if (opts.maxPrice != null) q.set("max_price", String(opts.maxPrice));
    if (opts.minRating) q.set("min_rating", String(opts.minRating));
    if (opts.sort && opts.sort !== "newest") q.set("sort", opts.sort);
    if (opts.page) q.set("page", String(opts.page));
    if (opts.perPage) q.set("per_page", String(opts.perPage));
    const qs = q.toString();
    return request<PaginatedProducts>(`/products${qs ? `?${qs}` : ""}`, { signal: opts.signal });
  },
  /** Typeahead for the command palette: a few ranked hits per group, cached briefly server-side. */
  searchSuggest: (q: string, opts: { signal?: AbortSignal } = {}) =>
    request<SearchSuggest>(`/search/suggest?q=${encodeURIComponent(q)}`, { signal: opts.signal }),
  productsBySeller: (sellerRef: string) =>
    request<PaginatedProducts>(`/products?seller=${encodeURIComponent(sellerRef)}&per_page=100`),
  /** `ref` is `{slug}-{key}`, a bare key, or a legacy numeric id. */
  product: (ref: string | number) => request<ProductDetail>(`/products/${encodeURIComponent(String(ref))}`),
  /** Trang mua của sản phẩm đang ẩn (nháp / tạm dừng / khoá) — chỉ chủ sản phẩm hoặc admin. */
  productPreview: (ref: string, as: "admin" | "seller") =>
    request<ProductDetail>(`/${as}/products/${encodeURIComponent(ref)}/preview`, {}, true),

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
  /** `orderId` may be the numeric id or the ORD-XXXXXXXX code. */
  getOrder: (orderId: string | number) => request<Order>(`/orders/${orderId}`, {}, true),
  /** `expectedUnitPrice`: the package price the buyer confirmed; a changed
   *  price is refused (ORDER_PRICE_CHANGED) before any money moves. */
  createOrder: (variantId: number, quantity: number, expectedUnitPrice?: number, promoCode?: string | null) =>
    request<Order>("/orders", {
      method: "POST",
      body: JSON.stringify({
        variant_id: variantId, quantity, expected_unit_price: expectedUnitPrice ?? null, promo_code: promoCode ?? null,
      }),
    }, true),
  /** What an order body would charge, with its promo code applied; writes nothing. */
  quoteOrder: (body: OrderRequestBody) =>
    request<OrderQuote>("/orders/quote", { method: "POST", body: JSON.stringify(body) }, true),

  confirmOrder: (orderId: string | number) =>
    request<Order>(`/orders/${orderId}/confirm`, { method: "POST" }, true),
  // `proxyLineNos` (1-based `#NN`) disputes single proxies of a proxy order;
  // `resourceIds` does the same for stock lines. Neither → whole-order case.
  openDispute: (orderId: string | number, reason: string, evidenceType?: string, evidence?: Record<string, string>, resourceIds?: number[], evidenceImages: string[] = [], proxyLineNos?: number[]) =>
    request<Dispute>(`/orders/${orderId}/dispute`, {
      method: "POST",
      body: JSON.stringify({
        reason,
        evidence_type: evidenceType ?? null,
        evidence: evidence ?? null,
        resource_ids: resourceIds ?? null,
        proxy_line_nos: proxyLineNos?.length ? proxyLineNos : null,
        idempotency_key: resourceIds?.length || proxyLineNos?.length ? newIdempotencyKey() : null,
        evidence_images: evidenceImages,
      }),
    }, true),
  appendDisputeClaims: (orderId: string | number, reason: string, resourceIds: number[], proxyLineNos: number[] = []) =>
    request<Dispute>(`/orders/${orderId}/dispute/claims`, {
      method: "POST",
      body: JSON.stringify({
        reason,
        ...(resourceIds.length ? { resource_ids: resourceIds } : {}),
        ...(proxyLineNos.length ? { proxy_line_nos: proxyLineNos } : {}),
        idempotency_key: newIdempotencyKey(),
      }),
    }, true),
  openDisputeBatched: async (
    orderId: string | number,
    reason: string,
    evidenceType?: string,
    evidence?: Record<string, string>,
    resourceIds: number[] = [],
    evidenceImages: string[] = [],
    proxyLineNos: number[] = [],
  ) => {
    const batches = chunkDisputeResourceIds(resourceIds);
    const first = batches.shift();
    let dispute = await api.openDispute(orderId, reason, evidenceType, evidence, first, evidenceImages, proxyLineNos);
    for (const batch of batches) {
      dispute = await api.appendDisputeClaims(orderId, reason, batch);
    }
    return dispute;
  },
  buyerDisputeMessage: (orderId: string | number, body: string, attachments: string[] = []) =>
    request<Dispute>(`/orders/${orderId}/dispute/messages`, { method: "POST", body: JSON.stringify({ body, idempotency_key: newIdempotencyKey(), attachments }) }, true),
  acceptDisputeResolution: (orderId: string | number) =>
    request<Dispute>(`/orders/${orderId}/dispute/accept`, { method: "POST" }, true),
  withdrawDispute: (orderId: string | number) =>
    request<Dispute>(`/orders/${orderId}/dispute/withdraw`, { method: "POST" }, true),
  orderDispute: (orderId: string | number) => request<Dispute>(`/orders/${orderId}/dispute`, {}, true),

  // An order may hold several proxies; `line` (1-based, `#NN`) picks one.
  // Omitted, the backend answers for line 1.
  orderProxyState: (orderId: string | number, line?: number) =>
    request<ProxyState>(`/orders/${orderId}/proxy${proxyLineQuery(line)}`, {}, true),
  rotateOrderProxy: (orderId: string | number, line?: number) =>
    request<ProxyRotateResult>(`/orders/${orderId}/proxy/rotate${proxyLineQuery(line)}`, { method: "POST" }, true),
  setOrderProxyWhitelist: (orderId: string | number, ips: string[], line?: number) =>
    request<ProxyWhitelistResult>(
      `/orders/${orderId}/proxy/whitelist${proxyLineQuery(line)}`,
      { method: "PUT", body: JSON.stringify({ ips }) },
      true,
    ),

  // Buyer proxy console — every delivered proxy line across the account's orders.
  // Rotate / whitelist go through the order endpoints with the line's `line_no`.
  myProxies: {
    list: (query: ProxyLineQuery = {}) => {
      const qs = new URLSearchParams();
      if (query.status) qs.set("status", query.status);
      if (query.q) qs.set("q", query.q);
      if (query.tags?.length) qs.set("tags", query.tags.join(","));
      if (query.ip_type?.length) qs.set("ip_type", query.ip_type.join(","));
      if (query.rotation?.length) qs.set("rotation", query.rotation.join(","));
      if (query.expires) qs.set("expires", query.expires);
      if (query.sort) qs.set("sort", query.sort);
      if (query.page) qs.set("page", String(query.page));
      if (query.per_page) qs.set("per_page", String(query.per_page));
      const suffix = qs.toString();
      return request<ProxyLineListResponse>(`/me/proxies${suffix ? `?${suffix}` : ""}`, {}, true);
    },
    tags: () => request<ProxyTag[]>("/me/proxy-tags", {}, true),
    createTag: (name: string, tone: ProxyTagTone) =>
      request<ProxyTag>("/me/proxy-tags", { method: "POST", body: JSON.stringify({ name, tone }) }, true),
    updateTag: (id: string, patch: { name?: string; tone?: ProxyTagTone }) =>
      request<ProxyTag>(`/me/proxy-tags/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
    deleteTag: (id: string) =>
      request<void>(`/me/proxy-tags/${encodeURIComponent(id)}`, { method: "DELETE" }, true),
    assignTags: (body: ProxyTagAssignRequest) =>
      request<{ updated: number }>("/me/proxies/tags", { method: "POST", body: JSON.stringify(body) }, true),
    setNote: (lineId: string, note: string) =>
      request<ProxyLine>("/me/proxies/note", { method: "PATCH", body: JSON.stringify({ line_id: lineId, note }) }, true),
  },

  sellerApply: (data: {
    business_name: string;
    description?: string;
    contact?: string;
    seller_type?: SellerType;
    category_ids?: number[];
    experience?: SellerExperience;
    phone?: string;
    warranty_policy?: string;
    referral_source?: SellerReferralSource;
    accept_rules?: boolean;
  }) =>
    request<SellerApplication>("/seller/apply", { method: "POST", body: JSON.stringify(data) }, true),
  /** Upcoming escrow releases by local day (`tz` = IANA zone of the viewer). */
  sellerEscrowSchedule: (tz: string) =>
    request<EscrowSchedule>(`/seller/escrow-schedule?tz=${encodeURIComponent(tz)}`, {}, true),
  mySellerApplication: () => request<SellerApplication | null>("/seller/applications/me", {}, true),
  adminSellerApplications: (params: { status?: SellerApplicationStatus; search?: string; page?: number; per_page?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") q.set(key, String(value));
    const qs = q.toString();
    return request<AdminSellerApplicationList>(`/admin/seller-applications${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminSellerApplication: (id: number) =>
    request<AdminSellerApplicationDetail>(`/admin/seller-applications/${id}`, {}, true),
  adminApproveSellerApplication: (id: number) =>
    request<AdminSellerApplicationRow>(`/admin/seller-applications/${id}/approve`, { method: "POST", keepalive: true }, true),
  /** `reason` (3..500) is mailed to the applicant; `resubmitAfterDays` > 0 blocks a new application until then. */
  adminRejectSellerApplication: (id: number, reason: string, resubmitAfterDays = 0) =>
    request<AdminSellerApplicationRow>(`/admin/seller-applications/${id}/reject`, {
      method: "POST", keepalive: true, body: JSON.stringify({ reason, resubmit_after_days: resubmitAfterDays }),
    }, true),
  /** Send a pending application back to the applicant with what to add.
   *  Decisions use `keepalive`: the console flushes a deferred decision when the page is left. */
  adminRequestSellerApplicationInfo: (id: number, note: string, fields: SellerApplicationInfoField[] = []) =>
    request<AdminSellerApplicationRow>(`/admin/seller-applications/${id}/request-info`, {
      method: "POST", keepalive: true, body: JSON.stringify({ note, fields }),
    }, true),
  adminSellerApplicationNotes: (id: number) => request<AdminNote[]>(`/admin/seller-applications/${id}/notes`, {}, true),
  adminAddSellerApplicationNote: (id: number, body: string) =>
    request<AdminNote>(`/admin/seller-applications/${id}/notes`, { method: "POST", body: JSON.stringify({ body }) }, true),

  sellerProducts: (params: {
    search?: string;
    status?: string;
    category?: string;
    categoryIds?: number[];
    serviceType?: string;
    sort?: SellerProductSort;
    page?: number;
    perPage?: number;
  } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) });
    if (params.search?.trim()) q.set("search", params.search.trim());
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.category) q.set("category", params.category);
    if (params.categoryIds?.length) q.set("category_ids", params.categoryIds.join(","));
    if (params.serviceType) q.set("service_type", params.serviceType);
    if (params.sort && params.sort !== "newest") q.set("sort", params.sort);
    return request<PaginatedSellerProducts>(`/seller/products?${q}`, {}, true);
  },
  bulkUpdateSellerProductStatus: (ids: number[], status: "active" | "paused") =>
    request<SellerProductBulkStatusResult>("/seller/products/bulk-status", {
      method: "POST", body: JSON.stringify({ ids, status }),
    }, true),
  // Như api.product() nhưng kèm cả biến thể đã tắt — trang quản lý cần thấy chúng để bật lại.
  sellerProduct: (ref: string | number, init: RequestInit = {}) => request<ProductDetail>(`/seller/products/${encodeURIComponent(String(ref))}/detail`, init, true),
  sellerStats: () => request<SellerStats>("/seller/stats", {}, true),
  sellerDashboard: (params: { range: SellerDashboardRangeKey; tz: string; from?: string; to?: string }) => {
    const q = new URLSearchParams({ range: params.range, tz: params.tz });
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    return request<SellerDashboard>(`/seller/dashboard?${q}`, {}, true);
  },
  sellerOrders: (params: SellerOrderQuery = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "" || value === "all") continue;
      q.set(key, String(value));
    }
    const query = q.toString();
    return request<PaginatedSellerOrders>(`/seller/orders${query ? `?${query}` : ""}`, {}, true);
  },
  /** Streamed CSV of the orders matching these filters (server caps the row count; audited). */
  sellerOrdersExportUrl: (params: SellerOrderQuery, includeData: boolean) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "page" || key === "per_page") continue;
      if (value === undefined || value === null || value === "" || value === "all") continue;
      q.set(key, String(value));
    }
    if (includeData) q.set("include_data", "true");
    return `/api/seller/orders/export.csv?${q}`;
  },
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
  addResources: (variantId: number, items: string[], target?: StockUploadTarget) =>
    request<RestockResult>(`/seller/variants/${variantId}/resources`, {
      method: "POST",
      body: JSON.stringify({
        items,
        ...(target && "batchId" in target ? { batch_id: target.batchId } : {}),
        ...(target && "format" in target ? { format: target.format, login_note: target.loginNote ?? null } : {}),
      }),
    }, true),
  stockBatches: (variantId: number) =>
    request<StockBatchList>(`/seller/variants/${variantId}/stock-batches`, {}, true),
  updateStockBatch: (batchId: number, data: { format?: string; login_note?: string | null; clear_note?: boolean }) =>
    request<StockBatch>(`/seller/stock-batches/${batchId}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  assignStockFormat: (variantId: number, data: { format: string; login_note?: string | null; field_count?: number; resource_ids?: number[] }) =>
    request<{ batch: StockBatch | null; count: number }>(`/seller/variants/${variantId}/stock-batches/assign`, {
      method: "POST",
      body: JSON.stringify(data),
    }, true),
  restockPreview: (variantId: number, items: string[]) =>
    request<RestockPreview>(`/seller/variants/${variantId}/resources/preview`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }, true),
  sellerVariantResources: async (variantId: number, opts: SellerResourceQuery = {}) => {
    const q = new URLSearchParams({
      page: String(opts.page ?? 1),
      per_page: String(opts.perPage ?? 25),
    });
    if (opts.status === "archived") {
      q.set("archived_only", "true");
    } else if (opts.status && opts.status !== "all") {
      q.set("status", opts.status);
    }
    if (opts.search?.trim()) q.set("search", opts.search.trim());
    if (opts.createdFrom) q.set("created_from", opts.createdFrom);
    if (opts.createdTo) q.set("created_to", opts.createdTo);
    if (opts.hasOrder === true || opts.hasOrder === false) q.set("has_order", String(opts.hasOrder));
    if (opts.sort && opts.sort !== "newest") q.set("sort", opts.sort);
    if (opts.batch) q.set("batch", opts.batch);
    const path = `/seller/variants/${variantId}/resources?${q}`;
    const headers: Record<string, string> = { "Accept-Language": browserLocale() };
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { headers, credentials: "same-origin", signal: opts.signal });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw err;
      }
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
      items: Array.isArray(body) ? body as SellerResourceRow[] : [],
      total: Number(res.headers.get("X-Total-Count") ?? (Array.isArray(body) ? body.length : 0)),
    };
  },
  inventorySummary: (params: {
    search?: string;
    stock?: string;
    productStatus?: "active" | "all";
    productId?: number;
    variantId?: number;
    page?: number;
    perPage?: number;
  } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) });
    if (params.search?.trim()) q.set("search", params.search.trim());
    if (params.stock && params.stock !== "all") q.set("stock", params.stock);
    if (params.productStatus === "all") q.set("product_status", "all");
    if (params.productId) q.set("product_id", String(params.productId));
    if (params.variantId) q.set("variant_id", String(params.variantId));
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
  /** Full content of one of the seller's stock lines; audited and rate limited. */
  revealResource: (resourceId: number) =>
    request<ResourceReveal>(`/seller/resources/${resourceId}/data`, {}, true),
  updateResource: (resourceId: number, data: string) =>
    request<SellerResourceRow>(`/seller/resources/${resourceId}`, { method: "PATCH", body: JSON.stringify({ data }) }, true),
  restockResource: (resourceId: number, data: string) =>
    request<SellerResourceRow>(`/seller/resources/${resourceId}/restock`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }, true),
  archiveResource: (resourceId: number) =>
    request<SellerResourceRow>(`/seller/resources/${resourceId}/archive`, {
      method: "POST",
    }, true),
  restoreResource: (resourceId: number) =>
    request<SellerResourceRow>(`/seller/resources/${resourceId}/restore`, {
      method: "POST",
    }, true),
  bulkResourceAction: (variantId: number, input: BulkResourceActionInput) =>
    request<BulkResourceActionResult>(`/seller/variants/${variantId}/resources/bulk-action`, {
      method: "POST",
      body: JSON.stringify({
        action: input.action,
        resource_ids: input.resourceIds ?? [],
        all_matching: Boolean(input.allMatching),
        status: input.status && input.status !== "all" && input.status !== "archived" ? input.status : undefined,
        archived_only: input.status === "archived",
        search: input.search?.trim() || undefined,
        created_from: input.createdFrom || undefined,
        created_to: input.createdTo || undefined,
        has_order: input.hasOrder === true || input.hasOrder === false ? input.hasOrder : undefined,
        batch: input.batch || undefined,
      }),
    }, true),
  // --- Inventory console (package-level) ---
  inventoryPackages: (params: {
    search?: string;
    categoryIds?: number[];
    productStatus?: InventoryProductStatusFilter;
    stock?: InventoryStockTab;
    includeInactive?: boolean;
    sort?: InventoryPackageSort;
    view?: "grouped" | "flat";
    page?: number;
    perPage?: number;
  } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 20) });
    if (params.search?.trim()) q.set("search", params.search.trim());
    if (params.categoryIds?.length) q.set("category_ids", params.categoryIds.join(","));
    if (params.productStatus && params.productStatus !== "active") q.set("product_status", params.productStatus);
    if (params.stock && params.stock !== "all") q.set("stock", params.stock);
    if (params.includeInactive) q.set("include_inactive", "true");
    if (params.sort) q.set("sort", params.sort);
    if (params.view) q.set("view", params.view);
    return request<InventoryPackagesResponse>(`/seller/inventory/packages?${q}`, {}, true);
  },
  inventoryPackage: (variantRef: string | number) =>
    request<InventoryPackageDetail>(`/seller/inventory/packages/${encodeURIComponent(String(variantRef))}`, {}, true),
  bulkPackageStatus: (variantIds: number[], isActive: boolean) =>
    request<InventoryPackageBulkStatusResult>("/seller/inventory/packages/bulk-status", {
      method: "POST",
      body: JSON.stringify({ variant_ids: variantIds, is_active: isActive }),
    }, true),
  inventoryExportPreview: (params: InventoryExportParams, limit = 20) => {
    const q = inventoryExportQuery(params);
    q.set("preview", String(limit));
    return request<InventoryExportPreview>(`/seller/inventory/export?${q}`, {}, true);
  },
  inventoryExportUrl: (params: InventoryExportParams) =>
    `/api/seller/inventory/export?${inventoryExportQuery(params)}`,
  inventoryReport: (params: InventoryReportParams) =>
    request<InventoryReportResponse>(`/seller/inventory/report?${inventoryReportQuery(params)}`, {}, true),
  inventoryReportCsvUrl: (params: InventoryReportParams) => {
    const q = inventoryReportQuery(params);
    q.set("format", "csv");
    return `/api/seller/inventory/report?${q}`;
  },
  adminAnalyticsConfig: () => request<SiteAnalyticsConfig>("/admin/analytics-config", {}, true),
  updateAdminAnalyticsConfig: (body: Pick<SiteAnalyticsConfig, "clarity_project_id">) =>
    request<SiteAnalyticsConfig>("/admin/analytics-config", { method: "PATCH", body: JSON.stringify(body) }, true),
  // ── Shared AI seam (admin) ───────────────────────────────────────────────
  adminAiConfig: () => request<AiProviderConfig>("/admin/ai/config", {}, true),
  updateAdminAiConfig: (
    // api_key is write-only: "" clears the stored secret, omitted keeps it.
    body: Partial<Omit<AiProviderConfig, "api_key_configured" | "updated_at" | "updated_by_id">> & { api_key?: string },
  ) => request<AiProviderConfig>("/admin/ai/config", { method: "PATCH", body: JSON.stringify(body) }, true),
  testAdminAiConnection: () =>
    request<AiConnectionTestResult>("/admin/ai/config/test", { method: "POST" }, true),
  adminAiPrompts: () => request<AiPromptTemplate[]>("/admin/ai/prompts", {}, true),
  adminAiUsage: (days = 7) => request<AiUsageSummary>(`/admin/ai/usage?days=${days}`, {}, true),
  updateAdminAiPrompt: (task: string, locale: string, body: { system_prompt: string; user_prompt: string }) =>
    request<AiPromptTemplate>(
      `/admin/ai/prompts/${encodeURIComponent(task)}/${encodeURIComponent(locale)}`,
      { method: "PUT", body: JSON.stringify(body) }, true,
    ),

  // ── Trust seed (admin) ───────────────────────────────────────────────────
  trustSeedGenerate: (body: {
    product_id: number; count: number;
    distribution?: Record<number, number> | null;
    locale?: string; system_override?: string | null; user_override?: string | null;
    extra_instructions?: string;
  }) => request<TrustSeedGenerateResponse>("/admin/trust-seed/generate", { method: "POST", body: JSON.stringify(body) }, true),
  trustSeedApply: (body: {
    product_id: number;
    items: { rating: number; comment: string | null; seller_reply: string | null }[];
    date_from: string; date_to: string;
    source?: "ai" | "manual"; model?: string | null; locale?: string;
    prompt_snapshot?: string | null; options_snapshot?: Record<string, unknown> | null;
    bump_sold_count?: boolean;
  }) => request<TrustSeedApplyResponse>("/admin/trust-seed/apply", { method: "POST", body: JSON.stringify(body) }, true),
  trustSeedBatches: (productId?: number) =>
    request<TrustSeedBatch[]>(
      `/admin/trust-seed/batches${productId ? `?product_id=${productId}` : ""}`, {}, true,
    ),
  trustSeedPurge: (batchId: number) =>
    request<{ batch_id: number; product_id: number; removed_reviews: number }>(
      `/admin/trust-seed/batches/${batchId}`, { method: "DELETE" }, true,
    ),
  trustSeedSummary: (productId: number) =>
    request<TrustSeedSummary>(`/admin/trust-seed/products/${productId}/summary`, {}, true),

  adminSellerConfig: () => request<SellerRuntimeConfig>("/admin/seller-config", {}, true),
  updateAdminSellerConfig: (body: Partial<Pick<SellerRuntimeConfig, "low_stock_threshold" | "inventory_export_row_limit" | "review_window_days" | "auto_review_days" | "auto_review_enabled">>) =>
    request<SellerRuntimeConfig>("/admin/seller-config", { method: "PATCH", body: JSON.stringify(body) }, true),
  adminSellerTierConfig: () => request<{ tiers: SellerTierRule[] }>("/admin/seller-tier-config", {}, true),
  updateAdminSellerTierConfig: (tiers: Partial<Record<SellerTierName, SellerTierRulePatch>>) =>
    request<{ tiers: SellerTierRule[] }>("/admin/seller-tier-config", { method: "PATCH", body: JSON.stringify({ tiers }) }, true),
  sellerTiers: () => request<{ tiers: SellerTierRule[] }>("/public/seller-tiers"),
  /** Published guides and news, in the request locale (vi fallback). */
  publicPosts: (perPage = 20) => request<PostList>(`/public/posts?per_page=${perPage}`),
  adminPosts: () => request<PostAdmin[]>("/admin/posts", {}, true),
  createAdminPost: (post: PostWrite) =>
    request<PostAdmin>("/admin/posts", { method: "POST", body: JSON.stringify(post) }, true),
  updateAdminPost: (id: number, post: PostWrite) =>
    request<PostAdmin>(`/admin/posts/${id}`, { method: "PUT", body: JSON.stringify(post) }, true),
  deleteAdminPost: (id: number) => request<void>(`/admin/posts/${id}`, { method: "DELETE" }, true),
  /** Seller › Telegram: the shop's own bot. */
  sellerTelegram: () => request<SellerTelegramState>("/seller/telegram", {}, true),
  connectSellerTelegram: (token: string, replaceWebhook = false) =>
    request<SellerTelegramState>("/seller/telegram", {
      method: "PUT", body: JSON.stringify({ token, replace_webhook: replaceWebhook }),
    }, true),
  disconnectSellerTelegram: () => request<SellerTelegramState>("/seller/telegram", { method: "DELETE" }, true),
  updateSellerTelegramEvents: (events: Partial<Record<SellerTelegramEvent, boolean>>) =>
    request<SellerTelegramState>("/seller/telegram/events", { method: "PATCH", body: JSON.stringify({ events }) }, true),
  startSellerTelegramLink: () => request<SellerTelegramLinkCode>("/seller/telegram/link", { method: "POST" }, true),
  pollSellerTelegramLink: () => request<SellerTelegramLinkStatus>("/seller/telegram/link", {}, true),
  confirmSellerTelegramChat: (key: string) =>
    request<SellerTelegramState>(`/seller/telegram/chats/${encodeURIComponent(key)}/confirm`, { method: "POST" }, true),
  removeSellerTelegramChat: (key: string) =>
    request<SellerTelegramState>(`/seller/telegram/chats/${encodeURIComponent(key)}`, { method: "DELETE" }, true),
  testSellerTelegram: () =>
    request<{ delivered: string[]; failed: string[] }>("/seller/telegram/test", { method: "POST" }, true),
  /** The signed-in seller's trust score and progress toward the next tier. */
  sellerTierProgress: () => request<SellerTierProgress>("/seller/tier-progress", {}, true),
  adminSellerTrustConfig: () => request<SellerTrustConfig>("/admin/seller-trust-config", {}, true),
  updateAdminSellerTrustConfig: (config: SellerTrustConfig) =>
    request<SellerTrustConfig>("/admin/seller-trust-config", { method: "PUT", body: JSON.stringify(config) }, true),
  /** Every active seller's evaluation: eligible for the next tier or slipping, first. */
  adminSellerTierReview: () => request<SellerTierReviewRow[]>("/admin/seller-tier-review", {}, true),
  deleteResource: (resourceId: number) =>
    request<void>(`/seller/resources/${resourceId}`, { method: "DELETE" }, true),
  sellerAcceptOrder: (orderId: string | number) =>
    request<Order>(`/seller/orders/${orderId}/accept`, { method: "POST" }, true),
  sellerDeliverOrder: (orderId: string | number, data: string) =>
    request<Order>(`/seller/orders/${orderId}/deliver`, { method: "POST", body: JSON.stringify({ data }) }, true),

  productOperations: (id: number) => request<ProductOperations>(`/products/${id}/operations`, {}, true),
  productProxyPlans: (id: number) => request<ProxyProductPlans>(`/products/${id}/proxy-plans`, {}, true),
  quoteProductProxyPlans: (id: number, plans: { type: string; network: string; days: number; price?: number | null }[]) =>
    request<ProxyPlanRow[]>(`/products/${id}/proxy-plans/quote`, { method: "POST", body: JSON.stringify({ plans }) }, true),

  adminBusinessAnalytics: (params: BusinessAnalyticsQuery, init: RequestInit = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      q.set(key, String(value));
    }
    return request<BusinessAnalytics>(`/admin/analytics/business?${q}`, init, true);
  },
  adminBusinessFilterOptions: () => request<BusinessFilterOptions>("/admin/analytics/business/filters", {}, true),
  /** Tài chính › Dòng tiền — every ledger row, keyset-paged (read-only). */
  adminLedgerEntries: (params: LedgerQueryParams & { cursor?: string | null; limit?: number }) =>
    request<LedgerPage>(`/admin/ledger/entries${ledgerQueryString(params)}`, {}, true),
  adminLedgerSummary: (params: LedgerQueryParams) =>
    request<LedgerSummary>(`/admin/ledger/summary${ledgerQueryString(params)}`, {}, true),
  adminLedgerStatement: (accountId: number, params: { start?: string; end?: string }) =>
    request<LedgerStatement>(`/admin/ledger/accounts/${accountId}/statement${ledgerQueryString(params)}`, {}, true),
  adminLedgerGroup: (key: string) =>
    request<LedgerGroup>(`/admin/ledger/groups/${encodeURIComponent(key)}`, {}, true),
  adminLedgerSearch: (q: string) =>
    request<LedgerSuggestion[]>(`/admin/ledger/search?q=${encodeURIComponent(q)}`, {}, true),
  /** Tài chính › Báo cáo — period P&L, held-money balance, close, export. */
  adminFinanceReport: (range: { start: string; end: string }) =>
    request<FinanceReport>(`/admin/finance/report${ledgerQueryString(range)}`, {}, true),
  adminFinanceCloseChecklist: (range: { start: string; end: string }) =>
    request<FinanceCloseChecklist>(`/admin/finance/close-checklist${ledgerQueryString(range)}`, {}, true),
  adminFinanceCloses: () => request<FinancePeriodClose[]>("/admin/finance/closes", {}, true),
  adminFinanceClosePeriod: (body: { start: string; end: string; note?: string }) =>
    request<FinancePeriodClose>("/admin/finance/closes", { method: "POST", body: JSON.stringify(body) }, true),
  /** Same-origin BFF URL of the accountant ZIP for a period. */
  adminFinanceExportUrl: (range: { start: string; end: string }) => `/api/admin/finance/export.zip${ledgerQueryString(range)}`,
  adminProducts: (params: {
    search?: string;
    status?: string;
    seller?: string;
    provider?: string;
    serviceType?: string;
    hasProvider?: boolean;
    /** Category and its whole branch, hidden sub-categories included. */
    categoryId?: number;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    page?: number;
    perPage?: number;
  } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) });
    if (params.categoryId) q.set("category_id", String(params.categoryId));
    if (params.search?.trim()) q.set("search", params.search.trim());
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.seller) q.set("seller", params.seller);
    if (params.provider) q.set("provider", params.provider);
    if (params.serviceType) q.set("service_type", params.serviceType);
    if (params.hasProvider === true) q.set("has_provider", "true");
    if (params.hasProvider === false) q.set("has_provider", "false");
    if (params.sortBy) q.set("sort_by", params.sortBy);
    if (params.sortDir) q.set("sort_dir", params.sortDir);
    return request<PaginatedAdminProducts>(`/admin/products?${q}`, {}, true);
  },
  // Bản duy nhất còn commission_rate — trường này đã rút khỏi GET /products{,/{id}}.
  adminProduct: (id: number) => request<AdminProductDetail>(`/admin/products/${id}`, {}, true),
  adminSetProductApi: (id: number, enabled: boolean) =>
    request<{ api_enabled: boolean }>(`/admin/products/${id}/api`, {
      method: "PATCH", body: JSON.stringify({ api_enabled: enabled }),
    }, true),
  adminUpdateProduct: (id: number, data: Record<string, unknown>) =>
    request<Product>(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  adminBulkProducts: (data: { ids: number[]; action: AdminProductBulkAction; category_id?: number; reason?: string }) =>
    request<AdminProductBulkResult>("/admin/products/bulk", { method: "POST", body: JSON.stringify(data) }, true),
  adminSuspendProduct: (id: number, reason?: string) =>
    request<Product>(`/admin/products/${id}/suspend`, { method: "POST", body: JSON.stringify({ reason: reason || null }) }, true),
  adminProductActivity: (id: number) => request<AdminProductActivity[]>(`/admin/products/${id}/activity`, {}, true),
  adminUpdateProductTranslation: (id: number, locale: ProductLocale, data: ProductTranslation) =>
    request<Product>(`/admin/products/${id}/translations/${locale}`, { method: "PATCH", body: JSON.stringify(data) }, true),
  adminAccounts: (params?: AdminAccountsQuery) =>
    request<PaginatedAccounts>(`/admin/accounts${accountsQueryString(params)}`, {}, true),
  /** Same-origin BFF URL of the CSV export for these filters (or just `ids`). Server caps at 10 000 rows. */
  adminAccountsExportUrl: (params?: AdminAccountsQuery & { ids?: number[] }) =>
    `/api/admin/accounts/export.csv${accountsQueryString(params)}`,
  adminBulkAccountStatus: (ids: number[], active: boolean, reason?: string) =>
    request<AccountBulkStatusResult>("/admin/accounts/bulk-status", {
      method: "POST", body: JSON.stringify({ ids, active, reason: reason || null }),
    }, true),
  adminAccountOverview: (id: number) => request<AccountOverview>(`/admin/accounts/${id}/overview`, {}, true),
  adminRevokeAccountSessions: (id: number) =>
    request<{ revoked: number }>(`/admin/accounts/${id}/sessions/revoke`, { method: "POST" }, true),
  adminSendPasswordReset: (id: number) =>
    request<void>(`/admin/accounts/${id}/password-reset`, { method: "POST" }, true),
  adminWalletDebit: (id: number, amount: number, reason: string, proofMediaIds: string[] = []) =>
    request<unknown>(`/admin/accounts/${id}/wallet-debit`, {
      method: "POST", body: JSON.stringify({ amount, reason, proof_media_ids: proofMediaIds }),
    }, true),
  adminAccountDisputes: (id: number) => request<Dispute[] | PaginatedDisputes>(`/admin/accounts/${id}/disputes`, {}, true),
  adminAccountNotes: (id: number) => request<AdminNote[]>(`/admin/accounts/${id}/notes`, {}, true),
  adminAddAccountNote: (id: number, body: string) =>
    request<AdminNote>(`/admin/accounts/${id}/notes`, { method: "POST", body: JSON.stringify({ body }) }, true),
  adminUpdateInternal: (id: number, isInternal: boolean) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/internal`, {
      method: "PATCH", body: JSON.stringify({ is_internal: isInternal }),
    }, true),
  adminUpdateApiAccess: (id: number, enabled: boolean) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/api-access`, {
      method: "PATCH", body: JSON.stringify({ api_access_enabled: enabled }),
    }, true),
  /** 409 `seller_has_activity` when removing "seller" from an active shop; resend with `confirm`. */
  adminUpdateRoles: (id: number, roles: string[], confirm = false) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/roles`, {
      method: "PATCH", body: JSON.stringify(confirm ? { roles, confirm: true } : { roles }),
    }, true),
  /** `reason` is kept in the seller's tier history and the audit log. */
  adminUpdateSellerTier: (id: number, sellerTier: string, reason?: string) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/tier`, { method: "PATCH", body: JSON.stringify({ seller_tier: sellerTier, reason: reason ?? null }) }, true),
  /** One seller's score, criteria and tier history, computed now. */
  adminSellerTierDetail: (id: number) => request<SellerTierDetail>(`/admin/sellers/${id}/tier-detail`, {}, true),
  adminOrders: (params: AdminOrderQuery = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      q.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    const qs = q.toString();
    return request<AdminOrderPage>(`/admin/orders${qs ? `?${qs}` : ""}`, {}, true);
  },
  adminOrdersOverview: (params: { tz: string; days?: number }) => {
    const q = new URLSearchParams({ tz: params.tz });
    if (params.days) q.set("days", String(params.days));
    return request<AdminOrdersOverview>(`/admin/orders/overview?${q}`, {}, true);
  },
  adminOrderDetail: (orderId: string | number) => request<AdminOrderDetail>(`/admin/orders/${orderId}`, {}, true),
  adminOrderCase: (orderId: number) => request<AdminOrderCase>(`/admin/orders/${orderId}/case`, {}, true),
  adminReleaseOrder: (orderId: number, note: string) =>
    request<void>(`/admin/orders/${orderId}/release`, { method: "POST", body: JSON.stringify({ note }) }, true),
  adminRefundOrder: (orderId: number, note: string, buyerMessage?: string) =>
    request<void>(`/admin/orders/${orderId}/refund`, { method: "POST", body: JSON.stringify({ note, buyer_message: buyerMessage || null }) }, true),
  adminExtendEscrow: (orderId: number, days: number, note: string) =>
    request<void>(`/admin/orders/${orderId}/extend-escrow`, { method: "POST", body: JSON.stringify({ days, note }) }, true),
  adminRetryProvision: (orderId: number, note?: string) =>
    request<{ status: string }>(`/admin/orders/${orderId}/retry-provision`, { method: "POST", body: JSON.stringify({ note: note || null }) }, true),
  adminRevokeGatewayKey: (orderId: number) =>
    request<unknown>(`/admin/orders/${orderId}/gateway-key/revoke`, { method: "POST" }, true),
  adminOrderNote: (orderId: number, note: string) =>
    request<AdminLogEntry>(`/admin/orders/${orderId}/notes`, { method: "POST", body: JSON.stringify({ note }) }, true),
  adminAlerts: (status: "open" | "resolved" = "open") => request<AdminAlert[]>(`/admin/alerts?status=${status}`, {}, true),
  dismissAlert: (id: number) => request<AdminAlert>(`/admin/alerts/${id}/dismiss`, { method: "POST" }, true),
  resolveAlerts: (ids: number[], note?: string) =>
    request<AdminAlert[]>("/admin/alerts/resolve", { method: "POST", body: JSON.stringify({ ids, note: note || null }) }, true),
  reopenAlert: (id: number) => request<AdminAlert>(`/admin/alerts/${id}/reopen`, { method: "POST" }, true),
  adminAccount: (id: number) => request<AccountAdminRow>(`/admin/accounts/${id}`, {}, true),
  dismissSellerAlert: (id: number) => request<Alert>(`/seller/alerts/${id}/dismiss`, { method: "POST" }, true),
  dismissOwnAlert: (id: number) => request<Alert>(`/me/alerts/${id}/dismiss`, { method: "POST" }, true),
  accountActionItems: () => request<ActionItem[]>("/me/action-items", {}, true),
  notifications: (opts: { category?: NotificationCategory; unreadOnly?: boolean; before?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.category) qs.set("category", opts.category);
    if (opts.unreadOnly) qs.set("unread_only", "true");
    if (opts.before) qs.set("before", String(opts.before));
    if (opts.limit) qs.set("limit", String(opts.limit));
    const query = qs.toString();
    return request<NotificationPage>(`/me/notifications${query ? `?${query}` : ""}`, {}, true);
  },
  notificationCounts: () => request<NotificationCounts>("/me/notifications/unread", {}, true),
  /** Rows by id, a whole category, or (neither) everything. */
  markNotificationsRead: (body: { ids?: number[]; category?: NotificationCategory } = {}) =>
    request<NotificationCounts>("/me/notifications/read", { method: "POST", body: JSON.stringify(body) }, true),
  buyerActionItems: () => request<ActionItem[]>("/orders/action-items", {}, true),
  sellerActionItems: () => request<ActionItem[]>("/seller/action-items", {}, true),
  adminActionItems: () => request<ActionItem[]>("/admin/action-items", {}, true),
  adminDisputes: (page = 1, perPage = 100) =>
    request<PaginatedDisputes>(`/admin/disputes?page=${page}&per_page=${perPage}`, {}, true),
  adminDisputeDetail: (id: number) => request<AdminDisputeDetail>(`/admin/disputes/${id}`, {}, true),
  adminDisputeCase: (id: number) => request<AdminDisputeCase>(`/admin/disputes/${id}/case`, {}, true),
  adminLogsFor: (params: { order_id?: number; dispute_id?: number; account_id?: number; event?: string; limit?: number }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    return request<AdminLogEntry[]>(`/admin/logs?${q}`, {}, true);
  },
  adminRelatedLogs: (id: number) => request<AdminLogEntry[]>(`/admin/logs/${id}/related`, {}, true),
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
  /** Admin per-line proxy refund; same body as the seller action (the note goes in `seller_note`). */
  adminRefundDisputeProxies: (id: number, lineNos: number[], idempotencyKey: string, note?: string) =>
    request<Dispute>(`/admin/disputes/${id}/proxies/refund`, {
      method: "POST",
      body: JSON.stringify({ line_nos: lineNos, action: "refund", idempotency_key: idempotencyKey, seller_note: note ?? null }),
    }, true),
  adminWithdrawals: () => request<WithdrawRequest[]>("/admin/withdrawals", {}, true),
  approveWithdrawal: (id: number) => request<WithdrawRequest>(`/admin/withdrawals/${id}/approve`, { method: "POST" }, true),
  rejectWithdrawal: (id: number, reason: string) =>
    request<WithdrawRequest>(`/admin/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, true),
  requestWithdraw: (amount: number, bank: { bank_name: string; bank_account_number: string; bank_account_holder: string; bank_bin?: string; totp_code?: string }) =>
    request<WithdrawRequest>("/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount, ...bank }) }, true),
  markWithdrawalPaid: (id: number, payoutReference: string, receiptImages: string[] = []) =>
    request<WithdrawRequest>(`/admin/withdrawals/${id}/paid`, { method: "POST", body: JSON.stringify({ payout_reference: payoutReference, receipt_images: receiptImages }) }, true),
  myWithdrawals: () => request<WithdrawRequest[]>("/wallet/withdrawals", {}, true),
  // --- Nạp tiền: chuyển khoản (SePay) / USDT (NOWPayments) (src/payments) ---
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
  bankDepositAccount: () => request<BankDepositAccount>("/wallet/deposit-account", {}, true),
  myDeposits: (limit = 20) => request<DepositIntent[]>(`/wallet/deposits/me?limit=${limit}`, {}, true),
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
    if (query.attention) params.set("attention", "true");
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
  adminUnmatchedTransfers: () => request<UnmatchedTransfer[]>("/admin/sepay-events/unmatched", {}, true),
  adminAssignUnmatchedTransfer: (id: number, target: string, note?: string) =>
    request<{ id: number; resolution: string; account_id: number; amount: number }>(
      `/admin/sepay-events/${id}/assign`,
      { method: "POST", body: JSON.stringify({ target, note: note || null }) },
      true,
    ),
  adminDismissUnmatchedTransfer: (id: number, note: string) =>
    request<{ id: number; resolution: string }>(
      `/admin/sepay-events/${id}/dismiss`,
      { method: "POST", body: JSON.stringify({ note }) },
      true,
    ),
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
  adminTopup: (accountId: number, amount: number, reason: string, proofImages: string[] = []) =>
    request<Wallet>("/wallet/topup", { method: "POST", body: JSON.stringify({ account_id: accountId, amount, reason, proof_images: proofImages }) }, true),
  adminSetAccountStatus: (id: number, isActive: boolean, reason?: string) =>
    request<AccountAdminRow>(`/admin/accounts/${id}/status`, { method: "PATCH", body: JSON.stringify({ is_active: isActive, reason: reason || null }) }, true),
  adminLoginEvents: (id: number, limit = 50) =>
    request<LoginEvent[]>(`/admin/accounts/${id}/login-events?limit=${limit}`, {}, true),
  adminAffiliateConfig: () => request<AffiliateRuntimeConfig>("/admin/affiliate-config", {}, true),
  updateAdminAffiliateConfig: (body: Partial<Pick<AffiliateRuntimeConfig, "enabled" | "commission_percent_of_fee" | "attribution_days" | "earning_days" | "max_commissions_per_day">>) =>
    request<AffiliateRuntimeConfig>("/admin/affiliate-config", { method: "PATCH", body: JSON.stringify(body) }, true),
  publicAffiliateConfig: () => request<PublicAffiliateConfig>("/public/affiliate-config"),
  adminContentFilter: () => request<ContentFilterConfig>("/admin/content-filter", {}, true),
  updateAdminContentFilter: (body: Partial<Pick<ContentFilterConfig, "enabled" | "action" | "keywords" | "block_phone_numbers" | "block_links" | "mask_char">>) =>
    request<ContentFilterConfig>("/admin/content-filter", { method: "PATCH", body: JSON.stringify(body) }, true),
  testAdminContentFilter: (text: string) =>
    request<ContentFilterTestResult>("/admin/content-filter/test", { method: "POST", body: JSON.stringify({ text }) }, true),
  topSellers: (limit = 6) => request<SellerSummary[]>(`/sellers/top?limit=${limit}`),
  /** `ref` is `{handle}-{key}`, a bare key, or a legacy account id. */
  sellerProfile: (ref: string | number) => request<SellerProfile>(`/sellers/${encodeURIComponent(String(ref))}`),
  sellerDispute: (orderId: string | number) => request<Dispute>(`/seller/orders/${orderId}/dispute`, {}, true),
  sellerRespondDispute: (disputeId: number, sellerNote: string, attachments: string[] = []) =>
    request<Dispute>(`/seller/disputes/${disputeId}/respond`, { method: "POST", body: JSON.stringify({ seller_note: sellerNote, attachments }) }, true),
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
  /** Every proxy line of a disputed proxy order, with its claim/remedy state. */
  sellerDisputeProxies: (disputeId: number) =>
    request<{ items: SellerDisputeProxyLine[] }>(`/seller/disputes/${disputeId}/proxies`, {}, true),
  /** Refund (and revoke) claimed proxy lines. Reuse `idempotencyKey` when retrying the same batch. */
  sellerRefundDisputeProxies: (disputeId: number, lineNos: number[], idempotencyKey: string, note?: string) =>
    request<Dispute>(`/seller/disputes/${disputeId}/proxies/action`, {
      method: "POST",
      body: JSON.stringify({ line_nos: lineNos, action: "refund", idempotency_key: idempotencyKey, seller_note: note ?? null }),
    }, true),
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

  // Nguồn hàng — cùng handler cho seller (/seller/sources) và admin (/admin/sources).
  sources: {
    list: (area: SourceArea) => request<SupplierSource[]>(`/${area}/sources`, {}, true),
    catalog: (area: SourceArea, id: number | string, query: SourceCatalogQuery = {}) => {
      const qs = new URLSearchParams();
      if (query.q) qs.set("q", query.q);
      if (query.group) qs.set("group", query.group);
      if (query.in_stock === false) qs.set("in_stock", "false");
      if (query.max_cost != null) qs.set("max_cost", String(query.max_cost));
      if (query.page) qs.set("page", String(query.page));
      if (query.per_page) qs.set("per_page", String(query.per_page));
      if (query.sort) qs.set("sort", query.sort);
      const suffix = qs.toString();
      return request<SourceCatalogPage>(`/${area}/sources/${id}/catalog${suffix ? `?${suffix}` : ""}`, {}, true);
    },
    sync: (area: SourceArea, id: number | string) =>
      request<SourceSyncResult>(`/${area}/sources/${id}/sync`, { method: "POST" }, true),
    listings: (area: SourceArea, id: number | string) => request<SourceListing[]>(`/${area}/sources/${id}/listings`, {}, true),
    import: (area: SourceArea, id: number | string, items: SourceImportItem[], ownerSellerId?: number | null) =>
      request<SourceImportResult[]>(`/${area}/sources/${id}/import`, {
        method: "POST", body: JSON.stringify({ items, owner_seller_id: ownerSellerId ?? null }),
      }, true),
    attach: (area: SourceArea, id: number | string, variantId: number, externalId: string) =>
      request<{ listing_id: number; variant_id: number; external_id: string }>(`/${area}/sources/${id}/attach`, {
        method: "POST", body: JSON.stringify({ variant_id: variantId, external_id: externalId }),
      }, true),
    reprice: (area: SourceArea, id: number | string, body: SourceRepriceRequest) =>
      request<SourceRepriceResult>(`/${area}/sources/${id}/reprice`, { method: "POST", body: JSON.stringify(body) }, true),
    purchases: (area: SourceArea, id: number | string, query: SourcePurchaseQuery = {}) => {
      const qs = new URLSearchParams();
      if (query.days) qs.set("days", String(query.days));
      if (query.result && query.result !== "all") qs.set("result", query.result);
      if (query.q) qs.set("q", query.q);
      if (query.page) qs.set("page", String(query.page));
      if (query.per_page) qs.set("per_page", String(query.per_page));
      const suffix = qs.toString();
      return request<SourcePurchasePage>(`/${area}/sources/${id}/purchases${suffix ? `?${suffix}` : ""}`, {}, true);
    },
    settings: (area: SourceArea, id: number | string) => request<SourceSettings>(`/${area}/sources/${id}/settings`, {}, true),
    updateSettings: (area: SourceArea, id: number | string, body: SourceSettingsUpdate) =>
      request<SourceSettings>(`/${area}/sources/${id}/settings`, { method: "PATCH", body: JSON.stringify(body) }, true),
    gateway: (area: SourceArea, id: number | string) => request<GatewayOverview>(`/${area}/sources/${id}/gateway`, {}, true),
    updatePackages: (area: SourceArea, id: number | string, body: GatewayPackagesUpdate) =>
      request<GatewayOverview>(`/${area}/sources/${id}/packages`, { method: "PUT", body: JSON.stringify(body) }, true),
    tryEndpoint: (area: SourceArea, id: number | string, endpoint: string, body: Record<string, unknown>) =>
      request<GatewayTryResult>(`/${area}/sources/${id}/try`, { method: "POST", body: JSON.stringify({ endpoint, body }) }, true),
    requests: (area: SourceArea, id: number | string, query: { hours?: 24 | 168; result?: "all" | "ok" | "error"; q?: string; page?: number } = {}) => {
      const qs = new URLSearchParams();
      if (query.hours) qs.set("hours", String(query.hours));
      if (query.result && query.result !== "all") qs.set("result", query.result);
      if (query.q) qs.set("q", query.q);
      if (query.page) qs.set("page", String(query.page));
      const suffix = qs.toString();
      return request<GatewayRequestPage>(`/${area}/sources/${id}/requests${suffix ? `?${suffix}` : ""}`, {}, true);
    },
    testSaved: (id: number) =>
      request<SourceTestResult>(`/admin/sources/${id}/test`, { method: "POST" }, true),
    // Nguồn proxy: gói đang bán (pricing config) thay cho listings.
    offers: (area: SourceArea, id: number | string) => request<SourceOffer[]>(`/${area}/sources/${id}/offers`, {}, true),
    importPlans: (area: SourceArea, id: number | string, items: SourcePlanImportItem[], ownerSellerId?: number | null) =>
      request<SourcePlanImportResult[]>(`/${area}/sources/${id}/import-plans`, {
        method: "POST", body: JSON.stringify({ items, owner_seller_id: ownerSellerId ?? null }),
      }, true),
    updateOffer: (area: SourceArea, id: number | string, body: { product_id: number; plan_key: string; price: number }) =>
      request<SourceOffer>(`/${area}/sources/${id}/offers`, { method: "PATCH", body: JSON.stringify(body) }, true),
    removeOffer: (area: SourceArea, id: number | string, body: { product_id: number; plan_key: string }) =>
      request<void>(`/${area}/sources/${id}/offers/remove`, { method: "POST", body: JSON.stringify(body) }, true),
    repriceOffers: (area: SourceArea, id: number | string, body: { margin_pct: number; round_to?: number; product_id?: number }) =>
      request<{ updated: number; skipped: number }>(`/${area}/sources/${id}/offers/reprice`, { method: "POST", body: JSON.stringify(body) }, true),
    kinds: () => request<SourceKind[]>(`/admin/sources/kinds`, {}, true),
    sellers: () => request<SourceSellerCandidate[]>(`/admin/sources/sellers`, {}, true),
    test: (adapterType: string, config: Record<string, string | number>) =>
      request<SourceTestResult>(`/admin/sources/test`, {
        method: "POST", body: JSON.stringify({ adapter_type: adapterType, config }),
      }, true),
    create: (body: SourceCreateRequest) =>
      request<SourceCreateResult>(`/admin/sources`, { method: "POST", body: JSON.stringify(body) }, true),
    updateListing: (area: SourceArea, listingId: number, body: SourceListingUpdate) =>
      request<SourceListing>(`/${area}/sources/listings/${listingId}`, { method: "PATCH", body: JSON.stringify(body) }, true),
    detach: (area: SourceArea, listingId: number) =>
      request<void>(`/${area}/sources/listings/${listingId}`, { method: "DELETE" }, true),
  },

  submitReview: (orderId: string | number, rating: number, comment?: string) =>
    request<Review>(`/orders/${orderId}/review`, { method: "POST", body: JSON.stringify({ rating, comment: comment || null }) }, true),
  productReviews: (productId: number, params: { page?: number; perPage?: number; rating?: number | null } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 5) });
    if (params.rating) q.set("rating", String(params.rating));
    return request<PublicReviewList>(`/products/${productId}/reviews?${q}`);
  },
  latestReviews: (limit = 6) => request<ShowcaseReview[]>(`/reviews/latest?limit=${limit}`),
  sellerPublicReviews: (sellerRef: string, params: { page?: number; perPage?: number; rating?: number | null } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 6) });
    if (params.rating) q.set("rating", String(params.rating));
    return request<SellerPublicReviewList>(`/sellers/${encodeURIComponent(sellerRef)}/reviews?${q}`);
  },
  marketplaceStats: () => request<MarketplaceStats>("/public/marketplace-stats"),
  categoryContent: (ref: string) => request<CategoryContentPublic>(`/categories/${encodeURIComponent(ref)}/content`),
  adminCategoryContent: (id: number) => request<CategoryContentAdmin>(`/admin/categories/${id}/content`, {}, true),
  sellerReviews: (params: { productId?: number; unrepliedOnly?: boolean; page?: number; perPage?: number } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 20) });
    if (params.productId) q.set("product_id", String(params.productId));
    if (params.unrepliedOnly) q.set("unreplied_only", "true");
    return request<SellerReviewList>(`/seller/reviews?${q}`, {}, true);
  },
  sellerReplyReview: (reviewId: number, body: string) =>
    request<SellerReview>(`/seller/reviews/${reviewId}/reply`, { method: "PUT", body: JSON.stringify({ body }) }, true),
  sellerDeleteReviewReply: (reviewId: number) =>
    request<SellerReview>(`/seller/reviews/${reviewId}/reply`, { method: "DELETE" }, true),
  productQuestions: (productId: number, page = 1) =>
    request<PublicQuestionList>(`/products/${productId}/questions?page=${page}`),
  myProductQuestions: (productId: number) =>
    request<MyQuestion[]>(`/products/${productId}/questions/mine`, {}, true),
  askProductQuestion: (productId: number, question: string) =>
    request<MyQuestion>(`/products/${productId}/questions`, { method: "POST", body: JSON.stringify({ question }) }, true),
  /** Dry run of the listing text filter: "phone", "link" or a restricted word. */
  sellerContentCheck: (text: string) =>
    request<{ matches: string[] }>("/seller/content-check", { method: "POST", body: JSON.stringify({ text }) }),
  sellerQuestions: (status: "all" | QuestionStatus = "all", page = 1) =>
    request<SellerQuestionList>(`/seller/questions?status=${status}&page=${page}`, {}, true),
  answerQuestion: (questionId: number, answer: string) =>
    request<SellerQuestion>(`/seller/questions/${questionId}/answer`, { method: "PUT", body: JSON.stringify({ answer }) }, true),
  setSellerQuestionVisibility: (questionId: number, hidden: boolean) =>
    request<SellerQuestion>(`/seller/questions/${questionId}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden }) }, true),
  adminQuestions: (status: "all" | QuestionStatus = "all", page = 1) =>
    request<SellerQuestionList>(`/admin/questions?status=${status}&page=${page}`, {}, true),
  setAdminQuestionVisibility: (questionId: number, hidden: boolean) =>
    request<SellerQuestion>(`/admin/questions/${questionId}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden }) }, true),
  adminReviews: (params: { productId?: number; hidden?: boolean; page?: number; perPage?: number } = {}) => {
    const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.perPage ?? 20) });
    if (params.productId) q.set("product_id", String(params.productId));
    if (params.hidden != null) q.set("hidden", String(params.hidden));
    return request<AdminReviewList>(`/admin/reviews?${q}`, {}, true);
  },
  adminSetReviewVisibility: (reviewId: number, hidden: boolean, reason?: string) =>
    request<AdminReview>(`/admin/reviews/${reviewId}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden, reason: reason || null }) }, true),

  orderDashboard: (orderId: string | number) => request<DashboardData>(`/orders/${orderId}/dashboard`, {}, true),
  gatewayTry: (orderId: string | number, endpoint: string, body: Record<string, unknown>) =>
    request<GatewayTryResult>(`/orders/${orderId}/gateway/try`, { method: "POST", body: JSON.stringify({ endpoint, body }) }, true),
  rotateGatewayKey: (orderId: string | number) =>
    request<{ gateway_key: string; gateway_key_prefix: string }>(`/orders/${orderId}/gateway-key/rotate`, { method: "POST" }, true),
  chargeUsage: (orderId: string | number, endpoint: string, units = 1) =>
    request<ChargeUsageResult>(`/orders/${orderId}/usage`, { method: "POST", body: JSON.stringify({ endpoint, units }) }, true),
  /** One page of an order's delivered lines (id order, `line_no` 1-based). */
  orderResources: (orderId: string | number, params: { after?: number | null; limit?: number; ids?: number[] } = {}) => {
    const q = new URLSearchParams();
    if (params.after) q.set("after", String(params.after));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.ids) q.set("ids", params.ids.join(","));
    const qs = q.toString();
    return request<OrderResourcePage>(`/orders/${orderId}/resources${qs ? `?${qs}` : ""}`, {}, true);
  },
  /** Every delivered line of an order as a streamed .txt (buyer or seller; audited). */
  orderDeliveryUrl: (orderId: string | number) => `/api/orders/${encodeURIComponent(String(orderId))}/delivery.txt`,
  /** One delivered line in full (lists carry only the head of a long one). */
  orderLineUrl: (orderId: string | number, resourceId: number) =>
    `/api/orders/${encodeURIComponent(String(orderId))}/resources/${resourceId}/data.txt`,
  markResourceError: (resourceId: number) => request<SellerResourceRow>(`/seller/resources/${resourceId}/error`, { method: "POST" }, true),
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
  createOrderWithConfig: (productId: number, userConfig: Record<string, unknown>, quantity: number, promoCode?: string | null) =>
    request<Order>("/orders", {
      method: "POST",
      body: JSON.stringify({ product_id: productId, user_config: userConfig, quantity, promo_code: promoCode ?? null }),
    }, true),

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
    account_id?: number;
    dispute_id?: number;
    event?: string;
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
    if (params.account_id != null) q.set("account_id", String(params.account_id));
    if (params.dispute_id != null) q.set("dispute_id", String(params.dispute_id));
    if (params.event) q.set("event", params.event);
    if (params.level) q.set("level", params.level);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.before_id != null) q.set("before_id", String(params.before_id));
    if (params.since) q.set("since", params.since);
    if (params.until) q.set("until", params.until);
    const qs = q.toString();
    return request<AdminLogEntry[]>(`/admin/logs${qs ? `?${qs}` : ""}`, {}, true);
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
  adminAffiliates: (params?: { search?: string; page?: number; per_page?: number; sort?: AffiliateSort; active_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.per_page) q.set("per_page", String(params.per_page));
    if (params?.sort) q.set("sort", params.sort);
    if (params?.active_only) q.set("active_only", "true");
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
  adminMailOutbox: (query?: {
    status?: string;
    template?: string;
    to_email?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    params.set("limit", String(query?.limit ?? 25));
    params.set("offset", String(query?.offset ?? 0));
    if (query?.status) params.set("status", query.status);
    if (query?.template) params.set("template", query.template);
    if (query?.to_email) params.set("to_email", query.to_email);
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
  adminSearchQueries: (params: { days?: number; limit?: number; zero_only?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.days) qs.set("days", String(params.days));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.zero_only) qs.set("zero_only", "true");
    const suffix = qs.toString();
    return request<{ days: number; items: SearchQueryStat[] }>(`/admin/search/queries${suffix ? `?${suffix}` : ""}`, {}, true);
  },
  adminSearchSynonyms: () => request<{ items: SearchSynonymGroup[] }>("/admin/search/synonyms", {}, true),
  adminUpsertSearchSynonyms: (body: SearchSynonymGroup) =>
    request<SearchSynonymGroup>("/admin/search/synonyms", { method: "PUT", body: JSON.stringify(body) }, true),
  adminDeleteSearchSynonyms: (groupKey: string) =>
    request<void>(`/admin/search/synonyms/${encodeURIComponent(groupKey)}`, { method: "DELETE" }, true),

  adminPromotions: (params?: AdminPromotionQuery) =>
    request<AdminPromotionPage>(`/admin/promotions${queryString(params)}`, {}, true),
  adminPromotion: (id: number) => request<AdminPromotion>(`/admin/promotions/${id}`, {}, true),
  /** 422 → `detail: PromotionValidationError` (field-keyed Vietnamese messages). */
  adminCreatePromotion: (body: PromotionInput) =>
    request<AdminPromotion>("/admin/promotions", { method: "POST", body: JSON.stringify(body) }, true),
  adminUpdatePromotion: (id: number, body: Partial<PromotionInput>) =>
    request<AdminPromotion>(`/admin/promotions/${id}`, { method: "PATCH", body: JSON.stringify(body) }, true),
  adminDeletePromotion: (id: number) =>
    request<void>(`/admin/promotions/${id}`, { method: "DELETE" }, true),
  adminDuplicatePromotion: (id: number) =>
    request<AdminPromotion>(`/admin/promotions/${id}/duplicate`, { method: "POST" }, true),
  adminArchivePromotion: (id: number) =>
    request<AdminPromotion>(`/admin/promotions/${id}/archive`, { method: "POST" }, true),
  adminUnarchivePromotion: (id: number) =>
    request<AdminPromotion>(`/admin/promotions/${id}/unarchive`, { method: "POST" }, true),
  adminPromotionRedemptions: (id: number, params?: { page?: number; per_page?: number; q?: string }) =>
    request<AdminPromotionRedemptionPage>(`/admin/promotions/${id}/redemptions${queryString(params)}`, {}, true),
  /** Same-origin BFF URL of the redemptions CSV. */
  adminPromotionRedemptionsCsvUrl: (id: number, params?: { q?: string }) =>
    `/api/admin/promotions/${id}/redemptions.csv${queryString(params)}`,
  adminPromotionStats: (id: number, days = 30) =>
    request<AdminPromotionStats>(`/admin/promotions/${id}/stats?days=${days}`, {}, true),
  adminCreatePromotionCodes: (id: number, body: PromotionCodesCreate) =>
    request<{ created: number }>(`/admin/promotions/${id}/codes`, { method: "POST", body: JSON.stringify(body) }, true),
  adminPromotionCodes: (id: number, params?: { status?: PromotionCodeStatus; page?: number; per_page?: number }) =>
    request<PromotionCodePage>(`/admin/promotions/${id}/codes${queryString(params)}`, {}, true),
  adminPromotionCodesCsvUrl: (id: number, params?: { status?: PromotionCodeStatus }) =>
    `/api/admin/promotions/${id}/codes.csv${queryString(params)}`,
  /** Audit history of one entity (e.g. type "promotion"), newest first. */
  adminAuditEntity: (type: string, id: number | string, limit?: number) =>
    request<AuditEntityEvent[]>(`/admin/audit/entity${queryString({ type, id, limit })}`, {}, true),

  adminSupportTickets: (params?: AdminSupportQuery) =>
    request<AdminTicketPage>(`/admin/support${queryString(params)}`, {}, true),
  adminSupportTicket: (conversationId: string) =>
    request<AdminTicket>(`/admin/support/${conversationId}`, {}, true),
  adminSupportStats: () => request<AdminSupportStats>("/admin/support/stats", {}, true),
  adminSupportContext: (conversationId: string) =>
    request<AdminTicketContext>(`/admin/support/${conversationId}/context`, {}, true),
  /** 409 on an invalid transition. */
  adminSupportSetStatus: (conversationId: string, body: TicketStatusChange) =>
    request<AdminTicket>(`/admin/support/${conversationId}/status`, { method: "POST", body: JSON.stringify(body) }, true),
  adminSupportAssign: (conversationId: string, assigneeId: number | null) =>
    request<AdminTicket>(`/admin/support/${conversationId}/assign`, {
      method: "POST", body: JSON.stringify({ assignee_id: assigneeId }),
    }, true),
  adminSupportSetTags: (conversationId: string, tags: string[]) =>
    request<AdminTicket>(`/admin/support/${conversationId}/tags`, { method: "PUT", body: JSON.stringify({ tags }) }, true),
  adminSupportTags: () => request<SupportTagCount[]>("/admin/support/tags", {}, true),
  adminSupportNotes: (conversationId: string) =>
    request<AdminNote[]>(`/admin/support/${conversationId}/notes`, {}, true),
  adminAddSupportNote: (conversationId: string, body: string) =>
    request<AdminNote>(`/admin/support/${conversationId}/notes`, { method: "POST", body: JSON.stringify({ body }) }, true),
  adminCannedReplies: () => request<CannedReply[]>("/admin/canned-replies", {}, true),
  adminCreateCannedReply: (body: CannedReplyInput) =>
    request<CannedReply>("/admin/canned-replies", { method: "POST", body: JSON.stringify(body) }, true),
  adminUpdateCannedReply: (id: number, body: Partial<CannedReplyInput>) =>
    request<CannedReply>(`/admin/canned-replies/${id}`, { method: "PATCH", body: JSON.stringify(body) }, true),
  adminDeleteCannedReply: (id: number) =>
    request<void>(`/admin/canned-replies/${id}`, { method: "DELETE" }, true),

  adminSitePages: () => request<{ items: SitePageAdmin[] }>("/admin/site-pages", {}, true),
  adminCreateSitePage: (body: SitePageCreate) =>
    request<SitePageAdmin>("/admin/site-pages", { method: "POST", body: JSON.stringify(body) }, true),
  adminUpdateSitePage: (slug: string, body: SitePageUpdate) =>
    request<SitePageAdmin>(`/admin/site-pages/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, true),
  adminResetSitePage: (slug: string) =>
    request<SitePageAdmin>(`/admin/site-pages/${encodeURIComponent(slug)}/reset`, { method: "POST" }, true),
  adminDeleteSitePage: (slug: string) =>
    request<void>(`/admin/site-pages/${encodeURIComponent(slug)}`, { method: "DELETE" }, true),

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
