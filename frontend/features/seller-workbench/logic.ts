import {
  effectiveMoneyInputCurrency,
  moneyInputToVnd,
  vndToMoneyInput,
} from "../../lib/money/format.ts";

export type Archetype = "A" | "B";
export type WorkModelB = "B1" | "B2" | "B3";

export interface WorkbenchVariant {
  id?: number;
  name: string;
  price: number;
  delivery_mode: "instant" | "manual";
  stock_count: number;
  sla_hours?: number;
  is_active?: boolean;
}

export interface B1ConfigState {
  basePrice: number;
  types: { key: string; label: string; mult: number }[];
  networks: { key: string; label: string; mult: number }[];
  durations: { days: number; label: string }[];
  selectedType: string;
  selectedNetwork: string;
  selectedDays: number;
  qty: number;
  isSingleUnit: boolean;
}

export interface B2CreditState {
  creditPrice: number;
  packages: { size: number; label: string; discountPct: number }[];
  selectedPackageSize: number;
}

export interface B3TaskState {
  basePrice: number;
  platforms: { key: string; label: string; mult: number }[];
  selectedPlatform: string;
  urls: string;
}

export interface BackendState {
  status: "none" | "pending" | "approved" | "mismatch" | "demo";
  name: string;
  providerType?: string;
}

export interface BuyerContentDraft {
  title: string;
  description: string;
  highlightText: string;
  featuresText: string;
  specsText: string;
  warrantyText: string;
}

export type BilingualBuyerContent = Record<"vi" | "en", BuyerContentDraft>;

export interface BuyerContentTranslation {
  title: string;
  description: string;
  highlight_text: string | null;
  features: string[];
  specs: Record<string, string>;
  warranty_text: string | null;
}

export interface DynamicPricingPlan {
  strategy: "config" | "credit" | "task";
  params: Record<string, unknown>;
}

export interface DynamicPricingLabels {
  field_labels?: Record<string, string>;
  type_display?: Record<string, string>;
  network_display?: Record<string, string>;
  platform_display?: Record<string, string>;
  duration_labels?: Record<string, string>;
  package_labels?: Record<string, string>;
}

export interface ChecklistItem {
  key: string;
  labelKey: string;
  pass: boolean;
}

export interface SellableEvaluation {
  checks: ChecklistItem[];
  isSellable: boolean;
  passCount: number;
  totalCount: number;
}

export type PriceInputCurrency = "VND" | "USD";

export const effectivePriceInputCurrency = effectiveMoneyInputCurrency;
export const priceInputToVnd = moneyInputToVnd;
export const vndToPriceInput = vndToMoneyInput;

export function parseResourceLines(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of raw.split("\n")) {
    const value = line.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    items.push(value);
  }
  return items;
}

export function parseFeatureLines(raw: string): string[] {
  return raw.split("\n").map((value) => value.trim()).filter(Boolean);
}

export function parseSpecLines(raw: string): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && value) specs[key] = value;
  }
  return specs;
}

export function buyerContentToTranslation(content: BuyerContentDraft): BuyerContentTranslation {
  return {
    title: content.title.trim(),
    description: content.description.trim(),
    highlight_text: content.highlightText.trim() || null,
    features: parseFeatureLines(content.featuresText),
    specs: parseSpecLines(content.specsText),
    warranty_text: content.warrantyText.trim() || null,
  };
}

export function hasCompleteLocalizedContent(
  content: BilingualBuyerContent,
  locale: "vi" | "en",
): boolean {
  return content[locale].title.trim().length > 0
    && content[locale].description.trim().length > 0;
}

function keyedNumbers(items: { key: string; mult: number }[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [item.key, item.mult]));
}

export function buildDynamicPricingPlan(
  workModel: WorkModelB,
  b1: B1ConfigState,
  b2: B2CreditState,
  b3: B3TaskState,
): DynamicPricingPlan {
  if (workModel === "B1") {
    return {
      strategy: "config",
      params: {
        base_price: b1.basePrice,
        type_mult: keyedNumbers(b1.types),
        network_mult: keyedNumbers(b1.networks),
        duration_options: b1.durations.map(({ days, label }) => ({ days, label })),
      },
    };
  }
  if (workModel === "B2") {
    return {
      strategy: "credit",
      params: {
        credit_price: b2.creditPrice,
        packages: b2.packages.map(({ size, label }) => ({ size, label })),
        volume_tiers: b2.packages
          .filter((item) => item.discountPct > 0)
          .map((item) => ({ min_qty: item.size, discount: item.discountPct / 100 })),
      },
    };
  }
  return {
    strategy: "task",
    params: {
      base_price: b3.basePrice,
      platform_mult: keyedNumbers(b3.platforms),
    },
  };
}

export function buildDynamicPricingLabels(
  workModel: WorkModelB,
  locale: "vi" | "en",
  b1: B1ConfigState,
  b2: B2CreditState,
  b3: B3TaskState,
): DynamicPricingLabels {
  const vi = locale === "vi";
  if (workModel === "B1") {
    const typeDefaults: Record<string, string> = vi
      ? { residential: "Dân cư sạch", datacenter: "Trung tâm dữ liệu" }
      : { residential: "Residential", datacenter: "Datacenter" };
    return {
      field_labels: {
        type: vi ? "Loại proxy" : "Proxy type",
        network: vi ? "Nhà mạng" : "Network",
        days: vi ? "Thời hạn" : "Duration",
        quantity: vi ? "Số lượng" : "Quantity",
      },
      type_display: Object.fromEntries(b1.types.map((item) => [item.key, typeDefaults[item.key] ?? item.label])),
      network_display: Object.fromEntries(b1.networks.map((item) => [item.key, item.label])),
      duration_labels: Object.fromEntries(b1.durations.map((item) => [String(item.days), vi ? `${item.days} ngày` : `${item.days} days`])),
    };
  }
  if (workModel === "B2") {
    return {
      field_labels: { package_size: vi ? "Số lượt trong gói" : "Requests per package" },
      package_labels: Object.fromEntries(b2.packages.map((item) => [
        String(item.size),
        vi ? `Gói ${item.size.toLocaleString("vi-VN")} lượt` : `${item.size.toLocaleString("en-US")} requests`,
      ])),
    };
  }
  return {
    field_labels: {
      platform: vi ? "Nền tảng" : "Platform",
      target_urls: vi ? "Danh sách URL" : "URL list",
    },
    platform_display: Object.fromEntries(b3.platforms.map((item) => [item.key, item.label])),
  };
}

export function evaluateRouteAChecklist(params: {
  title: string;
  description: string;
  variants: WorkbenchVariant[];
  escrowDays: number;
  contentLanguageComplete?: boolean;
}): SellableEvaluation {
  const hasTitleAndDesc = !!(params.title.trim() && params.description.trim());
  const activeVariants = params.variants.filter((v) => v.is_active !== false);
  const hasActiveVariant = activeVariants.length > 0 && activeVariants.some((v) => v.price > 0);
  const hasStockOrSla = activeVariants.some((v) =>
    v.delivery_mode === "instant" ? v.stock_count > 0 : (v.sla_hours || 0) > 0,
  );
  const hasEscrow = params.escrowDays > 0;

  const checks: ChecklistItem[] = [
    { key: "info", labelKey: "checkInfo", pass: hasTitleAndDesc },
    ...(params.contentLanguageComplete === undefined ? [] : [
      { key: "translations", labelKey: "checkTranslations", pass: params.contentLanguageComplete },
    ]),
    { key: "variant", labelKey: "checkVariant", pass: hasActiveVariant },
    { key: "stock_sla", labelKey: "checkStockSla", pass: hasStockOrSla },
    { key: "escrow", labelKey: "checkEscrow", pass: hasEscrow },
  ];

  const passCount = checks.filter((c) => c.pass).length;
  return {
    checks,
    isSellable: passCount === checks.length,
    passCount,
    totalCount: checks.length,
  };
}

export function evaluateRouteBChecklist(params: {
  title: string;
  description: string;
  workModel: WorkModelB | null;
  priceValid: boolean;
  backend: BackendState;
  escrowDays: number;
  contentLanguageComplete?: boolean;
}): SellableEvaluation {
  const hasTitleAndDesc = !!(params.title.trim() && params.description.trim());
  const hasValidModel = !!params.workModel;
  const backendApproved = params.backend.status === "approved";
  const hasEscrow = params.escrowDays > 0;

  const checks: ChecklistItem[] = [
    { key: "info", labelKey: "checkInfo", pass: hasTitleAndDesc },
    ...(params.contentLanguageComplete === undefined ? [] : [
      { key: "translations", labelKey: "checkTranslations", pass: params.contentLanguageComplete },
    ]),
    { key: "pricing", labelKey: "checkPricing", pass: hasValidModel && params.priceValid },
    { key: "backend", labelKey: "checkBackend", pass: backendApproved },
    { key: "escrow", labelKey: "checkEscrow", pass: hasEscrow },
  ];

  const passCount = checks.filter((c) => c.pass).length;
  return {
    checks,
    isSellable: passCount === checks.length,
    passCount,
    totalCount: checks.length,
  };
}

export function calculateB1Price(b1: B1ConfigState): { total: number; valid: boolean } {
  const curType = b1.types.find((t) => t.key === b1.selectedType) || b1.types[0] || { mult: 1.0 };
  const curNet = b1.networks.find((n) => n.key === b1.selectedNetwork) || b1.networks[0] || { mult: 1.0 };
  const durationFactor = (b1.selectedDays || 30) / 30;
  const effectiveQty = b1.isSingleUnit ? 1 : Math.max(1, b1.qty || 1);
  const total = (b1.basePrice || 0) * curType.mult * curNet.mult * durationFactor * effectiveQty;
  return {
    total: Math.round(total),
    valid: total > 0,
  };
}

export function calculateB2Price(b2: B2CreditState): { rawTotal: number; finalTotal: number; valid: boolean; discountPct: number } {
  const curPkg = b2.packages.find((p) => p.size === b2.selectedPackageSize) || b2.packages[0] || { size: 1000, discountPct: 0 };
  const rawTotal = curPkg.size * (b2.creditPrice || 0);
  const discountVal = (rawTotal * (curPkg.discountPct || 0)) / 100;
  const finalTotal = rawTotal - discountVal;
  return {
    rawTotal: Math.round(rawTotal),
    finalTotal: Math.round(finalTotal),
    valid: finalTotal > 0,
    discountPct: curPkg.discountPct || 0,
  };
}

export function calculateB3Price(b3: B3TaskState): { total: number; valid: boolean; urlCount: number; perUrlPrice: number } {
  const urlsList = b3.urls.trim().split("\n").filter((u) => u.trim().length > 0);
  const urlCount = urlsList.length;
  const curPlat = b3.platforms.find((p) => p.key === b3.selectedPlatform) || b3.platforms[0] || { mult: 1.0 };
  const perUrlPrice = Math.round((b3.basePrice || 0) * curPlat.mult);
  const total = perUrlPrice * urlCount;
  return {
    total,
    valid: total > 0,
    urlCount,
    perUrlPrice,
  };
}
