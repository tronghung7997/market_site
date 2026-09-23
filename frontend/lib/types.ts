export type NotificationPrefKey = "orders" | "disputes" | "wallet" | "marketing";

export interface ProfileUpdate {
  display_name?: string;
  phone?: string;
  telegram_username?: string;
  preferred_locale?: "vi" | "en" | "";
  preferred_currency?: "VND" | "USD" | "";
  notification_prefs?: Partial<Record<NotificationPrefKey, boolean>>;
}

export interface AuthSessionRow {
  id: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  is_current: boolean;
}

/** The seller's own editable shop identity (GET/PATCH /seller/profile). */
export interface MySellerProfile {
  business_name: string;
  description: string | null;
  contact: string | null;
  handle: string | null;
  canonical_path: string;
  seller_tier: string;
}

export interface Account {
  id: number;
  email: string;
  roles: string[];
  seller_tier?: string;
  /** false until the owner opens the confirmation link; gates buying/deposits/withdrawals. */
  email_verified?: boolean;
  totp_enabled?: boolean;
  /** Marketplace-wide 2FA switch; when false the security page hides 2FA. */
  mfa_available?: boolean;
  /** Admin whose console is shut until they enable TOTP (policy on). */
  mfa_setup_required?: boolean;
  /** Seller nội bộ (sàn vận hành) — mở khu Nguồn cung. */
  is_internal?: boolean;
  affiliate_code?: string;
  /** Self-service profile (/account). */
  display_name?: string | null;
  phone?: string | null;
  telegram_username?: string | null;
  preferred_locale?: "vi" | "en" | null;
  preferred_currency?: "VND" | "USD" | null;
  /** Missing key = opted in. Security mail ignores this. */
  notification_prefs?: Partial<Record<NotificationPrefKey, boolean>>;
  created_at?: string;
  referred_by_id?: number | null;
}

export interface AuthRuntimeConfig {
  require_email_verification: boolean;
  verification_link_hours: number;
  mfa_feature_enabled: boolean;
  require_admin_2fa: boolean;
  require_2fa_for_withdrawal: boolean;
  turnstile_site_key: string;
  turnstile_secret_configured: boolean;
  updated_at: string | null;
  updated_by_id: number | null;
}

export interface ChatMessage {
  id: number;
  client_message_id: string;
  body: string;
  sender_id: number;
  sender_role: "buyer" | "seller" | "admin";
  created_at: string;
}

export interface ChatDisputeContext {
  id: number;
  status: string;
  reason: string;
  review_requested_at: string | null;
  claimed_count: number;
  replaced_count: number;
  pending_count: number;
  refunded_amount: number;
}

export interface ChatConversation {
  id: string;
  kind: "product_inquiry" | "order" | "support";
  status: "open" | "resolved" | "closed" | "blocked" | "read_only";
  product: { id: number; title: string; image: string | null; slug?: string | null; public_key?: string | null } | null;
  order: {
    id: number;
    /** Buyer/seller-facing order number. */
    code?: string | null;
    status: string;
    quantity: number;
    total_amount: number;
    cancel_reason: string | null;
  } | null;
  dispute?: ChatDisputeContext | null;
  /** `id` is the counterpart's public key ("marketplace" for the support desk). */
  counterpart: { id: string; label: string; role: "buyer" | "seller" | "admin" };
  last_message: ChatMessage | null;
  unread_count: number;
  can_send: boolean;
  read_only_reason: string | null;
  created_at: string;
}

export interface ChatConversationDetail extends ChatConversation {
  messages: ChatMessage[];
  next_cursor: number | null;
}

export interface ChatConversationList {
  items: ChatConversation[];
  next_cursor: string | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
  commission_rate?: number | null;
  children: Category[];
}

/** Admin directory row (GET /admin/categories): hidden categories included, no nesting. */
export interface CategoryAdminRow {
  id: number;
  name: string;
  name_en: string | null;
  slug: string;
  icon: string | null;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
  commission_rate: number | null;
  child_count: number;
  /** Products directly in this category / in the whole branch. */
  product_count: number;
  active_product_count: number;
  branch_product_count: number;
  branch_active_product_count: number;
  seller_count: number;
}

export interface CategoryAdminSummary {
  total: number;
  roots: number;
  active: number;
  hidden: number;
  /** Categories whose whole branch has no product. */
  empty: number;
}

export interface CategoryAdminListResponse {
  items: CategoryAdminRow[];
  summary: CategoryAdminSummary;
}

export interface CategoryCreateInput {
  name: string;
  name_en?: string | null;
  slug: string;
  icon?: string | null;
  parent_id?: number | null;
  commission_rate?: number | null;
}

/** `parent_id: null` moves to the root; leave it out to keep the parent. */
export interface CategoryUpdateInput {
  name?: string;
  name_en?: string | null;
  slug?: string;
  icon?: string | null;
  parent_id?: number | null;
  is_active?: boolean;
  commission_rate?: number | null;
}

/** Item danh sách sản phẩm (GET /products, /seller/products) — bản GỌN.
 *  description/specs/features/warranty_text chỉ có ở ProductDetail (trang chi
 *  tiết mới cần, mô tả markdown dài nhân N sản phẩm là payload phình vô ích);
 *  commission_rate chỉ có ở AdminProductDetail (không phát ra API public). */
export interface Product {
  id: number;
  /** Management payloads only; storefront rows carry the seller's public identity instead. */
  seller_id?: number;
  seller_key?: string | null;
  seller_handle?: string | null;
  /** `/sellers/{handle}-{key}` — build links with `sellerPath()`. */
  seller_path?: string | null;
  /** Storefront rows: approved business name, else the seller's email local part. */
  seller_name?: string | null;
  category_id: number;
  title: string;
  /** URL slug, generated from the Vietnamese title and editable by the seller. */
  slug: string;
  /** 8-char base36 key that identifies the product in public URLs. */
  public_key: string;
  /** `/products/{slug}-{public_key}` — build links with `productPath()`. */
  canonical_path?: string | null;
  images: Record<string, unknown> | null;
  cover_id?: string | null;
  escrow_days: number;
  status: string;
  service_type: string | null;
  highlight_text: string | null;
  sold_count: number;
  rating_avg: number | null;
  rating_count: number;
  pricing_strategy?: string | null;
  pricing_params?: Record<string, unknown> | null;
  locale?: ProductLocale | null;
  available_locales?: ProductLocale[] | null;
  created_at: string;
  /** GET /products trả kèm gói + tồn kho (fix N+1 trang chủ) — optional vì
   *  một số response cũ (đơn hàng, admin) vẫn là Product trần. */
  variants?: Variant[];
}

export type ProductLocale = "en" | "vi";

export interface ProductTranslation {
  title?: string | null;
  description?: string | null;
  highlight_text?: string | null;
  features?: string[] | null;
  warranty_text?: string | null;
  /** Locale-specific buyer-facing specs. Keys are display labels for legacy
   * products; new entries should use stable spec ids. */
  specs?: Record<string, string> | null;
  /** Labels only — numeric pricing and machine keys remain common. */
  pricing_labels?: ProductPricingLabels | null;
}

export interface ProductPricingLabels {
  field_labels?: Record<string, string>;
  type_display?: Record<string, string>;
  network_display?: Record<string, string>;
  platform_display?: Record<string, string>;
  duration_labels?: Record<string, string>;
  package_labels?: Record<string, string>;
}

/** One top-level category on the /categories hub (GET /products/shelves). */
export interface CategoryShelf {
  category_id: number;
  /** Active products in the whole branch (sub-categories included). */
  total: number;
  /** Cheapest "from" price in the branch, VND; null when nothing is priced. */
  price_from: number | null;
  /** Best sellers of the branch, capped server-side. */
  items: Product[];
}

export interface CategoryShelvesResponse {
  shelves: CategoryShelf[];
  total: number;
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
  page: number;
  per_page: number;
}

export interface ProductCatalogSummary {
  products: number;
  variants: number;
  available_stock: number;
  category_counts: Array<{ category_id: number; count: number }>;
}

export interface Variant {
  id: number;
  /** Seller-facing identity: /seller/inventory/{public_key}. */
  public_key?: string | null;
  product_id: number;
  name: string;
  price: number;
  delivery_mode: string;
  sla_hours: number;
  sort_order: number;
  is_active: boolean;
  /** Exact units — seller/admin payloads only. Absent on the storefront. */
  stock_count?: number;
  /** Storefront inventory signal; see lib/stock.ts. */
  stock_state?: "in_stock" | "low" | "out" | "manual" | null;
  /** Largest quantity the order form may submit for this package. */
  max_quantity?: number | null;
  duration_days: number | null;
  translations?: Partial<Record<ProductLocale, { name?: string | null }>> | null;
  primary_locale?: ProductLocale | null;
}

/** Management variant row (seller/admin endpoints): the exact count is always there. */
export type SellerVariant = Variant & { stock_count: number };

export interface ProductDetail extends Product {
  description: string | null;
  features: string[] | null;
  specs: Record<string, string> | null;
  warranty_text: string | null;
  translations?: Partial<Record<ProductLocale, ProductTranslation>> | null;
  primary_locale?: ProductLocale | null;
  variants: Variant[];
  seller_name: string | null;
  category_name: string | null;
  /** Storefront category URL segment — `categoryPath()` falls back to the id. */
  category_slug?: string | null;
}

/** GET /admin/products/{id} — như ProductDetail nhưng kèm commission_rate
 *  (đã rút khỏi response public, trang admin sửa sản phẩm đọc từ đây). */
export interface AdminProductDetail extends ProductDetail {
  commission_rate: number | null;
  seller_email: string | null;
}

export interface WithdrawPolicy {
  tier: string;
  /** null = không giới hạn (cấp enterprise). Khác với `withdraw_policy: null`,
   *  nghĩa là tài khoản không phải seller nên không rút được. */
  limit_per_request: number | null;
}

export interface Wallet {
  id: number;
  account_id: number;
  pending_balance: number;
  available_balance: number;
  locked_balance: number;
  balance: number;
  updated_at: string;
  withdraw_policy?: WithdrawPolicy | null;
  /** Paid by this account for orders not yet settled (buyer side of escrow). */
  escrow_paid: number;
  /** Owed to this account from orders not yet settled (seller side of escrow). */
  escrow_incoming: number;
}

export interface Transaction {
  id: number;
  type: string;
  amount: number;
  /** Tác động lên số dư khả dụng. Backend quyết định (models/wallet.py::
   *  TRANSACTION_DIRECTION) — đừng suy diễn lại từ `type` ở phía client. */
  direction: "in" | "out" | "neutral";
  description: string | null;
  reference_id: string | null;
  created_at: string;
  order_status?: string | null;
  /** Order behind the row, by public code; what the UI shows instead of `order-{id}`. */
  order_code?: string | null;
  /** Customer-facing reference (order code + suffix, or provider deposit ref); null when there is none to show. */
  reference_label?: string | null;
}

export interface Order {
  id: number;
  /** Buyer/seller-facing order number (ORD-XXXXXXXX): what the UI shows and links. */
  order_code: string;
  buyer_id: number;
  seller_id: number;
  // Exactly one of these is set: variant_id for stock/manual orders, product_id
  // for orders fulfilled through a provider adapter.
  variant_id: number | null;
  product_id: number | null;
  quantity: number;
  total_amount: number;
  /** VND per 1 USD at purchase. null = pre-rollout → FE uses legacy 26_000. */
  display_fx_rate_snapshot?: number | null;
  status: string;
  escrow_expires_at: string | null;
  delivered_data: string | null;
  gateway_access?: { key: string; url: string } | null;
  cancel_reason?: string | null;
  created_at: string;
  product_title?: string | null;
  /** Public URL parts of the ordered product, for "view product" links. */
  product_slug?: string | null;
  product_key?: string | null;
  variant_key?: string | null;
  pricing_strategy?: string | null;
  delivery_mode?: string | null;
  sla_hours?: number | null;
  variant_name?: string | null;
  /** Seller view: masked (`bu***@gmail.com`); admin view: full; absent for buyers. */
  buyer_email?: string | null;
  /** Admin view only; buyers get seller_name/seller_path instead. */
  seller_email?: string | null;
  seller_name?: string | null;
  seller_path?: string | null;
  buyer_key?: string | null;
  has_review?: boolean;
  has_dispute?: boolean;
  dispute_status?: string | null;
  /** Open dispute with no seller reply yet — "handle now" in the seller console. */
  dispute_awaiting_seller?: boolean;
  service_type?: string | null;
  fulfillment?: { kind: "instant" | "manual" | "api" | "task" | "proxy"; status: string } | null;
  settlement?: { status: "escrow_held" | "released" | "refunded" } | null;
  protection?: { status: "active" | "dispute_open" | "closed" } | null;
  capabilities?: {
    can_confirm: boolean;
    can_dispute: boolean;
    can_append_claims: boolean;
    can_request_review: boolean;
    can_review: boolean;
    can_chat: boolean;
    can_view_proxy: boolean;
  } | null;
  task_progress?: {
    total: number;
    pending: number;
    assigned: number;
    processing: number;
    completed: number;
    failed: number;
  } | null;
}

export interface MoneyConfigPublic {
  ledger_currency: "VND";
  display_fx_rate: number | null;
  display_currency_default: "VND" | "USD";
  allow_user_toggle: boolean;
  allow_locale_toggle: boolean;
  show_fx_hints: boolean;
}

export interface MoneyConfigAdmin extends MoneyConfigPublic {
  rate_min: number;
  rate_max: number;
  env_rate: number | null;
  env_currency_default: "VND" | "USD";
  env_allow_user_toggle: boolean;
  env_allow_locale_toggle: boolean;
  env_show_fx_hints: boolean;
  updated_at: string | null;
  updated_by_id: number | null;
  source: "db" | "env" | "none";
}

export type MoneyConfigUpdate = {
  display_fx_rate?: number;
  display_currency_default?: "VND" | "USD";
  allow_user_toggle?: boolean;
  allow_locale_toggle?: boolean;
  show_fx_hints?: boolean;
};

export interface TimelineEvent {
  event: string;
  timestamp: string;
}

// Sanitized DProxy allocation state for the buyer dashboard — never carries
// rotate_path, provider base_url/API key, or the internal allocation id
// (see src/resources/proxy_router.py::get_proxy_state).
export interface ProxyState {
  status: "allocated" | "offline" | "expired" | "released" | "error";
  public_ip: string | null;
  /** Cổng vào CỐ ĐỊNH của key xoay (buyer cắm vào tool, không đổi khi đổi IP).
   *  null với nhà cung cấp không có khái niệm này (DProxy, proxy tĩnh). */
  gateway_host?: string | null;
  gateway_port?: number | null;
  expires_at: string;
  rotation_available: boolean;
  cooldown_remaining_seconds: number;
  last_rotated_at: string | null;
  /** Nhà cung cấp có khoá proxy theo IP hay không. False (vd DProxy) thì ẩn
   *  hoàn toàn phần khai báo IP. */
  whitelist_supported?: boolean;
  /** IPv4 buyer đã khai báo, phân tách bằng dấu phẩy. null = chưa khai. */
  whitelist_ips?: string | null;
}

export interface ProxyWhitelistResult {
  ok: boolean;
  whitelist_ips: string | null;
  /** false = đã lưu nhưng chưa kịp có hiệu lực (nhà cung cấp lỗi/cooldown) —
   *  buyer cần bấm "Lấy proxy mới". */
  applied: boolean;
  public_ip: string | null;
  delivered_data: string | null;
}

export interface ProxyRotateResult {
  ok: boolean;
  public_ip: string | null;
  last_rotated_at: string;
  cooldown_seconds: number | null;
  expires_at: string;
  // Fresh Host/Port/Username/Password snapshot — covers rotates that only
  // change the password (IP/expiry unchanged), which the fields above can't
  // capture. Use this to refresh "Dữ liệu bàn giao" in the same round trip.
  delivered_data: string | null;
}

/* Buyer proxy console (`/me/proxies`) — docs/proxy-dashboard-api.md.
 * A line never names its upstream source: there is deliberately no
 * provider/adapter field. */
export type ProxyIpType = "residential" | "mobile" | "datacenter";
export type ProxyRotation = "static" | "rotating" | "rotating_key";
export type ProxyProtocol = "HTTP" | "SOCKS5";
export type ProxyLineStatus = "allocated" | "offline" | "expired" | "released" | "error";
export type ProxyTagTone = "iris" | "good" | "warn" | "neutral" | "ink";

export interface ProxyLine {
  /** Public line id `ORD-XXXXXXXX#01` — never a row id. */
  id: string;
  order_code: string;
  line_no: number;
  product_title: string;
  /** Plan label as sold, e.g. "Residential · Việt Nam · 7 ngày". */
  variant_name: string;
  ip_type: ProxyIpType;
  rotation: ProxyRotation;
  protocol: ProxyProtocol;
  network: string;
  country: string | null;
  /** Connection address; for rotating keys the fixed gateway. */
  host: string;
  port: number;
  /** null for rotating keys that authenticate by whitelisted IP. */
  username: string | null;
  password: string | null;
  public_ip: string | null;
  status: ProxyLineStatus;
  created_at: string;
  expires_at: string;
  rotation_available: boolean;
  cooldown_seconds: number | null;
  last_rotated_at: string | null;
  whitelist_supported: boolean;
  whitelist_ips: string | null;
  socks5_port: number | null;
  /** Capability flags the backend does not support yet — always false/null
   *  today; the console does not offer these actions. */
  credentials_editable: boolean;
  replaceable: boolean;
  renew_mode: null;
  plan_days: number | null;
  tag_ids: string[];
  note: string;
}

export interface ProxyLineSummary {
  all: number;
  running: number;
  soon: number;
  problem: number;
}

/** Counts under the current filters; each dimension ignores its own selection. */
export interface ProxyLineFacets {
  status: ProxyLineSummary;
  ip_type: Record<"residential" | "mobile" | "datacenter", number>;
  rotation: Record<"static" | "rotating" | "rotating_key", number>;
  expires: Record<"24h" | "3d" | "7d" | "expired", number>;
  /** Tag id → count, plus `__none__` for untagged lines. */
  tags: Record<string, number>;
}

export interface ProxyLineListResponse {
  items: ProxyLine[];
  total: number;
  page: number;
  per_page: number;
  /** Every line of the buyer, unfiltered. */
  summary: ProxyLineSummary;
  facets: ProxyLineFacets;
}

/** Query string of `GET /me/proxies`; list values are comma-joined. */
export interface ProxyLineQuery {
  status?: "running" | "soon" | "problem";
  q?: string;
  tags?: string[];
  ip_type?: ProxyIpType[];
  rotation?: ProxyRotation[];
  expires?: "24h" | "3d" | "7d" | "expired";
  sort?: "expiry_asc" | "expiry_desc" | "newest" | "line";
  page?: number;
  per_page?: number;
}

export interface ProxyTag {
  id: string;
  name: string;
  tone: ProxyTagTone;
  created_at: string;
  /** Lines carrying this tag, account-wide. */
  count: number;
}

export interface ProxyTagAssignRequest {
  line_ids: string[];
  add: string[];
  remove: string[];
  mode: "merge" | "replace";
}

export interface ResourceInfo {
  id: number;
  status: string;
  expires_at: string | null;
}

export interface DisputeInfo {
  id: number;
  reason: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface SellerSummary {
  /** Opaque public identity; the account id is never exposed. */
  public_key: string;
  handle: string | null;
  canonical_path: string;
  display_name: string;
  business_name: string | null;
  completed_order_count: number;
  rating_avg: number | null;
  review_count: number;
  seller_tier: string;
}

export interface SellerProfile extends SellerSummary {
  bio: string | null;
  member_since: string | null;
}

export interface WithdrawRequest {
  id: number;
  account_id: number;
  account_email?: string | null;
  amount: number;
  status: string;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_holder?: string | null;
  bank_bin?: string | null;
  payout_reference?: string | null;
  paid_at?: string | null;
  reject_reason?: string | null;
  /** Withdrawal fee locked in at request time; net_amount = amount − fee_amount is what gets paid out. */
  fee_amount?: number;
  net_amount?: number | null;
  created_at: string;
}

export type DepositMethod = "sepay" | "nowpayments";

export interface DepositIntent {
  id: number;
  amount: number;
  status: "pending" | "paid" | "cancelled" | "expired";
  provider?: DepositMethod | string;
  // SePay bank transfer
  payment_code?: string | null;
  bank_code?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  sepay_bank_account_id?: string | null;
  sepay_transaction_id?: string | null;
  sepay_reference?: string | null;
  // Shared/legacy hosted checkout fields
  checkout_url?: string | null;
  qr_code?: string | null;
  payment_link_id?: string | null;
  // NOWPayments
  now_invoice_id?: string | null;
  pay_currency?: string | null;
  pay_address?: string | null;
  pay_amount?: number | string | null;
  now_payment_id?: string | null;
  quoted_usd_amount?: number | string | null;
  vnd_per_usd_snapshot?: number | null;
  price_currency?: string | null;
  paid_crypto_amount?: number | string | null;
  paid_amount?: number | null;
  created_at: string;
  expires_at: string;
  paid_at?: string | null;
}

export interface DepositMethods {
  sepay_enabled: boolean;
  nowpayments_enabled: boolean;
  deposit_min_amount: number;
  deposit_max_amount: number;
  deposit_usdt_min_vnd: number;
  deposit_usdt_max_vnd: number;
}

export interface DepositReconcileResult {
  id: number;
  status: DepositIntent["status"];
  provider_status: string | null;
  reconcile_result:
    | "already_paid"
    | "checked"
    | "credited"
    | "not_configured"
    | "not_found"
    | "provider_error"
    | "validation_failed";
}

export interface DepositRailConfigAdmin {
  sepay_enabled: boolean;
  nowpayments_enabled: boolean;
  sepay_bank_code: string;
  sepay_bank_account_number: string;
  sepay_bank_account_name: string;
  sepay_bank_account_id: string;
  deposit_min_amount: number;
  deposit_max_amount: number;
  deposit_expire_minutes: number;
  deposit_reconcile_retention_hours: number;
  deposit_usdt_min_vnd: number;
  deposit_usdt_max_vnd: number;
  deposit_usdt_local_window_minutes: number;
  deposit_usdt_reconcile_retention_hours: number;
  sepay_secrets_configured: boolean;
  sepay_reconciliation_configured: boolean;
  nowpayments_secrets_configured: boolean;
  nowpayments_reconciliation_configured: boolean;
  effective_sepay_enabled: boolean;
  effective_nowpayments_enabled: boolean;
  env_seed: Record<string, unknown>;
  updated_at?: string | null;
  updated_by_id?: number | null;
  source: string;
}

export type MailProvider = "log" | "smtp" | "resend";

export interface MailConfigAdmin {
  provider: MailProvider;
  mail_from: string;
  mail_from_name: string;
  worker_enabled: boolean;
  env_provider: MailProvider;
  env_mail_from: string;
  env_mail_from_name: string;
  env_worker_enabled: boolean;
  resend_api_key_configured: boolean;
  smtp_host_configured: boolean;
  smtp_credentials_configured: boolean;
  smtp_host: string | null;
  smtp_port: number;
  effective_ready: boolean;
  effective_mode: string;
  frontend_base_url: string;
  updated_at?: string | null;
  updated_by_id?: number | null;
  source: string;
}

export type MailConfigUpdate = Partial<{
  provider: MailProvider;
  mail_from: string;
  mail_from_name: string;
  worker_enabled: boolean;
}>;

export interface MailSendTestResponse {
  id: number;
  status: string;
  to_email: string;
  effective_mode: string;
  logged_only: boolean;
  last_error: string | null;
}

export interface MailOutboxRow {
  id: number;
  template: string;
  to_email: string;
  account_id: number | null;
  locale: string;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string | null;
}

export interface MailOutboxList {
  items: MailOutboxRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface MailTemplateRow {
  template: string;
  locale: "vi" | "en";
  subject: string;
  body: string;
  placeholders: string[];
  default_subject: string;
  default_body: string;
  customized: boolean;
  updated_at?: string | null;
  updated_by_id?: number | null;
}

export interface SitePageLink {
  slug: string;
  title: string;
}

export interface SitePagePublic {
  slug: string;
  title: string;
  body: string;
  updated_at?: string | null;
}

export interface SitePageAdmin {
  slug: string;
  sort_order: number;
  show_in_footer: boolean;
  title_vi: string;
  title_en: string;
  body_vi: string;
  body_en: string;
  is_system: boolean;
  customized: boolean;
  updated_at?: string | null;
  updated_by_id?: number | null;
}

export type SitePageCreate = Omit<SitePageAdmin, "is_system" | "customized" | "updated_at" | "updated_by_id">;
export type SitePageUpdate = Partial<Omit<SitePageCreate, "slug">>;

export interface MailTemplatePreview {
  template: string;
  locale: string;
  subject: string;
  body: string;
  placeholders: string[];
}

export type DepositRailConfigUpdate = Partial<{
  sepay_enabled: boolean;
  nowpayments_enabled: boolean;
  sepay_bank_code: string;
  sepay_bank_account_number: string;
  sepay_bank_account_name: string;
  sepay_bank_account_id: string;
  deposit_min_amount: number;
  deposit_max_amount: number;
  deposit_expire_minutes: number;
  deposit_reconcile_retention_hours: number;
  deposit_usdt_min_vnd: number;
  deposit_usdt_max_vnd: number;
  deposit_usdt_local_window_minutes: number;
  deposit_usdt_reconcile_retention_hours: number;
}>;

export interface AdminDepositIntent extends DepositIntent {
  account_id: number;
  account_email?: string | null;
  payment_link_id?: string | null;
  payos_reference?: string | null;
  external_reference?: string | null;
  outcome_amount?: number | string | null;
  outcome_currency?: string | null;
}

export interface AdminDepositTransaction {
  id: string;
  provider: string;
  provider_transaction_id: string;
  provider_status: string;
  reference?: string | null;
  expected_amount?: number | string | null;
  actual_amount?: number | string | null;
  delta_amount?: number | string | null;
  currency: string;
  settled_amount?: number | string | null;
  settled_currency?: string | null;
  match_status: "exact" | "underpaid" | "overpaid" | "unknown";
  credit_status: "credited" | "held" | "not_credited";
  direction?: "in" | "out" | null;
  source: string;
  received_at: string;
  destination?: string | null;
  event_count: number;
  raw: Record<string, unknown>;
}

export interface AdminDepositLedgerIntent {
  id: number;
  account_id: number;
  account_email?: string | null;
  amount: number;
  paid_amount?: number | null;
  status: "pending" | "paid" | "cancelled" | "expired" | string;
  provider: string;
  payment_code?: string | null;
  now_payment_id?: string | null;
  created_at: string;
  paid_at?: string | null;
}

export interface AdminDepositLedgerEntry {
  deposit: AdminDepositLedgerIntent;
  transactions: AdminDepositTransaction[];
}

export interface AdminDepositLedgerResponse {
  total: number;
  limit: number;
  offset: number;
  items: AdminDepositLedgerEntry[];
}

export interface AdminDepositLedgerQuery {
  limit?: number;
  offset?: number;
  provider?: string;
  status?: string;
  search?: string;
}

export interface SePayWebhookEventRow {
  id: number;
  transaction_id: string;
  payment_code?: string | null;
  reference?: string | null;
  account_number: string;
  amount: number;
  source: "webhook" | "reconcile" | string;
  signature_valid?: boolean | null;
  received_at: string;
  raw: Record<string, unknown>;
}

export interface AdminAccountWallet {
  account_id: number;
  email: string;
  available_balance: number;
  locked_balance: number;
  pending_balance: number;
  escrow_paid: number;
  escrow_incoming: number;
}

export interface LoginEvent {
  id: number;
  /** login | admin_login | locked | unlocked */
  kind: string;
  /** success | invalid_credentials | inactive */
  outcome: string;
  ip: string | null;
  user_agent: string | null;
  actor_id: number | null;
  created_at: string;
}

export interface AdminOrderDetail extends Order {
  resources: ResourceInfo[];
  dispute: DisputeInfo | null;
  timeline: TimelineEvent[];
  usage: UsageBalance | null;
}

export interface Dispute {
  id: number;
  order_id: number;
  order_code?: string | null;
  buyer_id: number;
  reason: string;
  evidence_type?: string | null;
  evidence?: Record<string, string> | null;
  status: string;
  admin_note: string | null;
  seller_note: string | null;
  created_at: string;
  resolution_offered_at?: string | null;
  resolution_deadline_at?: string | null;
  escrow_expires_at?: string | null;
  abandon_after_at?: string | null;
  review_requested_at?: string | null;
  /** A4.5: the seller must react before this, or the case is refunded automatically. */
  seller_deadline_at?: string | null;
  seller_responded_at?: string | null;
  resolved_at: string | null;
  product_title?: string | null;
  variant_name?: string | null;
  buyer_email?: string | null;
  order_amount?: number | null;
  refunded_amount?: number;
  claimed_resource_ids?: number[];
  warranty_claimable_ids?: number[];
  resource_actions?: DisputeResourceAction[];
  timeline?: DisputeTimelineEvent[];
  marketplace_conversation_id?: string | null;
}

export interface PaginatedDisputes {
  items: Dispute[];
  total: number;
  page: number;
  per_page: number;
}

export interface DisputeResourceAction {
  id?: number;
  action: "replace" | "refund";
  original_resource_id: number;
  replacement_resource_id: number | null;
  refund_amount: number;
  note?: string | null;
  created_at: string;
}

export interface DisputeTimelineEvent {
  id: string;
  event_type: string;
  actor_role: "buyer" | "seller" | "admin" | "system";
  body: string | null;
  resource_ids: number[];
  replacement_resource_ids?: (number | null)[];
  refund_amount?: number;
  created_at: string;
}

export interface AdminDisputeOrder {
  id: number;
  order_code?: string | null;
  buyer_id: number;
  seller_id: number;
  variant_id: number | null;
  quantity: number;
  total_amount: number;
  status: string;
  escrow_expires_at: string | null;
  delivered_data: string | null;
  created_at: string;
  product_title: string | null;
  variant_name: string | null;
  buyer_email: string | null;
  seller_email: string | null;
}

export interface AdminDisputeDetail {
  id: number;
  order_id: number;
  buyer_id: number;
  reason: string;
  evidence_type?: string | null;
  evidence?: Record<string, string> | null;
  status: string;
  admin_note: string | null;
  seller_note: string | null;
  created_at: string;
  resolution_deadline_at?: string | null;
  abandon_after_at?: string | null;
  review_requested_at?: string | null;
  /** A4.5: the seller must react before this, or the case is refunded automatically. */
  seller_deadline_at?: string | null;
  seller_responded_at?: string | null;
  resolved_at: string | null;
  order: AdminDisputeOrder;
  resources: ResourceInfo[];
  timeline: TimelineEvent[];
}

export interface SellerStats {
  product_count: number;
  active_count: number;
  total_orders: number;
  pending_orders: number;
  total_revenue: number;
}

export type SellerDashboardRangeKey =
  | "7d" | "30d" | "90d"
  | "today" | "this_week" | "this_month" | "this_quarter" | "this_year"
  | "custom";

export interface SellerDashboardRange {
  key: SellerDashboardRangeKey;
  tz: string;
  from_date: string;
  to_date: string;
  compare_from_date: string;
  compare_to_date: string;
  days: number;
  bucket: "day" | "week";
}

export interface SellerDashboardMoney {
  gross: number;
  gross_prev: number;
  net_released: number;
  net_released_prev: number;
  platform_fee: number;
  refunded: number;
  refunded_orders: number;
  escrow_held: number;
  escrow_orders: number;
  pending_withdrawals: number;
  wallet: { available: number; pending: number; locked: number };
}

export interface SellerDashboardOrders {
  total: number;
  total_prev: number;
  completed_prev: number;
  by_status: Record<string, number>;
  completion_rate: number | null;
  dispute_count: number;
  dispute_rate: number | null;
  avg_order_value: number | null;
}

export interface SellerDashboardPoint {
  date: string;
  orders: number;
  gross: number;
  net: number;
  refunded: number;
}

export interface SellerDashboardTopProduct {
  id: number;
  public_key?: string | null;
  title: string;
  service_type: string | null;
  status: string;
  orders: number;
  gross: number;
  net: number;
  inventory_managed: boolean;
  total_stock: number;
  stock_state: "in_stock" | "low" | "out" | "not_managed";
  rating_avg: number | null;
  rating_count: number;
}

export interface SellerDashboardInventory {
  product_count: number;
  active_count: number;
  managed_products: number;
  total_stock: number;
  low_stock: number;
  out_of_stock: number;
}

export interface SellerDashboard {
  range: SellerDashboardRange;
  money: SellerDashboardMoney;
  orders: SellerDashboardOrders;
  timeseries: SellerDashboardPoint[];
  top_products: SellerDashboardTopProduct[];
  inventory: SellerDashboardInventory;
  customers: { unique_buyers: number; new_buyers: number; returning_buyers: number };
  reviews: { rating_avg: number | null; rating_count: number; count_in_range: number };
  action_items: Pick<ActionItem, "key" | "severity" | "label" | "count" | "href">[];
}

export interface Review {
  id: number;
  product_id: number;
  /** Masked reviewer handle ("ng***n"); the API no longer exposes buyer/order ids. */
  reviewer_label: string;
  rating: number;
  comment: string | null;
  created_at: string;
  /** Package the reviewer bought — shown next to the "purchased" badge. */
  variant_name?: string | null;
  /** Public answer from the seller, if any. */
  seller_reply?: string | null;
  seller_replied_at?: string | null;
  /** Written by the auto-review job (5★, no comment) when the buyer never rated. */
  is_auto?: boolean;
}

export interface ReviewSummary {
  average: number | null;
  counts: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface PublicReviewList {
  items: Review[];
  /** Count after the star filter — drives pagination. */
  total: number;
  page: number;
  per_page: number;
  rating: number | null;
  /** Star breakdown over all visible reviews, independent of the page shown. */
  summary: ReviewSummary;
}

/** Seller console row: the seller's own product reviews, hidden ones flagged. */
export interface SellerReview extends Review {
  /** Seller/admin rows keep the ids — the seller fulfilled that order. */
  order_id: number;
  order_code?: string | null;
  buyer_id: number;
  product_title: string | null;
  is_hidden: boolean;
}

export interface SellerReviewList {
  items: SellerReview[];
  total: number;
  /** Visible reviews still waiting for a seller reply. */
  unreplied: number;
  page: number;
  per_page: number;
}

export interface AdminReview extends SellerReview {
  buyer_email: string | null;
  seller_id: number | null;
  hidden_reason: string | null;
  hidden_at: string | null;
  hidden_by_id: number | null;
}

export interface AdminReviewList {
  items: AdminReview[];
  total: number;
  page: number;
  per_page: number;
}

export interface SellerProduct extends Product {
  category_name: string | null;
  variant_count: number;
  total_stock: number;
  /** Active-package price span; null when there is no active package. */
  price_min: number | null;
  price_max: number | null;
}

export interface SellerProductCounts {
  all: number;
  active: number;
  paused: number;
  draft: number;
  suspended: number;
  low_stock: number;
  out_of_stock: number;
  total_stock: number;
  /** Stock at or below this (and above 0) counts as low — same rule as the tabs. */
  low_stock_threshold: number;
  /** Seller tier and its cap on products on sale at once (null = unlimited). */
  tier: SellerTierName;
  max_active_products: number | null;
}

export type SellerTierName = "new" | "verified" | "trusted" | "enterprise";
export type SellerTierRule = {
  tier: SellerTierName;
  max_active_products: number | null;
  withdraw_limit_per_request: number | null;
  fee_discount_pp: number;
  escrow_reduction_days: number;
  updated_at: string | null;
  updated_by_id: number | null;
};
/** A field left out is untouched; a cap sent as null becomes unlimited. */
export type SellerTierRulePatch = {
  max_active_products?: number | null;
  withdraw_limit_per_request?: number | null;
  fee_discount_pp?: number | null;
  escrow_reduction_days?: number | null;
};

export type SellerProductTab = "all" | "active" | "paused" | "draft" | "low_stock" | "out_of_stock";
export type SellerProductSort =
  | "newest" | "oldest" | "title" | "stock_asc" | "stock_desc" | "sold_desc" | "rating_desc" | "price_asc" | "price_desc";

export interface SellerProductBulkStatusResult {
  updated: number[];
  skipped: { id: number; reason: "not_found" | "not_owner" | "suspended" }[];
}

export type SellerOrderTab = "all" | "disputed" | "action_required" | "escrow" | "completed" | "cancelled";
export type SellerOrderKind = "instant" | "manual" | "api" | "task" | "proxy";
export type SellerOrderSort = "newest" | "oldest" | "amount_desc" | "amount_asc";

export interface SellerOrderCounts {
  all: number;
  disputed: number;
  action_required: number;
  escrow: number;
  completed: number;
  cancelled: number;
  disputes_awaiting_seller: number;
}

export interface SellerOrderQuery {
  tab?: SellerOrderTab;
  search?: string;
  /** Product public key, or a legacy numeric id (the API accepts both). */
  product?: string;
  kind?: SellerOrderKind;
  date_from?: string;
  date_to?: string;
  sort?: SellerOrderSort;
  page?: number;
  per_page?: number;
}

export interface PaginatedSellerOrders extends PaginatedOrderResponse {
  counts: SellerOrderCounts;
  products: { id: number; public_key?: string | null; title: string }[];
}

export interface PaginatedSellerProducts {
  items: SellerProduct[];
  total: number;
  page: number;
  per_page: number;
  counts: SellerProductCounts;
  categories: string[];
  /** Parent → child facet over the seller's whole catalogue, with product counts. */
  category_facet: InventoryCategoryFacet[];
  service_types: string[];
}

export interface AdminProductFacet {
  key: string;
  count: number;
}

export interface AdminProductCounts {
  all: number;
  active: number;
  draft: number;
  paused: number;
  suspended: number;
  needs_setup: number;
  total_revenue: number;
}

export interface PaginatedAdminProducts {
  items: AdminProduct[];
  total: number;
  page: number;
  per_page: number;
  counts: AdminProductCounts;
  sellers: AdminProductFacet[];
  providers: AdminProductFacet[];
  services: AdminProductFacet[];
}

export interface Provider {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  priority: number;
  is_active: boolean;
  adapter_type: string;
  fallback_provider_id: number | null;
  quality_score: number | null;
  seller_id: number | null;
  review_status: "draft" | "test_failed" | "tested" | "pending_review" | "approved" | "rejected" | "disabled";
  review_note: string | null;
  last_tested_at: string | null;
  last_test_result: {
    passed?: boolean;
    health?: Record<string, unknown>;
    provision_test?: Record<string, unknown> | null;
    provision_test_skipped_reason?: string | null;
  } | null;
}

export interface ServiceTask {
  id: number;
  order_id: number;
  platform: string;
  target_url: string;
  status: string; // pending | assigned | processing | completed | failed
  order_status?: string | null;
  assignee: string | null;
  result_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderHealth {
  id: number;
  provider_id: number;
  checked_at: string;
  latency_ms: number | null;
  success_rate: number;
  status: string;
}

export interface Alert {
  id: number;
  type: string;
  severity: string;
  target_type: string;
  target_id: number;
  message: string;
  is_active: boolean;
  created_at: string;
}

export interface ActionItem {
  key: string;
  severity: "info" | "warning" | "critical";
  label: string;
  count: number;
  href: string;
  dismissible: boolean;
  alert_id: number | null;
}

export interface Resource {
  id: number;
  variant_id: number;
  status: string; // available | assigned | expired | error
  data: string;
  order_id: number | null;
  order_code?: string | null;
  assigned_at: string | null;
  expires_at: string | null;
  created_at: string;
  refund_amount_cap: number | null;
  is_archived?: boolean;
}

/** Seller console stock row: content only as a server-masked preview; the
 * full line is fetched per row (audited) through `api.revealResource`. */
export type SellerResourceRow = Omit<Resource, "data"> & { data_preview: string };

export interface ResourceReveal {
  id: number;
  data: string;
}

export interface BulkResourceActionResult {
  action: string;
  count: number;
  resource_ids: number[];
}

export interface SellerDisputeResource {
  id: number;
  status: string;
  expires_at: string | null;
  data: string;
  refund_amount_cap: number | null;
  action: "replace" | "refund" | null;
  replacement_resource_id: number | null;
}

export interface SellerDisputeResourceList {
  items: SellerDisputeResource[];
  ids?: number[];
  total: number;
  page: number;
  per_page: number;
}

export interface SellerReplacementResourceList {
  /** Oldest stock first — the order "replace from stock" hands accounts out. */
  items: Array<{ id: number; data: string; created_at?: string | null }>;
  ids?: number[];
  total: number;
  page: number;
  per_page: number;
}

export interface InventoryVariant {
  product_id: number;
  product_title: string;
  variant_id: number;
  variant_name: string;
  delivery_mode: string | null;
  is_active: boolean;
  available: number;
  assigned: number;
  expired: number;
  error: number;
  archived: number;
}

export interface InventoryCounts {
  all: number;
  out: number;
  low: number;
  error: number;
  available: number;
}

export interface PaginatedInventoryVariants {
  items: InventoryVariant[];
  total: number;
  page: number;
  per_page: number;
  counts: InventoryCounts;
}

// --- Seller inventory console (package-level) -----------------------------

export type InventoryStockTab = "all" | "low" | "out" | "error" | "inactive";
export type InventoryPackageSort = "available_asc" | "available_desc" | "title" | "last_restock" | "sold_desc";
export type InventoryProductStatusFilter = "active" | "paused" | "all";
export type InventoryStockState = "in_stock" | "low" | "out" | "inactive";

export interface InventoryPackage {
  product_id: number;
  product_key?: string | null;
  product_title: string;
  product_status: string;
  cover_id: string | null;
  service_type: string | null;
  category_id: number;
  category_name: string;
  category_parent_id: number | null;
  category_parent_name: string | null;
  variant_id: number;
  variant_key?: string | null;
  variant_name: string;
  price: number;
  delivery_mode: string | null;
  is_active: boolean;
  available: number;
  assigned: number;
  error: number;
  expired: number;
  archived: number;
  sold_30d: number;
  last_restock_at: string | null;
  stock_state: InventoryStockState;
}

export interface InventoryPackageCounts {
  all: number;
  low: number;
  out: number;
  error: number;
  inactive: number;
  available_total: number;
  sold_30d: number;
  products: number;
}

export interface InventoryCategoryFacet {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  count: number;
}

export interface InventoryPackagesResponse {
  items: InventoryPackage[];
  total: number;
  page: number;
  per_page: number;
  view: "grouped" | "flat";
  counts: InventoryPackageCounts;
  categories: InventoryCategoryFacet[];
  low_stock_threshold: number;
}

export interface InventoryPackageSibling {
  variant_id: number;
  variant_key?: string | null;
  variant_name: string;
  available: number;
  is_active: boolean;
  delivery_mode: string | null;
  price: number;
}

export interface InventoryPackageDetail extends InventoryPackage {
  low_stock_threshold: number;
  expected_field_count: number | null;
  siblings: InventoryPackageSibling[];
}

export interface InventoryPackageBulkStatusResult {
  updated: number[];
  skipped: { id: number; reason: "not_found" | "not_owner" | string }[];
  is_active: boolean;
}

export interface RestockPreview {
  total_lines: number;
  duplicate_in_file: number;
  existing_in_stock: number;
  to_add: number;
  expected_field_count: number | null;
  malformed: { line: number; fields: number }[];
  malformed_total: number;
}

export interface RestockResult {
  count: number;
  skipped_duplicate: number;
  skipped_existing: number;
  /** Rows that already exist elsewhere on the marketplace (other package, other seller, or sold). */
  skipped_market: number;
}

export type ResourceStatusFilter = "all" | "available" | "assigned" | "error" | "expired" | "archived";
export type ResourceSort = "newest" | "oldest";

export interface SellerResourceQuery {
  page?: number;
  perPage?: number;
  status?: ResourceStatusFilter;
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  hasOrder?: boolean | null;
  sort?: ResourceSort;
  signal?: AbortSignal;
}

export interface BulkResourceActionInput {
  action: "archive" | "restore";
  resourceIds?: number[];
  allMatching?: boolean;
  status?: ResourceStatusFilter;
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  hasOrder?: boolean | null;
}

export type InventoryExportMask = "none" | "middle" | "edges" | "id_only";
export type InventoryExportColumn =
  | "index" | "category" | "product" | "variant" | "id" | "status" | "data" | "order"
  | "created_at" | "assigned_at" | "expires_at" | "price";
export type InventoryResourceStatus = "available" | "assigned" | "error" | "expired";

export interface InventoryScope {
  variantIds?: number[];
  productIds?: number[];
  categoryIds?: number[];
  includeInactive?: boolean;
}

export interface InventoryExportParams extends InventoryScope {
  statuses?: InventoryResourceStatus[];
  includeArchived?: boolean;
  createdFrom?: string;
  createdTo?: string;
  assignedFrom?: string;
  assignedTo?: string;
  mask?: InventoryExportMask;
  maskChar?: string;
  format?: "csv" | "txt";
  columns?: InventoryExportColumn[];
  /** UI locale — drives CSV header language server-side. */
  locale?: string;
}

export interface InventoryExportPreview {
  rows: Record<InventoryExportColumn, string | number>[];
  total: number;
  packages: number;
  row_limit: number;
  columns: InventoryExportColumn[];
  headers: Record<InventoryExportColumn, string>;
}

export type InventoryReportGroup = "category" | "product" | "variant" | "day" | "week";
export type InventoryReportMetric = "added" | "sold" | "error" | "expired" | "archived" | "stock" | "revenue";
export type InventoryReportBasis = "created" | "assigned";

export interface InventoryReportParams extends InventoryScope {
  range: SellerDashboardRangeKey;
  from?: string;
  to?: string;
  tz?: string;
  groupBy?: InventoryReportGroup;
  basis?: InventoryReportBasis;
  compare?: boolean;
  lowOnly?: boolean;
  hasError?: boolean;
  noActivity?: boolean;
}

export interface InventoryReportRow {
  key: string;
  label: string | null;
  sublabel: string | null;
  product_id: number | null;
  product_title: string | null;
  category_id: number | null;
  category_name: string | null;
  category_parent_name: string | null;
  added: number;
  sold: number;
  error: number;
  expired: number;
  archived: number;
  stock: number;
  revenue: number;
  prev: Record<InventoryReportMetric, number> | null;
}

export interface InventoryReportResponse {
  range: SellerDashboardRange;
  group_by: InventoryReportGroup;
  basis: InventoryReportBasis;
  packages: number;
  rows: InventoryReportRow[];
  totals: Record<InventoryReportMetric, number>;
  prev_totals: Record<InventoryReportMetric, number> | null;
  low_stock_threshold: number;
}

export interface SiteAnalyticsConfig {
  /** Microsoft Clarity project id; null = tag not rendered. */
  clarity_project_id: string | null;
  updated_at: string | null;
  updated_by_id: number | null;
}

/** Admin-tunable AI provider. Which vendor answers is configuration, not code:
 *  any OpenAI-compatible host (OpenAI, DeepSeek, Groq, OpenRouter, Ollama…) is
 *  reachable by editing base_url + model + key. */
export interface AiProviderConfig {
  provider_kind: "openai_compatible" | "gemini_native";
  base_url: string;
  model: string;
  /** Tried in order when the primary model is overloaded or retired. */
  fallback_models: string[];
  /** The key itself is never sent to the browser — only whether one is stored. */
  api_key_configured: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  /** 0 = no ceiling. */
  daily_token_budget: number;
  is_enabled: boolean;
  updated_at: string | null;
  updated_by_id: number | null;
}

export interface AiConnectionTestResult {
  ok: boolean;
  model: string | null;
  latency_ms: number | null;
  /** True when a fallback answered — early warning that the default is failing. */
  used_fallback: boolean;
  error_kind: string | null;
  message: string;
}

export interface AiPromptTemplate {
  task: string;
  locale: string;
  system_prompt: string;
  user_prompt: string;
  updated_at: string | null;
  updated_by_id: number | null;
}

export interface AiUsageRow {
  task: string;
  calls: number;
  tokens: number;
  failures: number;
}

export interface AiUsageSummary {
  days: number;
  items: AiUsageRow[];
  /** 0 = no ceiling configured. */
  daily_token_budget: number;
  /** Trailing 24h, matching the window the budget check enforces. */
  tokens_used_today: number;
}

export interface TrustSeedDraft {
  index: number;
  rating: number;
  comment: string | null;
  seller_reply: string | null;
  /** Non-empty blocks apply; the server re-checks regardless. */
  problems: string[];
}

export interface TrustSeedGenerateResponse {
  product_id: number;
  product_title: string;
  model: string;
  used_fallback: boolean;
  locale: string;
  requested_count: number;
  distribution: Record<string, number>;
  /** Exact product facts sent to the model — shown so an admin can audit it. */
  product_context: string;
  drafts: TrustSeedDraft[];
}

export interface TrustSeedApplyResponse {
  batch_id: number;
  product_id: number;
  review_count: number;
  rating_avg: number | null;
  rating_count: number;
}

export interface TrustSeedBatch {
  id: number;
  product_id: number;
  status: "applied" | "purged";
  review_count: number;
  source: "ai" | "manual";
  model: string | null;
  locale: string;
  created_by_id: number;
  created_at: string | null;
  purged_at: string | null;
}

export interface TrustSeedSummary {
  product_id: number;
  seeded_reviews: number;
  total_visible_reviews: number;
  real_reviews: number;
  seed_pool_size: number;
}

export interface SellerRuntimeConfig {
  low_stock_threshold: number;
  inventory_export_row_limit: number;
  /** Days after the protection window ends during which a buyer may still review. */
  review_window_days: number;
  /** Days after purchase before an unreviewed order gets an automatic 5★. */
  auto_review_days: number;
  auto_review_enabled: boolean;
  updated_at: string | null;
  updated_by_id: number | null;
}

export interface AdminResource {
  id: number;
  variant_id: number;
  seller_id: number;
  status: string;
  order_id: number | null;
  assigned_at: string | null;
  expires_at: string | null;
  created_at: string;
  variant_name: string | null;
  product_title: string | null;
  product_id: number | null;
  seller_email: string | null;
}

export interface AdminResourceListResponse {
  items: AdminResource[];
  total: number;
  page: number;
  per_page: number;
}

export interface ResourceSummary {
  available: number;
  assigned: number;
  expired: number;
  error: number;
}

export interface ResourceSellerFacet {
  seller_id: number;
  seller_email: string | null;
  count: number;
}

export interface AdminProduct {
  id: number;
  title: string;
  service_type: string;
  status: string;
  seller_email: string | null;
  provider_name: string | null;
  adapter_type: string | null;
  pricing_strategy: string | null;
  order_count: number;
  revenue: number;
  needs_setup: boolean;
  needs_setup_reason: string | null;
  demo_mode: boolean;
}

export interface PaginatedOrderResponse {
  items: Order[];
  total: number;
  page: number;
  per_page: number;
}

export interface TikTokProfile {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  verified: boolean;
  private: boolean;
  bio: string | null;
  bio_link: string | null;
  url: string;
  follower_count: number;
  following_count: number;
  heart_count: number;
  video_count: number;
  friend_count: number;
  digg_count: number;
  language: string | null;
  created_at: string | null;
  commerce_user: boolean;
  tt_seller: boolean;
}

export interface TikTokLookupResponse {
  success: true;
  platform: "tiktok";
  username: string;
  profile: TikTokProfile;
  meta: {
    source: string | null;
    fetched_at: string | null;
  };
}

export type FacebookEntityType = "Profile" | "Page" | "Group" | "Event" | "Unknown";

export interface FacebookEntity {
  id: string;
  type: FacebookEntityType;
  username: string | null;
  name: string | null;
  avatar: string | null;
  url: string;
  description: string | null;
  likes: number | null;
  members: number | null;
  privacy: string | null;
  old_page_id: string | null;
}

export interface FacebookLookupResponse {
  success: true;
  platform: "facebook";
  query: { input: string; handle: string; kind: string };
  entity: FacebookEntity;
  meta: {
    source: string | null;
    data_status: string | null;
    cached: boolean;
    fetched_at: string;
  };
}

export interface OrderStats {
  total: number;
  active: number;
  /** Delivered, still in escrow, no open dispute — the buyer's to-do. */
  awaiting_confirm: number;
  disputed: number;
  cancelled_or_refunded: number;
  total_spend: number;
}

export interface LogEntry {
  id: number;
  service: string;
  level: string; // info | warning | critical
  request_id: string | null;
  job_id: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PricingField {
  field: string;
  type: "select" | "number" | "radio" | "textarea" | "slider";
  label: string;
  required?: boolean;
  // credit's package_size choices thật sự là number (khớp isinstance(x, int) backend
  // đòi hỏi) — không phải lúc nào cũng string như tên field gợi ý.
  /** credit: gói có giá riêng (nguồn API) mang `price` + `per_unit` */
  choices?: { value: string | number; label: string; price?: number; per_unit?: number }[];
  min?: number;
  max?: number;
  default?: string | number;
  placeholder?: string;
}

export interface PricingOptions {
  strategy: string;
  fields: PricingField[];
  base_info: { product_title: string; service_type: string } | null;
  ready: boolean;
  not_ready_reason: string | null;
  // Buyer-safe alias, never the upstream name: "auto_proxy" (always exactly 1
  // proxy per order), "auto_account" — see components/DynamicOrderForm.tsx.
  adapter_type: string | null;
}

export interface CalculateResult {
  amount: number;
  original_amount: number | null;
  discount_pct: number | null;
}

export interface ProductOperations {
  provider: { id: number; name: string; adapter_type: string; health: string } | null;
  pricing: { strategy: string; params: Record<string, unknown> };
  needs_setup: boolean;
  needs_setup_reason: string | null;
  demo_mode: boolean;
  stats: { total_orders: number; revenue: number; success_rate: number; disputes: number };
}

/** Một gói của sản phẩm proxy (`type|network|days`) kèm giá vốn — trang sửa sản phẩm. */
export interface ProxyPlanRow {
  plan_key: string;
  type: string;
  network: string;
  days: number;
  network_label: string;
  price: number | null;
  cost_price: number | null;
  /** Giá thấp nhất lưu được (vốn × (1 + lãi tối thiểu), làm tròn lên 1.000đ). */
  floor_price: number | null;
  margin_pct: number | null;
  margin_ok: boolean;
  /** false = nguồn không mua được gói này (lưu sẽ bị chặn). */
  supported: boolean;
}

export interface ProxyProductPlans {
  adapter: string;
  min_margin_pct: number;
  /** Giá đang suy từ công thức cũ; lưu lại sẽ chuyển hẳn sang bảng gói. */
  from_formula: boolean;
  /** TopProxy: thêm kỳ hạn mới được. DProxy: gói do admin map. */
  can_add: boolean;
  /** Giao thức cùng giá (TopProxy HTTP/SOCKS5) — gộp thành một dòng. */
  protocols: string[];
  networks: { code: string; label: string }[];
  plans: ProxyPlanRow[];
}

export interface DashboardResource {
  /** "res-<id>" (Resource kiểu cũ) hoặc "alloc-<id>" (proxy mua qua adapter).
   *  Có tiền tố vì hai bảng đánh id độc lập, gộp lại dễ trùng. */
  id: string;
  status: string;
  /** Rỗng khi không có credential để hiện — vd binding key xoay chỉ có IP hiện
   *  hành, và keyxoay thì không bao giờ gửi xuống buyer. */
  data: string;
  expires_at: string | null;
}

export interface DashboardUsage {
  requests_today: number;
  credits_used: number;
  credits_remaining: number;
}

export interface UsageRecordItem {
  id: number;
  endpoint: string;
  units: number;
  status: "ok" | "rejected_quota" | "rejected_expired";
  created_at: string;
}

export interface GatewayCallLogItem {
  id: number;
  endpoint: string;
  status_code: number | null;
  latency_ms: number;
  request_payload: Record<string, unknown> | null;
  response_snippet: string | null;
  error: string | null;
  /** request đã trừ cho lần gọi (0 = không trừ/đã hoàn); null với dòng cũ */
  units_charged?: number | null;
  units_remaining?: number | null;
  created_at: string;
}

export interface UsageBalance {
  units_total: number;
  units_used: number;
  units_remaining: number;
  expires_at: string | null;
  records: UsageRecordItem[];
  /** Chi tiết từng lần gọi qua gateway thật (status code, payload, trích response) —
   *  chỉ lưu ~7 ngày gần nhất (xem GATEWAY_CALL_LOG_RETENTION_DAYS backend), không
   *  phải sổ billing (đó là `records` ở trên). */
  gateway_calls?: GatewayCallLogItem[];
}

export interface ChargeUsageResult {
  units_total: number;
  units_used: number;
  units_remaining: number;
}

export interface DashboardTask {
  id: number;
  platform: string;
  target_url: string;
  status: string;
  assignee: string | null;
  result_data: string | null;
  created_at: string;
}

export interface DashboardData {
  type: string;
  order_id: number;
  status: string;
  service_type: string;
  product_title: string;
  product_id?: number | null;
  resources?: DashboardResource[];
  /** @deprecated Legacy proxy-only field — luôn rỗng cho service_type=endpoint, dùng `balance` thay thế. */
  usage?: DashboardUsage[];
  tasks?: DashboardTask[];
  delivered_data?: string;
  /** Chỉ có khi service_type=endpoint và order đã strategy=credit + delivered. */
  balance?: UsageBalance | null;
  /** service_type=endpoint: endpoint bán được + quy tắc trừ request */
  api?: { endpoints: GatewayEndpoint[]; charge_only_success: boolean } | null;
}

export interface GatewayEndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface GatewayEndpoint {
  name: string;
  method: string;
  units: number;
  summary: string;
  params: GatewayEndpointParam[];
  sample_body: Record<string, unknown>;
  /** chỉ admin */
  path?: string;
}

export interface GatewayTryResult {
  status_code: number | null;
  latency_ms: number;
  body: string;
  truncated: boolean;
  units_charged?: number;
  units_remaining?: number;
  content_type?: string;
}

export interface AffiliateTotals {
  clicks: number;
  signups: number;
  orders: number;
  revenue: number;
  commission: number;
}

export interface AffiliateTimeseriesPoint {
  date: string;
  clicks: number;
  signups: number;
  orders: number;
  revenue: number;
  commission: number;
}

export interface AffiliateCommissionRow {
  id: number;
  order_id: number;
  order_code?: string | null;
  buyer_account_id: number;
  rate_percent: number;
  /** Platform fee the rate was applied to; null for legacy rows. */
  fee_base_amount?: number | null;
  amount: number;
  created_at: string;
  product_title: string | null;
  order_total: number | null;
}

export interface AffiliateRuntimeConfig {
  enabled: boolean;
  /** Referrer's share of the platform fee on each settled order (0–100). */
  commission_percent_of_fee: number;
  /** Days the `?ref=` cookie keeps attributing a sign-up. */
  attribution_days: number;
  /** Days after the referred user's sign-up that still earn; 0 = lifetime. */
  earning_days: number;
  max_commissions_per_day: number;
  updated_at: string | null;
  updated_by_id: number | null;
}

export interface PublicAffiliateConfig {
  enabled: boolean;
  attribution_days: number;
  /** Days after a referred sign-up that still earn; 0 = lifetime. */
  earning_days: number;
}

export interface ContentFilterConfig {
  enabled: boolean;
  action: "block" | "mask";
  keywords: string[];
  block_phone_numbers: boolean;
  block_links: boolean;
  mask_char: string;
  updated_at: string | null;
  updated_by_id: number | null;
}

export interface ContentFilterTestResult {
  blocked: boolean;
  text: string;
  matches: string[];
}

export interface ReferredUserRow {
  id: number;
  email: string;
  created_at: string;
  order_count: number;
  total_spent: number | null;
}

export interface AffiliateStats {
  code: string;
  link: string;
  email?: string | null;
  totals: AffiliateTotals;
  timeseries: AffiliateTimeseriesPoint[];
  commissions: AffiliateCommissionRow[];
  referred_users: ReferredUserRow[];
}

export interface AffiliateSummary {
  id: number;
  email: string;
  affiliate_code: string;
  clicks: number;
  signups: number;
  orders: number;
  commission: number;
}

export interface AffiliateListSummary {
  /** Accounts matching the current search/filter (not just this page). */
  accounts: number;
  /** …of which have at least one click, sign-up or paid commission. */
  active: number;
  clicks: number;
  signups: number;
  orders: number;
  commission: number;
}

export interface PaginatedAffiliateSummary {
  items: AffiliateSummary[];
  total: number;
  page: number;
  per_page: number;
  summary: AffiliateListSummary;
}

export type AffiliateSort = "commission" | "clicks" | "signups" | "orders" | "newest" | "email";

export interface FundEntry {
  id: number;
  amount: number;
  kind: string;
  reference_id: string | null;
  note: string | null;
  created_at: string;
}

export interface FundOverview {
  balance: number;
  total_topped_up: number;
  total_paid_out: number;
  entries: FundEntry[];
}

export interface AccountAdminRow {
  id: number;
  email: string;
  roles: string[];
  is_active: boolean;
  email_verified: boolean;
  totp_enabled: boolean;
  seller_tier: string;
  is_internal?: boolean;
  created_at: string;
  /** Last successful sign-in (from login_events); null = never. */
  last_login_at?: string | null;
}

export interface AccountsSummary {
  all: number;
  buyers: number;
  sellers: number;
  admins: number;
  locked: number;
  unverified: number;
  twofa: number;
  internal: number;
  new_7d: number;
}

export interface PaginatedAccounts {
  items: AccountAdminRow[];
  total: number;
  page: number;
  per_page: number;
  summary?: AccountsSummary;
}

export interface SellerApplication {
  id: number;
  account_id: number;
  business_name: string;
  description: string | null;
  contact: string | null;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Storefront search (GET /search/suggest, GET /search)
// ---------------------------------------------------------------------------

/** Slim product row for the command palette. No sequential ids: `canonical_path` is the link. */
export interface SearchProductHit {
  public_key: string;
  slug: string;
  canonical_path: string;
  title: string;
  highlight_text: string | null;
  cover_id: string | null;
  service_type: string | null;
  category_id: number;
  category_slug: string;
  category_name: string;
  seller_name: string | null;
  seller_path: string | null;
  /** Storefront "from" price in ledger units; null when nothing is priced yet. */
  price_from: number | null;
  sold_count: number;
  rating_avg: number | null;
  rating_count: number;
}

export interface SearchCategoryHit {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  parent_id: number | null;
  parent_name: string | null;
  parent_slug: string | null;
}

export interface SearchSuggest {
  query: string;
  products: SearchProductHit[];
  categories: SearchCategoryHit[];
  sellers: SellerSummary[];
}

export interface SearchResult {
  query: string;
  products: PaginatedProducts;
  categories: SearchCategoryHit[];
  sellers: SellerSummary[];
}

export interface SearchQueryStat {
  query: string;
  searches: number;
  zero_results: number;
  last_searched_at: string;
}

export interface SearchSynonymGroup {
  group_key: string;
  terms: string[];
}

export type LoginResult = { token_type: string; mfa_required?: false } | { mfa_required: true; mfa_token: string };

export interface PublicAuthConfig {
  turnstile_site_key: string;
  require_email_verification: boolean;
  mfa_enabled: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauth_uri: string;
}

// --- Nguồn hàng (supplier sources) — src/suppliers/sources.py -----------------
export type SourceArea = "seller" | "admin";

export interface SupplierSource {
  id: number;
  /** URL identity on seller surfaces (see features/seller-sources/logic.ts::sourceRef). */
  public_key: string;
  name: string;
  adapter_type: string;
  /** catalog = kho SKU mua theo đơn; proxy = nhà cung cấp proxy có catalog gói; server = còn lại */
  kind: "catalog" | "proxy" | "gateway" | "server";
  is_active: boolean;
  review_status: string;
  seller_id: number | null;
  seller_email: string | null;
  seller_is_internal: boolean;
  seller_business_name: string | null;
  min_margin_pct: number;
  low_balance_vnd: number | string | null;
  /** luật giá: giá bán = vốn × (1 + markup%), làm tròn lên round_to */
  markup_pct: number;
  round_to: number;
  follow_cost: boolean;
  /** số dư tài khoản bên nguồn lần kiểm tra/đồng bộ gần nhất */
  balance_vnd: number | null;
  /** phân loại đang bán được (không bị chặn, không tắt) */
  active_listing_count: number;
  /** lỗi đồng bộ gần nhất (không phải SKU bị gỡ) — nguồn vẫn bán theo dữ liệu cũ */
  sync_error: string | null;
  stats_7d: SourcePurchaseSummary;
  /** nguồn API: request 24h, key còn request, doanh thu / lời 7 ngày */
  gateway_stats: GatewayStats | null;
  catalog_count: number;
  catalog_synced_at: string | null;
  listing_count: number;
  listing_error_count: number;
  listing_low_margin_count: number;
  listing_auto_paused_count: number;
  product_count: number;
  attention_count: number;
  last_test_result: Record<string, unknown> | null;
  last_tested_at: string | null;
}

export interface SourceKindField {
  key: string;
  label: string;
  default?: string | number;
  secret?: boolean;
  type?: "number" | "text" | "select";
  options?: { value: string; label: string }[];
  hint?: string;
  /** ẩn sau "Nâng cao" trong wizard */
  advanced?: boolean;
}

export interface SourceKind {
  adapter_type: string;
  label: string;
  kind: "catalog" | "proxy" | "gateway" | "server";
  description: string;
  fields: SourceKindField[];
}

export interface SourceSellerCandidate {
  id: number;
  email: string;
  is_internal: boolean;
  business_name: string | null;
  source_count: number;
}

export interface SourceCreateRequest {
  adapter_type: string;
  name: string;
  config: Record<string, string | number>;
  seller_id?: number | null;
  new_seller?: { email: string; business_name: string } | null;
}

export interface SourceCreateResult {
  provider_id: number;
  name: string;
  adapter_type: string;
  kind: "catalog" | "proxy" | "gateway" | "server";
  seller_id: number | null;
  seller_email: string | null;
  catalog_items: number;
  sync_error: string | null;
}

export interface SourceTestResult {
  ok: boolean;
  health: { status?: string; message?: string; balance_vnd?: number };
  /** nguồn catalog: số mặt hàng đọc được lúc kiểm tra */
  catalog?: { total: number; in_stock: number } | null;
  tested_at?: string;
}

export interface SourceCatalogAttached {
  variant_id: number;
  variant_name: string;
  price: number;
  product_id: number;
  product_title: string;
}

export interface SourceCatalogItem {
  external_id: string;
  name: string;
  cost_price: number;
  amount: number;
  min_qty: number;
  max_qty: number | null;
  format_hint: string | null;
  group_name: string;
  category_path: string[];
  synced_at: string;
  /** Thuộc tính máy của gói (proxy): duration_days, loaiproxy, mode, currency, proxy_count… */
  extra: Record<string, unknown>;
  attached: SourceCatalogAttached[];
}

/** Một gói proxy đang bán = một key `type|network|days` trong pricing config của sản phẩm. */
export interface SourceOffer {
  product_id: number;
  product_title: string;
  product_key: string | null;
  product_status: string;
  plan_key: string;
  type: string;
  network: string;
  days: number;
  label: string;
  price: number;
  cost_price: number | null;
  margin_pct: number | null;
  margin_ok: boolean;
  external_id: string | null;
  external_name: string | null;
  unmapped: boolean;
  // Mapped, but the plan is gone from the last synced upstream catalog.
  plan_missing?: boolean;
  // Last synced upstream availability (store/quote); null = unknown.
  upstream_available?: boolean | null;
}

export interface SourcePlanImportItem {
  external_id: string;
  type?: string;
  network?: string;
  days?: number;
  price?: number;
  type_label?: string;
  network_label?: string;
  title?: string;
  category_id?: number;
  status?: "draft" | "active";
  description?: string;
  escrow_days?: number;
  product_id?: number;
  group_key?: string;
}

export interface SourcePlanImportResult {
  product_id: number;
  product_title: string;
  public_key: string | null;
  plan_key: string;
  price: number;
  cost_price: number | null;
  margin_ok: boolean;
}

export interface SourceCatalogPage {
  items: SourceCatalogItem[];
  total: number;
  page: number;
  per_page: number;
  groups: { name: string; count: number }[];
  min_margin_pct: number;
}

export interface SourceCatalogQuery {
  q?: string;
  group?: string;
  in_stock?: boolean;
  max_cost?: number | null;
  page?: number;
  per_page?: number;
  sort?: "stock" | "cost_asc" | "cost_desc" | "name";
}

export interface SourceImportItem {
  external_id: string;
  category_id: number;
  title?: string;
  variant_name?: string;
  price?: number;
  status?: "draft" | "active";
  description?: string;
  warranty_text?: string;
  service_type?: string;
  /** Thêm phân loại vào sản phẩm có sẵn */
  product_id?: number | null;
  /** Các item cùng key → một sản phẩm mới */
  group_key?: string | null;
}

export interface SourceImportResult {
  product_id: number;
  product_title: string;
  public_key: string;
  variant_id: number;
  price: number;
  listing_id: number;
  margin_ok: boolean;
}

export interface SourceListing {
  listing_id: number;
  provider_id: number;
  product_id: number;
  product_title: string;
  product_status: string;
  public_key: string;
  seller_id: number;
  variant_id: number;
  variant_public_key: string;
  variant_name: string;
  variant_active: boolean;
  price: number;
  external_id: string;
  external_name: string | null;
  cost_price: number;
  margin_pct: number | null;
  margin_ok: boolean;
  upstream_amount: number;
  sellable: number;
  upstream_min: number;
  upstream_max: number | null;
  format_hint: string | null;
  synced_at: string | null;
  sync_error: string | null;
  /** cầu dao: số lần mua lỗi liên tiếp; auto_paused_at ≠ null = gói bị tự tắt */
  fail_streak: number;
  last_fail_at: string | null;
  last_fail_reason: string | null;
  auto_paused_at: string | null;
  category_path: string[];
  /** nhóm gốc bên nguồn (Facebook, Gmail…) */
  group_name: string;
  /** giá gõ tay → luật giá không ghi đè */
  price_manual: boolean;
  /** giá theo luật của nguồn với giá vốn hiện tại */
  rule_price: number | null;
}

export interface SourceSyncResult {
  provider_id: number;
  updated: number;
  delisted: number;
  low_margin: number;
  repriced: number;
  catalog_items: number;
  error: string | null;
}

export interface SourceRepriceChange {
  listing_id: number;
  variant_id: number;
  product_title: string;
  variant_name: string;
  cost_price: number;
  old_price: number;
  new_price: number;
}

export interface SourceRepriceResult {
  changed: SourceRepriceChange[];
  unchanged: number;
  skipped_manual: { listing_id: number; product_title: string; variant_name: string; price: number; margin_ok: boolean }[];
  margin_pct: number;
  round_to: number;
  min_margin_pct: number;
  dry_run: boolean;
}

export interface SourceRepriceRequest {
  margin_pct?: number;
  round_to?: number;
  listing_ids?: number[];
  only_below_min?: boolean;
  dry_run?: boolean;
  include_manual?: boolean;
}

export interface SourceListingUpdate {
  price?: number;
  variant_name?: string;
  external_id?: string;
  is_active?: boolean;
  product_id?: number;
  /** false → trả về luật giá */
  price_manual?: boolean;
}

export interface SourcePurchaseSummary {
  orders: number;
  ok: number;
  failed: number;
  pending: number;
  units: number;
  /** khách trả (đã trừ hoàn) của đơn giao thành công */
  paid: number;
  /** tiền nguồn đã trừ */
  cost: number;
  profit: number;
  refunded: number;
}

export type SourcePurchaseResult = "ok" | "failed" | "pending";

export interface SourcePurchase {
  order_id: number;
  order_code: string;
  created_at: string;
  product_title: string | null;
  variant_name: string | null;
  quantity: number;
  total_amount: number;
  paid: number;
  refunded: number;
  cost: number;
  /** đơn cũ chưa có dòng mua → vốn ước tính theo giá vốn hiện tại */
  cost_estimated: boolean;
  profit: number;
  result: SourcePurchaseResult;
  error: string | null;
  trans_id: string | null;
}

export interface SourcePurchasePage {
  summary: SourcePurchaseSummary;
  counts: { all: number; ok: number; failed: number; pending: number };
  days: 1 | 7 | 30;
  items: SourcePurchase[];
  total: number;
  page: number;
  per_page: number;
}

export interface SourcePurchaseQuery {
  days?: 1 | 7 | 30;
  result?: "all" | SourcePurchaseResult;
  q?: string;
  page?: number;
  per_page?: number;
}

export interface SourceSettings {
  id: number;
  name: string;
  adapter_type: string;
  kind: "catalog" | "proxy" | "gateway" | "server";
  is_active: boolean;
  markup_pct: number;
  round_to: number;
  follow_cost: boolean;
  min_margin_pct: number;
  auto_pause_after_failures: number;
  low_balance_vnd: number;
  balance_vnd: number | null;
  last_test_result: Record<string, unknown> | null;
  last_tested_at: string | null;
  seller: { id: number; email: string; business_name: string | null; is_internal: boolean } | null;
  /** admin: thấy/sửa kết nối, tên, bật-tắt, cửa hàng */
  can_manage_connection: boolean;
  base_url: string | null;
  api_key_hint: string | null;
  timeout_seconds: number;
  max_attempts: number;
  rate_limit_per_minute: number | null;
}

export interface SourceSettingsUpdate {
  markup_pct?: number;
  round_to?: number;
  follow_cost?: boolean;
  min_margin_pct?: number;
  auto_pause_after_failures?: number;
  low_balance_vnd?: number;
  name?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
  seller_id?: number;
  timeout_seconds?: number;
  max_attempts?: number;
  rate_limit_per_minute?: number;
}

export interface GatewayStats {
  requests_24h: number;
  ok_24h: number;
  errors_24h: number;
  active_keys: number;
  sales_7d: number;
  profit_7d: number;
}

export interface GatewayPackage {
  label: string;
  size: number;
  price: number;
  active: boolean;
  per_request?: number;
  profit_per_request?: number | null;
}

export interface GatewayOverview {
  product: { id: number; public_key: string; title: string; category_id: number; status: string } | null;
  packages: GatewayPackage[];
  cost_per_request: number;
  endpoints: GatewayEndpoint[];
  charge_only_success: boolean;
  timeout_seconds: number;
  rate_limit_per_minute: number | null;
}

export interface GatewayPackagesUpdate {
  packages?: { label: string; size: number; price: number; active: boolean }[];
  cost_per_request?: number;
  title?: string;
  category_id?: number;
  publish?: boolean;
}

export interface GatewayRequestRow {
  id: number;
  created_at: string;
  order_code: string;
  key_prefix: string | null;
  endpoint: string;
  status_code: number | null;
  latency_ms: number;
  error: string | null;
  units_charged: number | null;
  units_remaining: number | null;
  ok: boolean;
}

export interface GatewayRequestPage {
  summary: { requests: number; ok: number; errors: number; charged: number; avg_latency_ms: number | null; max_latency_ms: number | null; active_keys: number };
  items: GatewayRequestRow[];
  total: number;
  page: number;
  per_page: number;
  hours: number;
}

export interface SiteAnnouncement {
  level: "info" | "warn" | "danger";
  text_vi: string;
  text_en: string;
  link_url: string;
  version: number;
}

export interface SiteStatusPublic {
  maintenance_enabled: boolean;
  maintenance_message_vi: string;
  maintenance_message_en: string;
  maintenance_until: string | null;
  withdrawals_frozen: boolean;
  deposits_frozen: boolean;
  orders_frozen: boolean;
  announcement: SiteAnnouncement | null;
}

export interface SiteStatusAdmin {
  maintenance_enabled: boolean;
  maintenance_message_vi: string;
  maintenance_message_en: string;
  maintenance_until: string | null;
  withdrawals_frozen: boolean;
  deposits_frozen: boolean;
  orders_frozen: boolean;
  freeze_reason: string;
  announcement_enabled: boolean;
  announcement_level: "info" | "warn" | "danger";
  announcement_text_vi: string;
  announcement_text_en: string;
  announcement_link_url: string;
  announcement_starts_at: string | null;
  announcement_ends_at: string | null;
  announcement_version: number;
  updated_at: string | null;
  updated_by_id: number | null;
}

export type SiteStatusUpdate = Partial<Omit<SiteStatusAdmin, "announcement_version" | "updated_at" | "updated_by_id">> & {
  clear_maintenance_until?: boolean;
  clear_announcement_window?: boolean;
};

// --- Ledger reconciliation (Admin › Reports) ---
export type LedgerFinding = {
  kind: "wallet_available" | "wallet_locked" | "order_hold" | "order_refund" | "order_settlement" | "order_release_early" | "platform";
  target_type: "wallet" | "order" | "platform";
  target_id: number;
  expected: number;
  actual: number;
  delta: number;
  detail: string;
};
export type LedgerRun = {
  id: number;
  ran_at: string;
  duration_ms: number;
  trigger: "schedule" | "manual";
  ok: boolean;
  wallets_checked: number;
  orders_checked: number;
  mismatch_count: number;
  totals: Partial<Record<"available" | "locked" | "escrow_open" | "held_total" | "money_in" | "money_out" | "net_in", number>>;
  findings: LedgerFinding[];
};

// --- Fees & holds (Settings › Fees & holds) ---
export type FeeConfigPublic = {
  platform_fee_percent: number;
  category_fee_percent: Record<string, number>;
  escrow_default_days: number;
  escrow_min_days: number;
  category_escrow_min_days: Record<string, number>;
  withdraw_min_amount: number;
  withdraw_fee_fixed: number;
  withdraw_fee_percent: number;
  dispute_seller_response_hours: number;
};
export type FeeConfigAdmin = FeeConfigPublic & { updated_at: string | null; updated_by_id: number | null };
export type FeeConfigUpdate = Partial<FeeConfigPublic>;
export type WithdrawQuote = { amount: number; fee_amount: number; net_amount: number; min_amount: number; fee_fixed: number; fee_percent: number };
