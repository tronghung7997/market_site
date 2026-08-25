import {
  effectiveMoneyInputCurrency,
  moneyInputToVnd,
  vndToMoneyInput,
} from "../../lib/money/format.ts";
import type {
  ProductDetail,
  ProductLocale,
  ProductPricingLabels,
  ProductTranslation,
} from "../../lib/types.ts";

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

export interface SellerProductDraftHydration {
  primaryLocale: ProductLocale;
  content: BilingualBuyerContent;
  workModel: WorkModelB;
  b1: B1ConfigState;
  b2: B2CreditState;
  b3: B3TaskState;
}

const EMPTY_BUYER_CONTENT: BuyerContentDraft = {
  title: "",
  description: "",
  highlightText: "",
  featuresText: "",
  specsText: "",
  warrantyText: "",
};

const DEFAULT_B1: B1ConfigState = {
  basePrice: 0,
  types: [
    { key: "residential", label: "Residential", mult: 1.4 },
    { key: "datacenter", label: "Datacenter", mult: 1 },
  ],
  networks: [
    { key: "fpt", label: "FPT Telecom", mult: 1 },
    { key: "viettel", label: "Viettel", mult: 1.1 },
  ],
  durations: [
    { days: 7, label: "7 days" },
    { days: 30, label: "30 days" },
  ],
  selectedType: "residential",
  selectedNetwork: "fpt",
  selectedDays: 30,
  qty: 1,
  isSingleUnit: false,
};

const DEFAULT_B2: B2CreditState = {
  creditPrice: 0,
  packages: [
    { size: 500, label: "500 requests", discountPct: 0 },
    { size: 1000, label: "1,000 requests", discountPct: 10 },
    { size: 5000, label: "5,000 requests", discountPct: 20 },
  ],
  selectedPackageSize: 1000,
};

const DEFAULT_B3: B3TaskState = {
  basePrice: 0,
  platforms: [
    { key: "tiktok", label: "TikTok", mult: 1.2 },
    { key: "facebook", label: "Facebook", mult: 1 },
  ],
  selectedPlatform: "tiktok",
  urls: "",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function localeLabels(
  translations: ProductDetail["translations"],
  locale: ProductLocale,
): ProductPricingLabels {
  return translations?.[locale]?.pricing_labels ?? {};
}

function translationToBuyerContent(
  translation: ProductTranslation | undefined,
  fallback?: Partial<ProductTranslation>,
): BuyerContentDraft {
  const value = { ...fallback, ...translation };
  return {
    title: value.title ?? "",
    description: value.description ?? "",
    highlightText: value.highlight_text ?? "",
    featuresText: (value.features ?? []).join("\n"),
    specsText: Object.entries(value.specs ?? {}).map(([key, item]) => `${key}: ${item}`).join("\n"),
    warrantyText: value.warranty_text ?? "",
  };
}

function numericEntries(value: unknown): [string, number][] {
  return Object.entries(record(value))
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]));
}

/** Hydrate the seller edit form from raw management data without applying
 * storefront locale fallback. This is the shared seam between create/edit
 * pricing contracts and the edit route. */
export function hydrateSellerProductDraft(product: ProductDetail): SellerProductDraftHydration {
  const available = product.available_locales ?? [];
  const primaryLocale = product.primary_locale
    ?? (available.length === 1 ? available[0] : undefined)
    ?? "vi";
  const scalarFallback: ProductTranslation = {
    title: product.title,
    description: product.description,
    highlight_text: product.highlight_text,
    features: product.features,
    specs: product.specs,
    warranty_text: product.warranty_text,
  };
  const content: BilingualBuyerContent = {
    vi: product.translations?.vi
      ? translationToBuyerContent(product.translations.vi)
      : primaryLocale === "vi" ? translationToBuyerContent(undefined, scalarFallback) : { ...EMPTY_BUYER_CONTENT },
    en: product.translations?.en
      ? translationToBuyerContent(product.translations.en)
      : primaryLocale === "en" ? translationToBuyerContent(undefined, scalarFallback) : { ...EMPTY_BUYER_CONTENT },
  };

  const params = record(product.pricing_params);
  const labels = localeLabels(product.translations, primaryLocale);
  const typeMultipliers = numericEntries(params.type_mult);
  const networkMultipliers = numericEntries(params.network_mult);
  const rawDurations = Array.isArray(params.duration_options) ? params.duration_options : [];
  const durations = rawDurations.flatMap((item) => {
    const option = record(item);
    const days = finiteNumber(option.days, -1);
    if (days <= 0) return [];
    return [{
      days,
      label: labels.duration_labels?.[String(days)] ?? (typeof option.label === "string" ? option.label : `${days} days`),
    }];
  });
  const b1: B1ConfigState = {
    ...DEFAULT_B1,
    basePrice: finiteNumber(params.base_price),
    types: typeMultipliers.length > 0
      ? typeMultipliers.map(([key, mult]) => ({ key, mult, label: labels.type_display?.[key] ?? key }))
      : DEFAULT_B1.types.map((item) => ({ ...item })),
    networks: networkMultipliers.length > 0
      ? networkMultipliers.map(([key, mult]) => ({ key, mult, label: labels.network_display?.[key] ?? key }))
      : DEFAULT_B1.networks.map((item) => ({ ...item })),
    durations: durations.length > 0 ? durations : DEFAULT_B1.durations.map((item) => ({ ...item })),
  };
  b1.selectedType = b1.types[0]?.key ?? "";
  b1.selectedNetwork = b1.networks[0]?.key ?? "";
  b1.selectedDays = b1.durations[0]?.days ?? 30;

  const discountBySize = new Map<number, number>();
  if (Array.isArray(params.volume_tiers)) {
    for (const item of params.volume_tiers) {
      const tier = record(item);
      const size = finiteNumber(tier.min_qty, -1);
      if (size > 0) discountBySize.set(size, finiteNumber(tier.discount) * 100);
    }
  }
  const rawPackages = Array.isArray(params.packages) ? params.packages : [];
  const packages = rawPackages.flatMap((item) => {
    const pkg = record(item);
    const size = finiteNumber(pkg.size, -1);
    if (size <= 0) return [];
    return [{
      size,
      label: labels.package_labels?.[String(size)] ?? (typeof pkg.label === "string" ? pkg.label : `${size} requests`),
      discountPct: discountBySize.get(size) ?? 0,
    }];
  });
  const b2: B2CreditState = {
    creditPrice: finiteNumber(params.credit_price),
    packages: packages.length > 0 ? packages : DEFAULT_B2.packages.map((item) => ({ ...item })),
    selectedPackageSize: packages[0]?.size ?? DEFAULT_B2.selectedPackageSize,
  };

  const platformMultipliers = numericEntries(params.platform_mult);
  const b3: B3TaskState = {
    ...DEFAULT_B3,
    basePrice: finiteNumber(params.base_price),
    platforms: platformMultipliers.length > 0
      ? platformMultipliers.map(([key, mult]) => ({ key, mult, label: labels.platform_display?.[key] ?? key }))
      : DEFAULT_B3.platforms.map((item) => ({ ...item })),
  };
  b3.selectedPlatform = b3.platforms[0]?.key ?? "";

  const workModel: WorkModelB = product.pricing_strategy === "credit"
    ? "B2"
    : product.pricing_strategy === "task" ? "B3" : "B1";
  return { primaryLocale, content, workModel, b1, b2, b3 };
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
