export interface Account {
  id: number;
  email: string;
  roles: string[];
  seller_tier?: string;
  affiliate_code?: string;
  referred_by_id?: number | null;
}

export interface ChatMessage {
  id: number;
  client_message_id: string;
  body: string;
  sender_id: number;
  sender_role: "buyer" | "seller" | "admin";
  created_at: string;
}

export interface ChatConversation {
  id: string;
  kind: "product_inquiry" | "order" | "support";
  status: "open" | "resolved" | "closed" | "blocked" | "read_only";
  product: { id: number; title: string; image: string | null } | null;
  order: {
    id: number;
    status: string;
    quantity: number;
    total_amount: number;
    cancel_reason: string | null;
  } | null;
  counterpart: { id: number; label: string; role: "buyer" | "seller" | "admin" };
  last_message: ChatMessage | null;
  unread_count: number;
  can_send: boolean;
  read_only_reason: string | null;
  created_at: string;
}

export interface ChatConversationDetail extends ChatConversation {
  messages: ChatMessage[];
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

/** Item danh sách sản phẩm (GET /products, /seller/products) — bản GỌN.
 *  description/specs/features/warranty_text chỉ có ở ProductDetail (trang chi
 *  tiết mới cần, mô tả markdown dài nhân N sản phẩm là payload phình vô ích);
 *  commission_rate chỉ có ở AdminProductDetail (không phát ra API public). */
export interface Product {
  id: number;
  seller_id: number;
  category_id: number;
  title: string;
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

export interface PaginatedProducts {
  items: Product[];
  total: number;
  page: number;
  per_page: number;
}

export interface Variant {
  id: number;
  product_id: number;
  name: string;
  price: number;
  delivery_mode: string;
  sla_hours: number;
  sort_order: number;
  is_active: boolean;
  stock_count: number;
  duration_days: number | null;
  translations?: Partial<Record<ProductLocale, { name?: string | null }>> | null;
  primary_locale?: ProductLocale | null;
}

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
}

export interface Order {
  id: number;
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
  cancel_reason?: string | null;
  created_at: string;
  product_title?: string | null;
  pricing_strategy?: string | null;
  delivery_mode?: string | null;
  sla_hours?: number | null;
  variant_name?: string | null;
  buyer_email?: string | null;
  seller_email?: string | null;
  has_review?: boolean;
  has_dispute?: boolean;
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
  account_id: number;
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
  buyer_id: number;
  reason: string;
  evidence_type?: string | null;
  evidence?: Record<string, string> | null;
  status: string;
  admin_note: string | null;
  seller_note: string | null;
  created_at: string;
  resolved_at: string | null;
  product_title?: string | null;
  variant_name?: string | null;
  buyer_email?: string | null;
  order_amount?: number | null;
}

export interface AdminDisputeOrder {
  id: number;
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

export interface Review {
  id: number;
  order_id: number;
  buyer_id: number;
  product_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface SellerProduct extends Product {
  category_name: string | null;
  variant_count: number;
  total_stock: number;
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
  assigned_at: string | null;
  expires_at: string | null;
  created_at: string;
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

export interface OrderStats {
  total: number;
  active: number;
  disputed: number;
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
  choices?: { value: string | number; label: string }[];
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
  // Buyer-safe hint for adapter-specific purchase UX (e.g. "dproxy" always
  // delivers exactly 1 proxy — see components/DynamicOrderForm.tsx).
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
  buyer_account_id: number;
  rate_percent: number;
  amount: number;
  created_at: string;
  product_title: string | null;
  order_total: number | null;
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

export interface PaginatedAffiliateSummary {
  items: AffiliateSummary[];
  total: number;
  page: number;
  per_page: number;
}

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
  seller_tier: string;
  created_at: string;
}

export interface PaginatedAccounts {
  items: AccountAdminRow[];
  total: number;
  page: number;
  per_page: number;
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
