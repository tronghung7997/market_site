"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Category, ProductLocale, ProductTranslation, Provider, Variant } from "@/lib/types";
import { Button, Card, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { Bolt, Package } from "@/components/Icons";
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
  type WorkbenchVariant,
  buildDynamicPricingLabels,
  buildDynamicPricingPlan,
  buyerContentToTranslation,
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  hasCompleteLocalizedContent,
  parseFeatureLines,
  parseResourceLines,
  parseSpecLines,
  ProductLanguageRail,
  SellerCoverPicker,
  SellerDynamicOrderSimulation,
  SellerOrderPanelSimulation,
  SellerPriceInput,
  SellerSellableChecklist,
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
  const { currency: priceCurrency } = useSellerPriceCurrency();

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProductId, setCreatedProductId] = useState<number | null>(null);
  const [createdVariantId, setCreatedVariantId] = useState<number | null>(null);

  const [archetype, setArchetype] = useState<Archetype>("A");
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

  const [variantNames, setVariantNames] = useState<Record<ProductLocale, string>>({ vi: "", en: "" });
  const [variantPrice, setVariantPrice] = useState(0);
  const [deliveryMode, setDeliveryMode] = useState<"instant" | "manual">("instant");
  const [slaHours, setSlaHours] = useState(24);
  const [initialStockText, setInitialStockText] = useState("");

  const [workModel, setWorkModel] = useState<WorkModelB>("B1");
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
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
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
    api.sellerProviders()
      .then((items) => {
        const approved = items.filter((provider) => provider.is_active && provider.review_status === "approved");
        setProviders(approved);
        if (approved[0]) setSelectedProviderId(approved[0].id);
      })
      .catch(() => setProviders([]));
  }, []);

  const flatCategories = useMemo(() => flatten(categories), [categories]);
  const selectedCategory = flatCategories.find((category) => category.id === categoryId);
  const activeContent = content[contentLocale];
  const stockLines = parseResourceLines(initialStockText);
  const primaryContentComplete = hasCompleteLocalizedContent(content, primaryLocale);
  const primaryVariantComplete = Boolean(variantNames[primaryLocale].trim());
  const primaryContent = content[primaryLocale];
  const secondaryLocale: ProductLocale = primaryLocale === "vi" ? "en" : "vi";

  const workbenchVariants: WorkbenchVariant[] = variantNames[primaryLocale].trim()
    ? [{
        name: variantNames[contentLocale].trim() || variantNames[primaryLocale].trim(),
        price: variantPrice,
        delivery_mode: deliveryMode,
        stock_count: deliveryMode === "instant" ? stockLines.length : 0,
        sla_hours: slaHours,
        is_active: true,
      }]
    : [];

  const previewVariants: Variant[] = workbenchVariants.map((variant) => ({
    id: 0,
    product_id: 0,
    name: variant.name,
    price: variant.price,
    delivery_mode: variant.delivery_mode,
    sla_hours: variant.sla_hours ?? 24,
    sort_order: 0,
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
    priceValid:
      (workModel === "B1" && b1.basePrice > 0)
      || (workModel === "B2" && b2.creditPrice > 0)
      || (workModel === "B3" && b3.basePrice > 0),
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

  const selectArchetype = (next: Archetype) => {
    setArchetype(next);
    if (next === "A" && serviceType === "proxy") {
      setServiceType("account");
      setCoverId("account");
    }
    if (next === "B" && serviceType === "account") {
      setServiceType("proxy");
      setCoverId("proxy");
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
        });
        let variantId = createdVariantId;
        const variantData = {
          name: variantNames[primaryLocale].trim(),
          content_locale: primaryLocale,
          price: variantPrice,
          delivery_mode: deliveryMode,
          sla_hours: slaHours,
        };
        if (variantNames[primaryLocale].trim()) {
          if (variantId == null) {
            const created = await api.createVariant(productId, variantData);
            variantId = created.id;
            setCreatedVariantId(variantId);
          } else {
            await api.updateVariant(variantId, variantData);
          }
          await api.updateVariantTranslation(variantId, primaryLocale, variantNames[primaryLocale].trim());
          if (variantNames[secondaryLocale].trim()) {
            await api.updateVariantTranslation(variantId, secondaryLocale, variantNames[secondaryLocale].trim());
          }
          if (deliveryMode === "instant" && stockLines.length > 0) {
            await api.addResources(variantId, stockLines);
          }
        }
      } else {
        const pricing = buildDynamicPricingPlan(workModel, b1, b2, b3);
        await api.updateSellerPricing(productId, {
          pricing_strategy: pricing.strategy,
          pricing_params: pricing.params,
          ...(selectedProviderId ? { provider_id: selectedProviderId } : {}),
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
              <Button
                type="button"
                variant="ghost"
                aria-pressed={archetype === "A"}
                onClick={() => selectArchetype("A")}
                className={`!h-auto !whitespace-normal items-start rounded-xl border p-4 text-left ${archetype === "A" ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2"}`}
              >
                <span>
                  <Package size={20} className="mb-2 text-iris-hi" />
                  <span className="block text-[14px] font-bold">{t("inventoryTitle")}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">{t("inventoryDescription")}</span>
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={archetype === "B"}
                onClick={() => selectArchetype("B")}
                className={`!h-auto !whitespace-normal items-start rounded-xl border p-4 text-left ${archetype === "B" ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2"}`}
              >
                <span>
                  <Bolt size={20} className="mb-2 text-iris-hi" />
                  <span className="block text-[14px] font-bold">{t("dynamicTitle")}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">{t("dynamicDescription")}</span>
                </span>
              </Button>
            </div>
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
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t("step3")}</div>
                  <h2 className="mt-1 text-[14px] font-bold text-fg">{t("fixedSetup")}</h2>
                </div>
                <Tag tone={deliveryMode === "instant" ? "good" : "warn"}>{deliveryMode === "instant" ? t("instantTag") : t("manualTag")}</Tag>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("variantName", { language: contentLocale.toUpperCase() })}>
                  <Input value={variantNames[contentLocale]} onChange={(event) => setVariantNames((current) => ({ ...current, [contentLocale]: event.target.value }))} placeholder={t("variantNamePlaceholder")} />
                </Field>
                <Field label={t("price", { currency: priceCurrency })}>
                  <SellerPriceInput amountVnd={variantPrice} onAmountVndChange={setVariantPrice} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("deliveryMode")}>
                  <Select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "instant" | "manual")}>
                    <option value="instant">{t("instantDelivery")}</option>
                    <option value="manual">{t("manualDelivery")}</option>
                  </Select>
                </Field>
                {deliveryMode === "manual" ? (
                  <Field label={t("slaHours")}>
                    <Input type="number" min={1} max={720} value={slaHours} onChange={(event) => setSlaHours(Math.min(720, Math.max(1, Number(event.target.value) || 24)))} />
                  </Field>
                ) : (
                  <Field label={t("initialStock")} hint={t("stockHint")}>
                    <Textarea rows={4} value={initialStockText} onChange={(event) => setInitialStockText(event.target.value)} placeholder={t("stockPlaceholder")} />
                  </Field>
                )}
              </div>
            </Card>
          ) : (
            <Card className="space-y-4 p-5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t("step3")}</div>
                <h2 className="mt-1 text-[14px] font-bold text-fg">{t("dynamicSetup")}</h2>
              </div>
              <Field label={t("providerLabel")} hint={providers.length > 0 ? t("providerHint") : t("noApprovedProviders")}>
                <Select value={selectedProviderId} onChange={(event) => setSelectedProviderId(Number(event.target.value))} disabled={providers.length === 0}>
                  {providers.length === 0 && <option value={0}>{t("providerPlaceholder")}</option>}
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.adapter_type}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["B1", "B2", "B3"] as WorkModelB[]).map((model) => (
                  <Button
                    type="button"
                    variant="ghost"
                    key={model}
                    aria-pressed={workModel === model}
                    onClick={() => setWorkModel(model)}
                    className={`!h-auto !whitespace-normal items-start rounded-lg border p-3 text-left sm:items-center sm:text-center ${workModel === model ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2"}`}
                  >
                    <span>
                      <span className="block text-[13px] font-bold">{t(`${model.toLowerCase()}Title`)}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">{t(`${model.toLowerCase()}Description`)}</span>
                    </span>
                  </Button>
                ))}
              </div>
              {workModel === "B1" && (
                <Field label={t("monthlyBasePrice", { currency: priceCurrency })}>
                  <SellerPriceInput amountVnd={b1.basePrice} onAmountVndChange={(basePrice) => setB1({ ...b1, basePrice })} />
                </Field>
              )}
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
              <div className={`rounded-xl border p-3.5 text-[12px] ${selectedProvider ? "border-good/25 bg-good-soft" : "border-warn/25 bg-warn-soft"}`}>
                <strong className={selectedProvider ? "text-good" : "text-warn"}>
                  {selectedProvider ? t("providerReadyTitle", { name: selectedProvider.name }) : t("backendRequiredTitle")}
                </strong>
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
