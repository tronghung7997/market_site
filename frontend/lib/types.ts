export interface Account {
  id: number;
  email: string;
  roles: string[];
  affiliate_code?: string;
  referred_by_id?: number | null;
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

export interface Wallet {
  id: number;
  account_id: number;
  balance: number;
  updated_at: string;
}

export interface Transaction {
  id: number;
  type: string;
  amount: number;
  description: string | null;
  reference_id: string | null;
  created_at: string;
}

export interface Order {
  id: number;
  buyer_id: number;
  seller_id: number;
  variant_id: number;
  quantity: number;
  total_amount: number;
  status: string;
  escrow_expires_at: string | null;
  delivered_data: string | null;
  created_at: string;
  product_title?: string | null;
  variant_name?: string | null;
  buyer_email?: string | null;
  seller_email?: string | null;
  has_review?: boolean;
}

export interface TimelineEvent {
  event: string;
  timestamp: string;
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
}

export type SellerProfile = SellerSummary;

export interface WithdrawRequest {
  id: number;
  account_id: number;
  account_email?: string | null;
  amount: number;
  status: string;
  created_at: string;
}

export interface AdminOrderDetail extends Order {
  resources: ResourceInfo[];
  dispute: DisputeInfo | null;
  timeline: TimelineEvent[];
}

export interface Dispute {
  id: number;
  order_id: number;
  buyer_id: number;
  reason: string;
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
  variant_id: number;
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
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  default?: string | number;
}

export interface PricingOptions {
  strategy: string;
  fields: PricingField[];
  base_info: { product_title: string; service_type: string } | null;
}

export interface CalculateResult {
  amount: number;
  original_amount: number | null;
  discount_pct: number | null;
}

export interface ProductOperations {
  provider: { id: number; name: string; adapter_type: string; health: string } | null;
  pricing: { strategy: string; params: Record<string, unknown> };
  stats: { total_orders: number; revenue: number; success_rate: number; disputes: number };
}

export interface DashboardResource {
  id: number;
  status: string;
  data: string;
  expires_at: string | null;
}

export interface DashboardUsage {
  requests_today: number;
  credits_used: number;
  credits_remaining: number;
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
  resources?: DashboardResource[];
  usage?: DashboardUsage[];
  tasks?: DashboardTask[];
  delivered_data?: string;
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
