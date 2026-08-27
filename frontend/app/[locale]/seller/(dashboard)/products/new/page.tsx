"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canUseSellerProviders } from "@/lib/seller-tier";
import type { Category, ProductLocale, ProductTranslation, Provider, Variant } from "@/lib/types";
import { Banner, Button, Card, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { Bolt, Package } from "@/components/Icons";
import { parseResourceItems } from "@/features/seller-inventory";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ProductPreviewCard } from "@/components/seller/ProductPreviewCard";
import {
  type Archetype,
  type BackendState,
  type B1ConfigState,
  type B2CreditState,
  type B3TaskState,
  type BuyerContentDraft,
  type WorkModelB,
  buildDynamicPricingLabels,
  buildDynamicPricingPlan,
  buyerContentToTranslation,
  createNewProductPackageDraft,
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  hasCompleteLocalizedContent,
  namedNewProductPackages,
  parseFeatureLines,
  parseSpecLines,
  ProductLanguageRail,
  SellerCoverPicker,
  SellerDynamicOrderSimulation,
  SellerNewProductPackages,
  SellerOrderPanelSimulation,
  SellerPriceInput,
  SellerSellableChecklist,
  toWorkbenchVariantsFromDrafts,
  useSellerPriceCurrency,
} from "@/features/seller-workbench";
import type { CoverId } from "@/lib/product-covers";

const EMPTY_CONTENT: BuyerContentDraft = {
  title: "",
  description: "",
  highlightText: "",
  featuresText: "",
  specsText: "",
  warrantyText: "",
};

const SERVICE_TYPES = ["account", "proxy", "token", "endpoint", "cloud", "payment", "takedown", "other"] as const;
type ReceiveMode = "instant" | "sla" | "api" | "task";

function flatten(categories: Category[]): Category[] {
  const result: Category[] = [];
  const walk = (items: Category[]) => items.forEach((category) => {
    result.push(category);
    walk(category.children ?? []);
  });
  walk(categories);
  return result;
}

export default function NewProduct() {
  const router = useRouter();
  const interfaceLocale = useLocale() as ProductLocale;
  const t = useTranslations("seller.newProductFlow");
  const ts = useTranslations("seller");
  const { account } = useAuth();
  const { currency: priceCurrency } = useSellerPriceCurrency();
  const canUseProviders = canUseSellerProviders(account?.seller_tier);
  const requiredProviderTier = t("providerRequiredTier");

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProductId, setCreatedProductId] = useState<number | null>(null);

  const [receiveMode, setReceiveMode] = useState<ReceiveMode>("instant");
  const archetype: Archetype = receiveMode === "api" || receiveMode === "task" ? "B" : "A";
  const workModel: WorkModelB = receiveMode === "task" ? "B3" : "B2";
  const needsBackend = receiveMode === "api" || receiveMode === "task";
  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>("account");
  const [categoryId, setCategoryId] = useState(0);
  const [coverId, setCoverId] = useState<CoverId>("account");
  const [escrowDays, setEscrowDays] = useState(30);
  // The site's first-visit locale defaults to EN (i18n/routing.ts); an
  // explicit /vi route or the locale cookie starts the seller in VI instead.
  // This choice controls content only — admin display-settings currently
  // controls whether the locale switcher is visible, not a separate locale.
  const [contentLocale, setContentLocale] = useState<ProductLocale>(interfaceLocale);
  const [primaryLocale, setPrimaryLocale] = useState<ProductLocale>(interfaceLocale);
  const [content, setContent] = useState<Record<ProductLocale, BuyerContentDraft>>({
    vi: { ...EMPTY_CONTENT },
    en: { ...EMPTY_CONTENT },
  });

  const deliveryMode: "instant" | "manual" = receiveMode === "sla" ? "manual" : "instant";
  const [packages, setPackages] = useState(() => [createNewProductPackageDraft({ clientId: "pkg-initial" })]);

  const [b1, setB1] = useState<B1ConfigState>({
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
  });
  const [b2, setB2] = useState<B2CreditState>({
    creditPrice: 0,
    packages: [
      { size: 500, label: "500 requests", discountPct: 0 },
      { size: 1000, label: "1,000 requests", discountPct: 10 },
      { size: 5000, label: "5,000 requests", discountPct: 20 },
    ],
    selectedPackageSize: 1000,
  });
  const [b3, setB3] = useState<B3TaskState>({
    basePrice: 0,
    platforms: [
      { key: "tiktok", label: "TikTok", mult: 1.2 },
      { key: "facebook", label: "Facebook", mult: 1 },
    ],
    selectedPlatform: "tiktok",
    urls: "",
  });
  const requiredAdapterType = receiveMode === "api" ? "seller_gateway" : receiveMode === "task" ? "seller_task_webhook" : null;
  const compatibleProviders = useMemo(
    () => providers.filter((provider) => provider.adapter_type === requiredAdapterType),
    [providers, requiredAdapterType],
  );
  const selectedProvider = compatibleProviders.find((provider) => provider.id === selectedProviderId);
  const backend: BackendState = selectedProvider
    ? { status: "approved", name: selectedProvider.name, providerType: selectedProvider.adapter_type }
    : { status: "none", name: "" };

  useEffect(() => {
    api.categories()
      .then((items) => {
        setCategories(items);
        const first = flatten(items)[0];
        if (first) setCategoryId(first.id);
      })
      .catch(() => setCategoriesError(true));
  }, []);

  useEffect(() => {
    if (!canUseProviders) {
      setProviders([]);
      setSelectedProviderId(0);
      return;
    }
    api.sellerProviders()
      .then((items) => {
        const approved = items.filter((provider) => provider.is_active && provider.review_status === "approved");
        setProviders(approved);
      })
      .catch(() => setProviders([]));
  }, [canUseProviders]);

  useEffect(() => {
    if (!needsBackend) {
      setSelectedProviderId(0);
      return;
    }
    if (!compatibleProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(compatibleProviders[0]?.id ?? 0);
    }
  }, [needsBackend, compatibleProviders, selectedProviderId]);

  const flatCategories = useMemo(() => flatten(categories), [categories]);
  const selectedCategory = flatCategories.find((category) => category.id === categoryId);
  const activeContent = content[contentLocale];
  const pendingStockByClientId = useMemo(
    () => Object.fromEntries(
      packages.map((pkg) => [pkg.clientId, parseResourceItems(pkg.stockText, pkg.autoDedupe).length]),
    ),
    [packages],
  );
  const primaryContentComplete = hasCompleteLocalizedContent(content, primaryLocale);
  const namedPackages = namedNewProductPackages(packages, primaryLocale);
  const primaryVariantComplete = namedPackages.length > 0;
  const primaryContent = content[primaryLocale];
  const secondaryLocale: ProductLocale = primaryLocale === "vi" ? "en" : "vi";

  const workbenchVariants = toWorkbenchVariantsFromDrafts(packages, {
    contentLocale,
    primaryLocale,
    deliveryMode,
    pendingStockByClientId,
  });

  const previewVariants: Variant[] = workbenchVariants.map((variant, index) => ({
    id: variant.id ?? -(index + 1),
    product_id: 0,
    name: variant.name,
    price: variant.price,
    delivery_mode: variant.delivery_mode,
    sla_hours: variant.sla_hours ?? 24,
    sort_order: index,
    is_active: true,
    stock_count: variant.stock_count,
    duration_days: null,
  }));

  const routeAEvaluation = evaluateRouteAChecklist({
    title: primaryContent.title,
    description: primaryContent.description,
    variants: workbenchVariants,
    escrowDays,
    contentLanguageComplete: primaryContentComplete && primaryVariantComplete,
  });
  const routeBEvaluation = evaluateRouteBChecklist({
    title: primaryContent.title,
    description: primaryContent.description,
    workModel,
    priceValid: workModel === "B2" ? b2.creditPrice > 0 : b3.basePrice > 0,
    backend,
    escrowDays,
    contentLanguageComplete: primaryContentComplete,
  });
  const currentEvaluation = archetype === "A" ? routeAEvaluation : routeBEvaluation;

  const updateContent = <K extends keyof BuyerContentDraft>(key: K, value: BuyerContentDraft[K]) => {
    setContent((current) => ({
      ...current,
      [contentLocale]: { ...current[contentLocale], [key]: value },
    }));
  };

  const selectReceiveMode = (next: ReceiveMode) => {
    setReceiveMode(next);
    if (next === "api") {
      setServiceType("endpoint");
      setCoverId("endpoint");
    } else if (next === "task") {
      setServiceType("takedown");
      setCoverId("takedown");
    } else {
      setServiceType("account");
      setCoverId("account");
    }
  };

  const translationPayload = (locale: ProductLocale): ProductTranslation => {
    const translated = buyerContentToTranslation(content[locale]);
    const payload: ProductTranslation = content[locale].title.trim()
      ? translated
      : {};
    if (archetype === "B") {
      payload.pricing_labels = buildDynamicPricingLabels(workModel, locale, b1, b2, b3);
    }
    return payload;
  };

  const save = async (publishImmediately: boolean) => {
    if (!primaryContent.title.trim() || !categoryId) {
      setError(t("requiredFields"));
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const primary = buyerContentToTranslation(primaryContent);
      const productData = {
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
        status: "draft",
      };

      let productId = createdProductId;
      if (productId == null) {
        const created = await api.createProduct(productData);
        productId = created.id;
        setCreatedProductId(productId);
      } else {
        await api.updateProduct(productId, productData);
      }

      await api.updateProductTranslation(productId, primaryLocale, translationPayload(primaryLocale));
      if (content[secondaryLocale].title.trim()) {
        await api.updateProductTranslation(productId, secondaryLocale, translationPayload(secondaryLocale));
      }

      if (archetype === "A") {
        await api.updateSellerPricing(productId, {
          pricing_strategy: "fixed",
          pricing_params: null,
          provider_id: null,
        });
        const nextPackages = [...packages];
        for (let index = 0; index < nextPackages.length; index += 1) {
          const pkg = nextPackages[index];
          const primaryName = pkg.names[primaryLocale].trim();
          if (!primaryName) continue;
          const variantData = {
            name: primaryName,
            content_locale: primaryLocale,
            price: pkg.price,
            delivery_mode: deliveryMode,
            sla_hours: pkg.slaHours,
          };
          let variantId = pkg.serverId;
          if (variantId == null) {
            const created = await api.createVariant(productId, variantData);
            variantId = created.id;
          } else {
            await api.updateVariant(variantId, variantData);
          }
          await api.updateVariantTranslation(variantId, primaryLocale, primaryName);
          const secondaryName = pkg.names[secondaryLocale].trim();
          if (secondaryName) {
            await api.updateVariantTranslation(variantId, secondaryLocale, secondaryName);
          }
          const pendingItems = parseResourceItems(pkg.stockText, pkg.autoDedupe);
          let committedStock = pkg.committedStock;
          let stockText = pkg.stockText;
          let uploadedFileName = pkg.uploadedFileName;
          if (deliveryMode === "instant" && pendingItems.length > 0) {
            const result = await api.addResources(variantId, pendingItems);
            committedStock += result.count;
            stockText = "";
            uploadedFileName = null;
          }
          nextPackages[index] = {
            ...pkg,
            serverId: variantId,
            committedStock,
            stockText,
            uploadedFileName,
          };
        }
        setPackages(nextPackages);
      } else {
        const pricing = buildDynamicPricingPlan(workModel, b1, b2, b3);
        await api.updateSellerPricing(productId, {
          pricing_strategy: pricing.strategy,
          pricing_params: pricing.params,
          provider_id: selectedProviderId || null,
        });
      }

      if (publishImmediately && currentEvaluation.isSellable) {
        if (archetype === "B") {
          const operations = await api.productOperations(productId);
          if (operations.needs_setup || operations.demo_mode) {
            setError(t("providerNotReady"));
            return;
          }
        }
        await api.updateSellerProductStatus(productId, "active");
      }
      router.push(`/seller/products/${productId}`);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const previewSpecs = Object.entries(parseSpecLines(activeContent.specsText)).map(([key, value]) => ({ key, value }));
  const previewTranslations: Partial<Record<ProductLocale, ProductTranslation>> = {
    vi: translationPayload("vi"),
    en: translationPayload("en"),
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[18px] font-bold text-fg">{t("title")}</h1>
            <Tag tone={currentEvaluation.isSellable ? "good" : "neutral"}>
              {currentEvaluation.isSellable ? t("ready") : t("draft")}
            </Tag>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={saving || !primaryContent.title.trim() || !categoryId} onClick={() => save(false)}>
            {t("saveDraft")}
          </Button>
          <Button disabled={saving || !currentEvaluation.isSellable} onClick={() => save(true)}>
            {saving ? t("saving") : t("publish")}
          </Button>
        </div>
      </header>

      {(error || categoriesError) && (
        <div className="rounded-lg border border-bad/25 bg-bad-soft p-3 text-[13px] text-bad">
          {error || t("categoriesFailed")}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <Card className="space-y-4 p-5">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t("step1")}</div>
              <h2 className="mt-1 text-[14px] font-bold text-fg">{t("saleMethod")}</h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                ["instant", Package, t("instantDelivery"), t("inventoryDescription")],
                ["sla", Package, t("manualDelivery"), t("inventoryDescription")],
                ["api", Bolt, t("apiProductTitle"), t("apiProductDescription")],
                ["task", Bolt, t("taskProductTitle"), t("taskProductDescription")],
              ] as const).map(([mode, Icon, title, description]) => (
                <Button
                  key={mode}
                  type="button"
                  variant="ghost"
                  aria-pressed={receiveMode === mode}
                  onClick={() => selectReceiveMode(mode)}
                  className={`!h-auto !whitespace-normal items-start rounded-xl border p-4 text-left ${receiveMode === mode ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2"}`}
                >
                  <span>
                    <Icon size={20} className="mb-2 text-iris-hi" />
                    <span className="block text-[14px] font-bold">{title}</span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-muted">{description}</span>
                  </span>
                </Button>
              ))}
            </div>
            {needsBackend && !canUseProviders && (
              <Banner
                tone="warn"
                title={t("providerTierTitle", { tier: requiredProviderTier })}
                action={<Button size="sm" variant="secondary" onClick={() => router.push("/seller/providers")}>{t("providerTierAction")}</Button>}
              >
                {t("providerTierBody", { tier: requiredProviderTier })}
              </Banner>
            )}
          </Card>

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
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t("step2")}</div>
              <h2 className="mt-1 text-[14px] font-bold text-fg">{t("buyerContent")}</h2>
              <p className="mt-1 text-[12px] text-muted">{t("buyerContentHint")}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("productName")}>
                <Input value={activeContent.title} onChange={(event) => updateContent("title", event.target.value)} placeholder={t("productNamePlaceholder")} />
              </Field>
              <Field label={t("category")}>
                <Select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))} disabled={flatCategories.length === 0}>
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
              <Field label={t("escrowDays")}>
                <Input type="number" min={1} max={365} value={escrowDays} onChange={(event) => setEscrowDays(Math.min(365, Math.max(1, Number(event.target.value) || 1)))} />
              </Field>
            </div>

            <SellerCoverPicker selectedCoverId={coverId} onChange={setCoverId} />

            <Field label={t("highlight")} hint={t("highlightHint")}>
              <Input value={activeContent.highlightText} onChange={(event) => updateContent("highlightText", event.target.value)} placeholder={t("highlightPlaceholder")} />
            </Field>
            <Field label={t("description")}>
              <MarkdownEditor value={activeContent.description} onChange={(value) => updateContent("description", value)} placeholder={t("descriptionPlaceholder")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("features")} hint={t("featuresHint")}>
                <Textarea rows={5} value={activeContent.featuresText} onChange={(event) => updateContent("featuresText", event.target.value)} placeholder={t("featuresPlaceholder")} />
              </Field>
              <Field label={t("specs")} hint={t("specsHint")}>
                <Textarea rows={5} value={activeContent.specsText} onChange={(event) => updateContent("specsText", event.target.value)} placeholder={t("specsPlaceholder")} />
              </Field>
            </div>
            <Field label={t("warranty")}>
              <Textarea rows={4} value={activeContent.warrantyText} onChange={(event) => updateContent("warrantyText", event.target.value)} placeholder={t("warrantyPlaceholder")} />
            </Field>
          </Card>

          {archetype === "A" ? (
            <Card className="space-y-4 p-5">
              <SellerNewProductPackages
                packages={packages}
                contentLocale={contentLocale}
                deliveryMode={deliveryMode}
                priceCurrency={priceCurrency}
                onChange={setPackages}
                onDeleteSavedVariant={async (serverId) => {
                  try {
                    await api.deleteVariant(serverId);
                  } catch {
                    setError(t("saveFailed"));
                    throw new Error("delete-failed");
                  }
                }}
              />
            </Card>
          ) : needsBackend && canUseProviders && compatibleProviders.length > 0 ? (
            <Card className="space-y-4 p-5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t("step3")}</div>
                <h2 className="mt-1 text-[14px] font-bold text-fg">{t("dynamicSetup")}</h2>
              </div>
              <Field label={t("integrationLabel")} hint={t("integrationHint")}>
                <Select value={selectedProviderId} onChange={(event) => setSelectedProviderId(Number(event.target.value))}>
                  {compatibleProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </Select>
              </Field>
              {workModel === "B2" && (
                <Field label={t("requestUnitPrice", { currency: priceCurrency })}>
                  <SellerPriceInput amountVnd={b2.creditPrice} onAmountVndChange={(creditPrice) => setB2({ ...b2, creditPrice })} />
                </Field>
              )}
              {workModel === "B3" && (
                <Field label={t("taskUnitPrice", { currency: priceCurrency })}>
                  <SellerPriceInput amountVnd={b3.basePrice} onAmountVndChange={(basePrice) => setB3({ ...b3, basePrice })} />
                </Field>
              )}
            </Card>
          ) : needsBackend ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-[14px] font-bold text-fg">{t("connectServerFirst")}</h2>
              <Button size="sm" variant="secondary" onClick={() => router.push("/seller/providers")}>
                {canUseProviders ? t("createCompatibleIntegration") : t("providerTierAction")}
              </Button>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <ProductPreviewCard
            title={activeContent.title}
            categoryName={selectedCategory?.name}
            serviceType={serviceType}
            status="draft"
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
            <SellerOrderPanelSimulation
              title={activeContent.title}
              categoryName={selectedCategory?.name}
              coverId={coverId}
              escrowDays={escrowDays}
              variants={workbenchVariants}
            />
          ) : (
            <SellerDynamicOrderSimulation
              title={activeContent.title}
              categoryName={selectedCategory?.name}
              coverId={coverId}
              escrowDays={escrowDays}
              workModel={workModel}
              b1={b1}
              b2={b2}
              b3={b3}
              backend={backend}
              onB1Change={setB1}
              onB2Change={setB2}
              onB3Change={setB3}
            />
          )}
          <SellerSellableChecklist
            checks={currentEvaluation.checks}
            isSellable={currentEvaluation.isSellable}
            passCount={currentEvaluation.passCount}
            totalCount={currentEvaluation.totalCount}
          />
        </aside>
      </div>
    </div>
  );
}
