"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import type {
  Category,
  ProductDetail,
  ProductLocale,
  ProductOperations,
  ProductTranslation,
  Provider,
  Variant,
} from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ProductPreviewCard } from "@/components/seller/ProductPreviewCard";
import { type CoverId, parseCoverId } from "@/lib/product-covers";
import {
  type B1ConfigState,
  type B2CreditState,
  type B3TaskState,
  type BackendState,
  type BuyerContentDraft,
  type WorkbenchVariant,
  buildDynamicPricingLabels,
  buildDynamicPricingPlan,
  buyerContentToTranslation,
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  hasCompleteLocalizedContent,
  hydrateSellerProductDraft,
  parseFeatureLines,
  parseSpecLines,
} from "./logic";
import { ProductLanguageRail } from "@/components/products/ProductLanguageRail";
import { SellerCoverPicker } from "./SellerCoverPicker";
import { SellerDynamicOrderSimulation } from "./SellerDynamicOrderSimulation";
import { SellerOrderPanelSimulation } from "./SellerOrderPanelSimulation";
import { SellerPriceInput, useSellerPriceCurrency } from "./SellerPriceInput";
import { SellerSellableChecklist } from "./SellerSellableChecklist";
import { SellerVariantManager } from "./SellerVariantManager";

const SERVICE_TYPES = ["account", "proxy", "token", "endpoint", "cloud", "payment", "takedown", "other"] as const;
const EMPTY_CONTENT: BuyerContentDraft = {
  title: "",
  description: "",
  highlightText: "",
  featuresText: "",
  specsText: "",
  warrantyText: "",
};

const INITIAL_B1: B1ConfigState = {
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
const INITIAL_B2: B2CreditState = {
  creditPrice: 0,
  packages: [
    { size: 500, label: "500 requests", discountPct: 0 },
    { size: 1000, label: "1,000 requests", discountPct: 10 },
    { size: 5000, label: "5,000 requests", discountPct: 20 },
  ],
  selectedPackageSize: 1000,
};
const INITIAL_B3: B3TaskState = {
  basePrice: 0,
  platforms: [
    { key: "tiktok", label: "TikTok", mult: 1.2 },
    { key: "facebook", label: "Facebook", mult: 1 },
  ],
  selectedPlatform: "tiktok",
  urls: "",
};

type LocalizedVariantNames = Record<number, Record<ProductLocale, string>>;

function flatten(categories: Category[]): Category[] {
  const result: Category[] = [];
  const walk = (items: Category[]) => items.forEach((category) => {
    result.push(category);
    walk(category.children ?? []);
  });
  walk(categories);
  return result;
}

function statusPresentation(status: string, locale: ProductLocale) {
  const vi = locale === "vi";
  if (status === "active") return { tone: "good" as const, label: vi ? "Đang mở bán" : "Active" };
  if (status === "paused") return { tone: "warn" as const, label: vi ? "Tạm dừng" : "Paused" };
  if (status === "suspended") return { tone: "bad" as const, label: vi ? "Bị đình chỉ" : "Suspended" };
  return { tone: "neutral" as const, label: vi ? "Bản nháp" : "Draft" };
}

export function SellerProductEditor({ productId }: { productId: number }) {
  const interfaceLocale = useLocale() as ProductLocale;
  const t = useTranslations("seller.newProductFlow");
  const ts = useTranslations("seller");
  const { currency: priceCurrency } = useSellerPriceCurrency();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [operations, setOperations] = useState<ProductOperations | null>(null);

  const [contentLocale, setContentLocale] = useState<ProductLocale>(interfaceLocale);
  const [primaryLocale, setPrimaryLocale] = useState<ProductLocale>(interfaceLocale);
  const [content, setContent] = useState<Record<ProductLocale, BuyerContentDraft>>({
    vi: { ...EMPTY_CONTENT },
    en: { ...EMPTY_CONTENT },
  });
  const [categoryId, setCategoryId] = useState(0);
  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>("account");
  const [coverId, setCoverId] = useState<CoverId>("account");
  const [escrowDays, setEscrowDays] = useState(30);
  const [variants, setVariants] = useState<WorkbenchVariant[]>([]);
  const [variantNames, setVariantNames] = useState<LocalizedVariantNames>({});
  const [workModel, setWorkModel] = useState<"B1" | "B2" | "B3">("B1");
  const [b1, setB1] = useState<B1ConfigState>(INITIAL_B1);
  const [b2, setB2] = useState<B2CreditState>(INITIAL_B2);
  const [b3, setB3] = useState<B3TaskState>(INITIAL_B3);
  const [selectedProviderId, setSelectedProviderId] = useState(0);

  const loadData = useCallback(async (showSpinner = true) => {
    if (!Number.isFinite(productId) || productId <= 0) return;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const [detail, categoryItems, providerItems, productOperations] = await Promise.all([
        api.sellerProduct(productId),
        api.categories(),
        api.sellerProviders().catch(() => [] as Provider[]),
        api.productOperations(productId).catch(() => null),
      ]);
      const hydrated = hydrateSellerProductDraft(detail);
      const approvedProviders = providerItems.filter((provider) => provider.is_active && provider.review_status === "approved");
      const nextProviderId = productOperations?.provider?.id && approvedProviders.some((provider) => provider.id === productOperations.provider?.id)
        ? productOperations.provider.id
        : approvedProviders[0]?.id ?? 0;
      const names: LocalizedVariantNames = {};
      for (const variant of detail.variants) {
        const variantPrimary = variant.primary_locale ?? hydrated.primaryLocale;
        names[variant.id] = {
          vi: variant.translations?.vi?.name ?? (variantPrimary === "vi" ? variant.name : ""),
          en: variant.translations?.en?.name ?? (variantPrimary === "en" ? variant.name : ""),
        };
      }

      setProduct(detail);
      setCategories(categoryItems);
      setProviders(approvedProviders);
      setOperations(productOperations);
      setPrimaryLocale(hydrated.primaryLocale);
      setContentLocale(hydrated.primaryLocale);
      setContent(hydrated.content);
      setCategoryId(detail.category_id);
      setServiceType((SERVICE_TYPES.includes(detail.service_type as (typeof SERVICE_TYPES)[number])
        ? detail.service_type
        : "other") as (typeof SERVICE_TYPES)[number]);
      setCoverId(parseCoverId(detail) ?? (detail.service_type === "proxy" ? "proxy" : "account"));
      setEscrowDays(detail.escrow_days);
      setVariants(detail.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        price: variant.price,
        delivery_mode: variant.delivery_mode === "manual" ? "manual" : "instant",
        stock_count: variant.stock_count,
        sla_hours: variant.sla_hours,
        is_active: variant.is_active,
      })));
      setVariantNames(names);
      setWorkModel(hydrated.workModel);
      setB1(hydrated.b1);
      setB2(hydrated.b2);
      setB3(hydrated.b3);
      setSelectedProviderId(nextProviderId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (interfaceLocale === "vi" ? "Không thể tải sản phẩm" : "Could not load product"));
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [interfaceLocale, productId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const flatCategories = useMemo(() => flatten(categories), [categories]);
  const selectedCategory = flatCategories.find((category) => category.id === categoryId);
  const activeContent = content[contentLocale];
  const primaryContent = content[primaryLocale];
  const secondaryLocale: ProductLocale = primaryLocale === "vi" ? "en" : "vi";
  const archetype = product?.pricing_strategy && product.pricing_strategy !== "fixed" ? "B" : "A";
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const backend: BackendState = selectedProvider
    ? { status: "approved", name: selectedProvider.name, providerType: selectedProvider.adapter_type }
    : { status: "none", name: "" };

  const displayVariants = variants.map((variant) => ({
    ...variant,
    name: variant.id == null
      ? variant.name
      : variantNames[variant.id]?.[contentLocale].trim()
        || variantNames[variant.id]?.[primaryLocale].trim()
        || variant.name,
  }));
  const primaryVariantComplete = archetype === "B" || variants.every((variant) => (
    variant.id == null || Boolean(variantNames[variant.id]?.[primaryLocale].trim())
  ));
  const contentComplete = hasCompleteLocalizedContent(content, primaryLocale);
  const routeAEvaluation = evaluateRouteAChecklist({
    title: primaryContent.title,
    description: primaryContent.description,
    variants,
    escrowDays,
    contentLanguageComplete: contentComplete && primaryVariantComplete,
  });
  const routeBEvaluation = evaluateRouteBChecklist({
    title: primaryContent.title,
    description: primaryContent.description,
    workModel,
    priceValid: (workModel === "B1" && b1.basePrice > 0)
      || (workModel === "B2" && b2.creditPrice > 0)
      || (workModel === "B3" && b3.basePrice > 0),
    backend,
    escrowDays,
    contentLanguageComplete: contentComplete,
  });
  const evaluation = archetype === "A" ? routeAEvaluation : routeBEvaluation;

  const updateContent = <K extends keyof BuyerContentDraft>(key: K, value: BuyerContentDraft[K]) => {
    setContent((current) => ({
      ...current,
      [contentLocale]: { ...current[contentLocale], [key]: value },
    }));
  };

  const translationPayload = (locale: ProductLocale): ProductTranslation => {
    const payload: ProductTranslation = content[locale].title.trim()
      ? buyerContentToTranslation(content[locale])
      : {};
    if (archetype === "B") {
      payload.pricing_labels = buildDynamicPricingLabels(workModel, locale, b1, b2, b3);
    }
    return payload;
  };
  const previewTranslations: Partial<Record<ProductLocale, ProductTranslation>> = {
    vi: translationPayload("vi"),
    en: translationPayload("en"),
  };

  const handleAddVariant = async (data: {
    name: string;
    price: number;
    delivery_mode: "instant" | "manual";
    sla_hours: number;
  }) => {
    try {
      const created = await api.createVariant(productId, { ...data, content_locale: contentLocale });
      setVariants((current) => [...current, {
        id: created.id,
        name: created.name,
        price: created.price,
        delivery_mode: created.delivery_mode === "manual" ? "manual" : "instant",
        stock_count: created.stock_count ?? 0,
        sla_hours: created.sla_hours,
        is_active: created.is_active,
      }]);
      setVariantNames((current) => ({
        ...current,
        [created.id]: { vi: contentLocale === "vi" ? created.name : "", en: contentLocale === "en" ? created.name : "" },
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
      throw reason;
    }
  };

  const handleUpdateVariant = async (variantId: number, data: Partial<WorkbenchVariant>) => {
    try {
      const { name, ...common } = data;
      if (Object.keys(common).length > 0) await api.updateVariant(variantId, common as Record<string, unknown>);
      if (name?.trim()) {
        if (contentLocale === primaryLocale) {
          await api.updateVariant(variantId, { name: name.trim(), content_locale: primaryLocale });
        } else {
          await api.updateVariantTranslation(variantId, contentLocale, name.trim());
        }
        setVariantNames((current) => ({
          ...current,
          [variantId]: { ...(current[variantId] ?? { vi: "", en: "" }), [contentLocale]: name.trim() },
        }));
      }
      setVariants((current) => current.map((variant) => variant.id === variantId ? { ...variant, ...common, ...(contentLocale === primaryLocale && name ? { name: name.trim() } : {}) } : variant));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
      throw reason;
    }
  };

  const handleDeleteVariant = async (variantId: number) => {
    try {
      await api.deleteVariant(variantId);
      setVariants((current) => current.filter((variant) => variant.id !== variantId));
      setVariantNames((current) => {
        const next = { ...current };
        delete next[variantId];
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
      throw reason;
    }
  };

  const handleRestockVariant = async (variantId: number, items: string[]) => {
    try {
      const result = await api.addResources(variantId, items);
      setVariants((current) => current.map((variant) => variant.id === variantId
        ? { ...variant, stock_count: variant.stock_count + result.count }
        : variant));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
      throw reason;
    }
  };

  const save = async (publishAfterSave = false) => {
    if (!product || !primaryContent.title.trim() || !categoryId) {
      setError(t("requiredFields"));
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const primary = buyerContentToTranslation(primaryContent);
      await api.updateProduct(productId, {
        title: primary.title,
        content_locale: primaryLocale,
        category_id: categoryId,
        service_type: serviceType,
        cover_id: coverId,
        description: primary.description || null,
        highlight_text: primary.highlight_text,
        features: primary.features,
        specs: primary.specs,
        warranty_text: primary.warranty_text,
        escrow_days: escrowDays,
      });
      await api.updateProductTranslation(productId, primaryLocale, translationPayload(primaryLocale));
      if (content[secondaryLocale].title.trim()) {
        await api.updateProductTranslation(productId, secondaryLocale, translationPayload(secondaryLocale));
      }

      if (archetype === "A") {
        for (const variant of variants) {
          if (variant.id == null) continue;
          const primaryName = variantNames[variant.id]?.[primaryLocale].trim() || variant.name.trim();
          if (!primaryName) continue;
          await api.updateVariant(variant.id, { name: primaryName, content_locale: primaryLocale });
          await api.updateVariantTranslation(variant.id, primaryLocale, primaryName);
          const secondaryName = variantNames[variant.id]?.[secondaryLocale].trim();
          if (secondaryName) await api.updateVariantTranslation(variant.id, secondaryLocale, secondaryName);
        }
      } else {
        const pricing = buildDynamicPricingPlan(workModel, b1, b2, b3);
        await api.updateSellerPricing(productId, {
          pricing_strategy: pricing.strategy,
          pricing_params: pricing.params,
          ...(selectedProviderId ? { provider_id: selectedProviderId } : {}),
        });
      }

      if (publishAfterSave && evaluation.isSellable) {
        if (archetype === "B") {
          const readiness = await api.productOperations(productId);
          if (readiness.needs_setup || readiness.demo_mode) {
            setOperations(readiness);
            setError(t("providerNotReady"));
            return;
          }
        }
        await api.updateSellerProductStatus(productId, "active");
      }
      setSuccess(interfaceLocale === "vi" ? "Đã lưu thay đổi." : "Changes saved.");
      await loadData(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (status: "active" | "paused") => {
    if (status === "active") {
      await save(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateSellerProductStatus(productId, status);
      await loadData(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner /></div>;
  }
  if (!product) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[13px] text-bad">{error ?? (interfaceLocale === "vi" ? "Không tìm thấy sản phẩm." : "Product not found.")}</p>
        <Link href="/seller/products" className="mt-3 inline-block text-[13px] text-iris-hi hover:underline">← {ts("backToProducts")}</Link>
      </Card>
    );
  }

  const status = statusPresentation(product.status, interfaceLocale);
  const previewSpecs = Object.entries(parseSpecLines(activeContent.specsText)).map(([key, value]) => ({ key, value }));
  const previewVariants: Variant[] = displayVariants.map((variant) => ({
    id: variant.id ?? 0,
    product_id: productId,
    name: variant.name,
    price: variant.price,
    delivery_mode: variant.delivery_mode,
    sla_hours: variant.sla_hours ?? 24,
    sort_order: 0,
    is_active: variant.is_active !== false,
    stock_count: variant.stock_count,
    duration_days: null,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <Link href="/seller/products" className="text-[12px] font-medium text-muted transition-colors hover:text-fg">← {ts("backToProducts")}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-bold text-fg">{ts("editProductTitle")}</h1>
            <Tag tone={status.tone}>{status.label}</Tag>
            <Tag tone="iris">{archetype === "A" ? t("inventoryTitle") : t("dynamicTitle")}</Tag>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product.status === "active" && (
            <Button variant="secondary" disabled={saving} onClick={() => toggleStatus("paused")}>{ts("pause")}</Button>
          )}
          <Button variant="secondary" disabled={saving || !primaryContent.title.trim() || !categoryId} onClick={() => save(false)}>
            {saving ? t("saving") : ts("saveChanges")}
          </Button>
          {product.status !== "active" && product.status !== "suspended" && (
            <Button disabled={saving || !evaluation.isSellable} onClick={() => toggleStatus("active")}>{ts("activate")}</Button>
          )}
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-bad/25 bg-bad-soft p-3 text-[13px] text-bad">{error}</div>}
      {success && <div role="status" className="rounded-lg border border-good/25 bg-good-soft p-3 text-[13px] text-good">{success}</div>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <ProductLanguageRail
            interfaceLocale={interfaceLocale}
            activeLocale={contentLocale}
            translations={previewTranslations}
            requiredFields={{ specs: false, pricingLabels: archetype === "B" }}
            primaryLocale={primaryLocale}
            onChange={setContentLocale}
            onPrimaryLocaleChange={setPrimaryLocale}
          />

          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-[14px] font-bold text-fg">{t("buyerContent")}</h2>
              <p className="mt-1 text-[12px] text-muted">{t("buyerContentHint")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("productName")}><Input value={activeContent.title} onChange={(event) => updateContent("title", event.target.value)} placeholder={t("productNamePlaceholder")} /></Field>
              <Field label={t("category")}>
                <Select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>
                  {flatCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("serviceType")}>
                <Select value={serviceType} onChange={(event) => setServiceType(event.target.value as (typeof SERVICE_TYPES)[number])}>
                  {SERVICE_TYPES.map((type) => <option key={type} value={type}>{ts(`serviceType${type[0].toUpperCase()}${type.slice(1)}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("escrowDays")}><Input type="number" min={1} max={365} value={escrowDays} onChange={(event) => setEscrowDays(Math.min(365, Math.max(1, Number(event.target.value) || 1)))} /></Field>
            </div>
            <SellerCoverPicker selectedCoverId={coverId} onChange={setCoverId} />
            <Field label={t("highlight")} hint={t("highlightHint")}><Input value={activeContent.highlightText} onChange={(event) => updateContent("highlightText", event.target.value)} placeholder={t("highlightPlaceholder")} /></Field>
            <Field label={t("description")}><MarkdownEditor value={activeContent.description} onChange={(value) => updateContent("description", value)} placeholder={t("descriptionPlaceholder")} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("features")} hint={t("featuresHint")}><Textarea rows={5} value={activeContent.featuresText} onChange={(event) => updateContent("featuresText", event.target.value)} placeholder={t("featuresPlaceholder")} /></Field>
              <Field label={t("specs")} hint={t("specsHint")}><Textarea rows={5} value={activeContent.specsText} onChange={(event) => updateContent("specsText", event.target.value)} placeholder={t("specsPlaceholder")} /></Field>
            </div>
            <Field label={t("warranty")}><Textarea rows={4} value={activeContent.warrantyText} onChange={(event) => updateContent("warrantyText", event.target.value)} placeholder={t("warrantyPlaceholder")} /></Field>
          </Card>

          {archetype === "A" ? (
            <SellerVariantManager
              variants={displayVariants}
              onAddVariant={handleAddVariant}
              onUpdateVariant={handleUpdateVariant}
              onDeleteVariant={handleDeleteVariant}
              onRestockVariant={handleRestockVariant}
            />
          ) : (
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-[14px] font-bold text-fg">{t("dynamicSetup")}</h2>
                {operations?.needs_setup_reason && <p className="mt-1 text-[12px] text-warn">{operations.needs_setup_reason}</p>}
              </div>
              <Field label={t("providerLabel")} hint={providers.length > 0 ? t("providerHint") : t("noApprovedProviders")}>
                <Select value={selectedProviderId} onChange={(event) => setSelectedProviderId(Number(event.target.value))} disabled={providers.length === 0}>
                  {providers.length === 0 && <option value={0}>{t("providerPlaceholder")}</option>}
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.adapter_type}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["B1", "B2", "B3"] as const).map((model) => (
                  <Button type="button" variant="ghost" key={model} aria-pressed={workModel === model} onClick={() => setWorkModel(model)} className={`!h-auto !whitespace-normal items-start rounded-lg border p-3 text-left sm:items-center sm:text-center ${workModel === model ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2"}`}>
                    <span><span className="block text-[13px] font-bold">{t(`${model.toLowerCase()}Title`)}</span><span className="mt-0.5 block text-[11px] text-muted">{t(`${model.toLowerCase()}Description`)}</span></span>
                  </Button>
                ))}
              </div>
              {workModel === "B1" && <Field label={t("monthlyBasePrice", { currency: priceCurrency })}><SellerPriceInput amountVnd={b1.basePrice} onAmountVndChange={(basePrice) => setB1({ ...b1, basePrice })} /></Field>}
              {workModel === "B2" && <Field label={t("requestUnitPrice", { currency: priceCurrency })}><SellerPriceInput amountVnd={b2.creditPrice} onAmountVndChange={(creditPrice) => setB2({ ...b2, creditPrice })} /></Field>}
              {workModel === "B3" && <Field label={t("taskUnitPrice", { currency: priceCurrency })}><SellerPriceInput amountVnd={b3.basePrice} onAmountVndChange={(basePrice) => setB3({ ...b3, basePrice })} /></Field>}
              <div className={`rounded-xl border p-3.5 text-[12px] ${selectedProvider ? "border-good/25 bg-good-soft" : "border-warn/25 bg-warn-soft"}`}>
                <strong className={selectedProvider ? "text-good" : "text-warn"}>{selectedProvider ? t("providerReadyTitle", { name: selectedProvider.name }) : t("backendRequiredTitle")}</strong>
                <p className="mt-1 text-muted">{selectedProvider ? t("providerReadyBody") : t("backendRequiredBody")}</p>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <ProductPreviewCard
            title={activeContent.title}
            categoryName={selectedCategory?.name}
            serviceType={serviceType}
            status={product.status}
            escrowDays={escrowDays}
            highlightText={activeContent.highlightText}
            description={activeContent.description}
            features={parseFeatureLines(activeContent.featuresText)}
            specs={previewSpecs}
            warrantyText={activeContent.warrantyText}
            variants={previewVariants}
            coverId={coverId}
          />
          {archetype === "A" ? (
            <SellerOrderPanelSimulation title={activeContent.title} categoryName={selectedCategory?.name} coverId={coverId} escrowDays={escrowDays} variants={displayVariants} />
          ) : (
            <SellerDynamicOrderSimulation title={activeContent.title} categoryName={selectedCategory?.name} coverId={coverId} escrowDays={escrowDays} workModel={workModel} b1={b1} b2={b2} b3={b3} backend={backend} onB1Change={setB1} onB2Change={setB2} onB3Change={setB3} />
          )}
          <SellerSellableChecklist checks={evaluation.checks} isSellable={evaluation.isSellable} passCount={evaluation.passCount} totalCount={evaluation.totalCount} />
        </aside>
      </div>
    </div>
  );
}
