export interface Account {
  id: number;
  email: string;
  roles: string[];
  seller_tier?: string;
  affiliate_code?: string;
  referred_by_id?: number | null;
}

export interface SellerApiKeyCreated {
  id: number;
  key: string;
  key_prefix: string;
  created_at: string;
}

export interface SellerApiKey {
  id: number;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
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

export interface Product {
  id: number;
  seller_id: number;
  category_id: number;
  title: string;
  description: string | null;
  images: Record<string, unknown> | null;
  escrow_days: number;
  status: string;
  service_type: string | null;
  features: string[] | null;
  specs: Record<string, string> | null;
  warranty_text: string | null;
  highlight_text: string | null;
  sold_count: number;
  rating_avg: number | null;
  rating_count: number;
  pricing_strategy?: string | null;
  pricing_params?: Record<string, unknown> | null;
  commission_rate?: number | null;
  created_at: string;
  /** GET /products trả kèm gói + tồn kho (fix N+1 trang chủ) — optional vì
   *  một số response cũ (đơn hàng, admin) vẫn là Product trần. */
  variants?: Variant[];
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
}

export interface ProductDetail extends Product {
  variants: Variant[];
  seller_email: string | null;
  category_name: string | null;
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
  status: string;
  escrow_expires_at: string | null;
  delivered_data: string | null;
  cancel_reason?: string | null;
  created_at: string;
  product_title?: string | null;
  variant_name?: string | null;
  buyer_email?: string | null;
  seller_email?: string | null;
  has_review?: boolean;
  has_dispute?: boolean;
}

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
  email: string;
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
  created_at: string;
}

export interface DepositIntent {
  id: number;
  amount: number;
  status: "pending" | "paid" | "cancelled" | "expired";
  checkout_url?: string | null;
  qr_code?: string | null;
  paid_amount?: number | null;
  created_at: string;
  expires_at: string;
  paid_at?: string | null;
}

export interface AdminDepositIntent extends DepositIntent {
  account_id: number;
  account_email?: string | null;
  payment_link_id?: string | null;
  payos_reference?: string | null;
}

export interface PayosWebhookEventRow {
  id: number;
  order_code: number;
  payment_link_id: string;
  reference: string;
  amount: number;
  signature_valid: boolean;
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
  review_status: "approved" | "pending_review" | "rejected" | "disabled";
  review_note: string | null;
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

export interface UsageBalance {
  units_total: number;
  units_used: number;
  units_remaining: number;
  expires_at: string | null;
  records: UsageRecordItem[];
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
