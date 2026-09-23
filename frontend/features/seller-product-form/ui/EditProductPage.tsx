"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useVariantTerm } from "@/lib/variant-term";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import type { ProductDetail, ProductLocale, ProductOperations, ProductTranslation, Variant } from "@/lib/types";
import { productPath } from "@/lib/routes";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { ExternalLink } from "@/components/Icons";
import { ProductCover } from "@/components/products/ProductCover";
import { parseCoverId } from "@/lib/product-covers";
import { browserTimeZone } from "@/features/seller-dashboard";
import { SellerReviewsPanel, useSellerReviews } from "@/features/reviews";
import {
  type WorkbenchVariant,
  buildDynamicPricingPlan,
  buyerContentToTranslation,
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  hasCompleteLocalizedContent,
  hydrateSellerProductDraft,
  parseFeatureLines,
  parseSpecLines,
} from "@/features/seller-workbench/logic";
import { SellerOrderPanelSimulation } from "@/features/seller-workbench/SellerOrderPanelSimulation";
import { SellerDynamicOrderSimulation } from "@/features/seller-workbench/SellerDynamicOrderSimulation";
import { useProductFormCore } from "../useProductFormCore";
import { buildPreviewProduct, categoryLabel, formSnapshot, SERVICE_TYPES, sortOrderPatches, type ChecklistJump, type FormSection, type ServiceType } from "../model";
import { SECTION_DOM_ID, scrollToJump } from "../jump";
import { BasicsFields } from "./BasicsFields";
import { ContentFields } from "./ContentFields";
import { AdvancedFields } from "./AdvancedFields";
import { ProxyPlansPanel } from "./ProxyPlansPanel";
import { editorFromPlans, rowIssue, summarize, type ProxyPlanEditor } from "../proxy-plans";
import { VariantsTable, type VariantDraft, type VariantStats } from "./VariantsTable";
import { ReadinessCard } from "./ReadinessCard";
import { CustomerGlance } from "./CustomerGlance";
import { CustomerPreviewDialog } from "./CustomerPreviewDialog";
import { FormHeader } from "./FormHeader";

type EditTab = FormSection | "reviews";
const TABS: EditTab[] = ["basics", "variants", "content", "advanced", "reviews"];

/** Plan ids + prices — what makes the proxy plan table "unsaved". */
function planSnapshot(editor: ProxyPlanEditor | null) {
  return editor ? editor.rows.map((row) => [row.id, row.price]) : null;
}
type SavedVariant = WorkbenchVariant & { id: number; public_key?: string | null };
type LocalizedVariantNames = Record<number, Record<ProductLocale, string>>;

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { active: "good", paused: "warn", suspended: "bad", draft: "neutral" };
const STATUS_KEY: Record<string, "activeStatus" | "pausedStatus" | "suspendedStatus" | "draftStatus"> = { active: "activeStatus", paused: "pausedStatus", suspended: "suspendedStatus", draft: "draftStatus" };

/** `productRef` is the route segment: the product's public key (what every
 *  seller link carries) or a legacy numeric id. The numeric id every write
 *  call needs comes from the loaded detail. */
export function EditProductPage({ productRef }: { productRef: string }) {
  const interfaceLocale = useLocale() as ProductLocale;
  const t = useTranslations("sellerProductForm");
  const tf = useTranslations("seller.newProductFlow");
  const ts = useTranslations("seller");
  const tw = useTranslations("seller.workbench");
  const apiErrorMessage = useApiErrorMessage();
  const { formatCheckoutMoney } = useMoney();
  const core = useProductFormCore(interfaceLocale, { loadProviders: true });
  const term = useVariantTerm(core.serviceType);

  const [tab, setTab] = useState<EditTab>("basics");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [variantPending, setVariantPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const productId = product?.id ?? 0;
  const [operations, setOperations] = useState<ProductOperations | null>(null);
  const [variants, setVariants] = useState<SavedVariant[]>([]);
  const [variantNames, setVariantNames] = useState<LocalizedVariantNames>({});
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Proxy-source products (TopProxy/DProxy): plan table with upstream costs.
  const [planLoad, setPlanLoad] = useState<"idle" | "loading" | "error" | "ready">("idle");

  const archetype = product?.pricing_strategy && product.pricing_strategy !== "fixed" ? "B" : "A";

  const snapshot = formSnapshot({
    content: core.content, primaryLocale: core.primaryLocale, categoryId: core.categoryId, serviceType: core.serviceType, coverId: core.coverId, escrowDays: core.escrowDays,
    workModel: core.workModel, b1: core.b1, b2: core.b2, b3: core.b3, providerId: core.selectedProviderId, variantNames,
    proxyPlans: planSnapshot(core.proxyPlans),
  });
  const dirty = savedSnapshot !== "" && snapshot !== savedSnapshot;

  /** Plans are part of the saved snapshot, so they load with the product. */
  const loadProxyPlans = async (detail: ProductDetail, operations: ProductOperations | null): Promise<ProxyPlanEditor | null> => {
    const adapter = operations?.provider?.adapter_type;
    if (detail.pricing_strategy !== "config" || (adapter !== "topproxy" && adapter !== "dproxy")) {
      core.setProxyPlans(null);
      setPlanLoad("idle");
      return null;
    }
    setPlanLoad("loading");
    try {
      const editor = editorFromPlans(await api.productProxyPlans(detail.id), operations?.pricing?.params ?? detail.pricing_params);
      core.setProxyPlans(editor);
      setPlanLoad("ready");
      return editor;
    } catch {
      core.setProxyPlans(null);
      setPlanLoad("error");
      return null;
    }
  };

  const loadData = useCallback(async (showSpinner = true) => {
    if (!productRef.trim()) return;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const detail = await api.sellerProduct(productRef);
      const productOperations = await api.productOperations(detail.id).catch(() => null);
      const hydrated = hydrateSellerProductDraft(detail);
      const names: LocalizedVariantNames = {};
      for (const variant of detail.variants) {
        const variantPrimary = variant.primary_locale ?? hydrated.primaryLocale;
        names[variant.id] = {
          vi: variant.translations?.vi?.name ?? (variantPrimary === "vi" ? variant.name : ""),
          en: variant.translations?.en?.name ?? (variantPrimary === "en" ? variant.name : ""),
        };
      }
      setProduct(detail);
      setOperations(productOperations);
      core.setPrimaryLocale(hydrated.primaryLocale);
      core.setContentLocale(hydrated.primaryLocale);
      core.setContent(hydrated.content);
      core.setCategoryId(detail.category_id);
      core.setServiceType((SERVICE_TYPES.includes(detail.service_type as ServiceType) ? detail.service_type : "other") as ServiceType);
      core.setCoverId(parseCoverId(detail) ?? (detail.service_type === "proxy" ? "proxy" : "account"));
      core.setEscrowDays(detail.escrow_days);
      core.setWorkModel(hydrated.workModel);
      core.setB1(hydrated.b1);
      core.setB2(hydrated.b2);
      core.setB3(hydrated.b3);
      core.setOperationsProvider(productOperations?.provider ?? null);
      const proxyEditor = await loadProxyPlans(detail, productOperations);
      if (productOperations?.provider?.id) core.setSelectedProviderId(productOperations.provider.id);
      setVariants(detail.variants.map((v) => ({
        id: v.id, public_key: v.public_key, name: v.name, price: v.price, delivery_mode: v.delivery_mode === "manual" ? "manual" : "instant", stock_count: v.stock_count ?? 0, sla_hours: v.sla_hours, is_active: v.is_active,
      })));
      setVariantNames(names);
      setSavedSnapshot(formSnapshot({
        content: hydrated.content, primaryLocale: hydrated.primaryLocale, categoryId: detail.category_id,
        serviceType: (SERVICE_TYPES.includes(detail.service_type as ServiceType) ? detail.service_type : "other"),
        coverId: parseCoverId(detail) ?? (detail.service_type === "proxy" ? "proxy" : "account"), escrowDays: detail.escrow_days,
        workModel: hydrated.workModel, b1: hydrated.b1, b2: hydrated.b2, b3: hydrated.b3, providerId: productOperations?.provider?.id ?? core.selectedProviderId, variantNames: names,
        proxyPlans: planSnapshot(proxyEditor),
      }));
    } catch (reason) {
      setError(apiErrorMessage(reason, tw("productLoadFailed")));
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [productRef]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadData(); }, [loadData]);

  // Only auto-pick when nothing is chosen. A provider assigned by an admin is
  // not in the seller's own list; swapping it here would dirty the form on
  // load and silently change the integration on the next save.
  useEffect(() => {
    if (!product || archetype === "A" || core.selectedProviderId !== 0) return;
    if (core.compatibleProviders[0]) core.setSelectedProviderId(core.compatibleProviders[0].id);
  }, [archetype, core.compatibleProviders, core.selectedProviderId, product]); // eslint-disable-line react-hooks/exhaustive-deps

  const reviewsQuery = useSellerReviews({ productId: productId || undefined, page: 1, enabled: productId > 0 });
  const statsQuery = useQuery({
    queryKey: queryKeys.sellerInventoryReport({ range: "30d", productIds: [productId], groupBy: "variant", includeInactive: true }),
    queryFn: () => api.inventoryReport({ range: "30d", tz: browserTimeZone(), productIds: [productId], groupBy: "variant", includeInactive: true, compare: false }),
    enabled: productId > 0 && archetype === "A" && variants.length > 0,
    staleTime: 60_000,
  });
  const variantStats = useMemo(() => {
    const out: Record<number, VariantStats> = {};
    for (const row of statsQuery.data?.rows ?? []) out[Number(row.key)] = { sold: row.sold, error: row.error };
    return out;
  }, [statsQuery.data]);

  const displayVariants: SavedVariant[] = variants.map((v) => ({
    ...v, name: variantNames[v.id]?.[core.contentLocale].trim() || variantNames[v.id]?.[core.primaryLocale].trim() || v.name,
  }));
  const primaryVariantComplete = archetype === "B" || variants.every((v) => Boolean(variantNames[v.id]?.[core.primaryLocale].trim()));
  const contentComplete = hasCompleteLocalizedContent(core.content, core.primaryLocale);
  const planSummary = core.proxyPlans ? summarize(core.proxyPlans.rows, core.proxyPlans.meta.min_margin_pct) : null;
  const evaluation = archetype === "A"
    ? evaluateRouteAChecklist({ title: core.primaryContent.title, description: core.primaryContent.description, variants, escrowDays: core.escrowDays, contentLanguageComplete: contentComplete && primaryVariantComplete })
    : evaluateRouteBChecklist({ title: core.primaryContent.title, description: core.primaryContent.description, workModel: core.workModel, priceValid: planSummary ? planSummary.count > 0 && planSummary.issues === 0 : (core.workModel === "B1" && core.b1.basePrice > 0) || (core.workModel === "B2" && core.b2.creditPrice > 0) || (core.workModel === "B3" && core.b3.basePrice > 0), backend: core.backend, escrowDays: core.escrowDays, contentLanguageComplete: contentComplete });

  const jump = (target: ChecklistJump) => {
    setTab(target.section);
    scrollToJump(target);
  };

  const withVariantPending = async (run: () => Promise<void>) => {
    setVariantPending(true);
    setError(null);
    try { await run(); }
    catch (reason) { setError(apiErrorMessage(reason, tf("saveFailed"))); }
    finally { setVariantPending(false); }
  };

  const addVariant = (draft: VariantDraft) => withVariantPending(async () => {
    const created = await api.createVariant(productId, { ...draft, content_locale: core.contentLocale, sort_order: variants.length });
    setVariants((current) => [...current, { id: created.id, public_key: created.public_key, name: created.name, price: created.price, delivery_mode: created.delivery_mode === "manual" ? "manual" : "instant", stock_count: created.stock_count ?? 0, sla_hours: created.sla_hours, is_active: created.is_active }]);
    setVariantNames((current) => ({ ...current, [created.id]: { vi: core.contentLocale === "vi" ? created.name : "", en: core.contentLocale === "en" ? created.name : "" } }));
  });

  const updateVariant = (id: number, draft: VariantDraft) => withVariantPending(async () => {
    const { name, ...common } = draft;
    await api.updateVariant(id, common);
    if (core.contentLocale === core.primaryLocale) await api.updateVariant(id, { name, content_locale: core.primaryLocale });
    else await api.updateVariantTranslation(id, core.contentLocale, name);
    setVariantNames((current) => ({ ...current, [id]: { ...(current[id] ?? { vi: "", en: "" }), [core.contentLocale]: name } }));
    setVariants((current) => current.map((v) => (v.id === id ? { ...v, ...common, ...(core.contentLocale === core.primaryLocale ? { name } : {}) } : v)));
  });

  const setVariantActive = (id: number, active: boolean) => withVariantPending(async () => {
    await api.updateVariant(id, { is_active: active });
    setVariants((current) => current.map((v) => (v.id === id ? { ...v, is_active: active } : v)));
  });

  const reorderVariants = (ids: number[]) => withVariantPending(async () => {
    const current = Object.fromEntries(variants.map((v, index) => [v.id, index]));
    const byId = new Map(variants.map((v) => [v.id, v]));
    setVariants(ids.map((id) => byId.get(id)!).filter(Boolean));
    for (const patch of sortOrderPatches(ids, current)) await api.updateVariant(patch.id, { sort_order: patch.sort_order });
  });

  // Variant name edits are persisted immediately, so they must not count as
  // "unsaved" — fold them into the saved snapshot as they land.
  useEffect(() => {
    setSavedSnapshot((saved) => {
      if (!saved) return saved;
      try { const parsed = JSON.parse(saved); return formSnapshot({ ...parsed, variantNames }); } catch { return saved; }
    });
  }, [variantNames]);

  const save = async (publishAfterSave = false) => {
    if (!product) return;
    if (!core.primaryContent.title.trim() || !core.categoryId) {
      setError(tf("requiredFields"));
      jump({ section: "basics", field: !core.primaryContent.title.trim() ? "product-title" : "product-category" });
      return;
    }
    if (planSummary && planSummary.issues > 0) {
      setError(t("proxyPlans.blockSave", { count: planSummary.issues }));
      setTab("variants");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const primary = buyerContentToTranslation(core.primaryContent);
      await api.updateProduct(productId, {
        title: primary.title, content_locale: core.primaryLocale, category_id: core.categoryId, service_type: core.serviceType, cover_id: core.coverId,
        description: primary.description || null, highlight_text: primary.highlight_text, features: primary.features, specs: primary.specs, warranty_text: primary.warranty_text, escrow_days: core.escrowDays,
      });
      await api.updateProductTranslation(productId, core.primaryLocale, core.translationPayload(core.primaryLocale, archetype === "B"));
      if (core.content[core.secondaryLocale].title.trim()) await api.updateProductTranslation(productId, core.secondaryLocale, core.translationPayload(core.secondaryLocale, archetype === "B"));
      if (archetype === "B") {
        const pricing = core.buildPricingPlan();
        // An admin-managed provider is reported by operations, not chosen here;
        // re-sending it would fail validation (or rebind) on a harmless save.
        const providerPatch = core.selectedProviderId && core.selectedProviderId !== core.operationsProvider?.id
          ? { provider_id: core.selectedProviderId }
          : {};
        await api.updateSellerPricing(productId, { pricing_strategy: pricing.strategy, pricing_params: pricing.params, ...providerPatch });
      }
      if (publishAfterSave && evaluation.isSellable) {
        if (archetype === "B") {
          const readiness = await api.productOperations(productId);
          if (readiness.needs_setup || readiness.demo_mode) { setOperations(readiness); setError(tf("providerNotReady")); return; }
        }
        await api.updateSellerProductStatus(productId, "active");
      }
      setLastSavedAt(new Date());
      setNotice(tw("changesSaved"));
      await loadData(false);
    } catch (reason) {
      setError(apiErrorMessage(reason, tf("saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const pause = async () => {
    setSaving(true);
    setError(null);
    try { await api.updateSellerProductStatus(productId, "paused"); await loadData(false); }
    catch (reason) { setError(apiErrorMessage(reason, tf("saveFailed"))); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex min-h-48 items-center justify-center"><Spinner /></div>;
  if (!product) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[13px] text-bad">{error ?? tw("productNotFound")}</p>
        <Link href="/seller/products" className="mt-3 inline-block text-[13px] text-iris-hi hover:underline">← {ts("backToProducts")}</Link>
      </Card>
    );
  }

  const catLabel = categoryLabel(core.catOptions, core.categoryId);
  const previewVariants: Variant[] = displayVariants.map((v, index) => ({
    id: v.id, product_id: productId, name: v.name, price: v.price, delivery_mode: v.delivery_mode, sla_hours: v.sla_hours ?? 24, sort_order: index, is_active: v.is_active !== false, stock_count: v.stock_count, duration_days: null,
  }));
  const activeVariants = previewVariants.filter((v) => v.is_active);
  const minPrice = planSummary ? planSummary.minPrice : activeVariants.filter((v) => v.price > 0).reduce<number | null>((min, v) => (min == null || v.price < min ? v.price : min), null);
  const previewProduct = buildPreviewProduct({
    id: productId, title: core.activeContent.title, categoryId: core.categoryId, categoryName: core.catOptions.find((o) => o.id === core.categoryId)?.name ?? product.category_name ?? "",
    serviceType: core.serviceType, coverId: core.coverId, escrowDays: core.escrowDays, highlightText: core.activeContent.highlightText, description: core.activeContent.description,
    features: parseFeatureLines(core.activeContent.featuresText), specs: parseSpecLines(core.activeContent.specsText), warrantyText: core.activeContent.warrantyText,
    variants: activeVariants, status: product.status, pricingStrategy: product.pricing_strategy, sellerName: product.seller_name, soldCount: product.sold_count, ratingAvg: product.rating_avg, ratingCount: product.rating_count, locale: core.contentLocale,
  });
  const translations: Partial<Record<ProductLocale, ProductTranslation>> = { vi: core.translationPayload("vi", archetype === "B"), en: core.translationPayload("en", archetype === "B") };
  const deliveryLabel = archetype === "B"
    ? t(`receive.short.${core.workModel === "B3" ? "task" : "api"}`)
    : t(`receive.short.${activeVariants.some((v) => v.delivery_mode === "instant") || activeVariants.length === 0 ? "instant" : "sla"}`);
  const readyCount = activeVariants.filter((v) => v.delivery_mode === "manual" || (v.stock_count ?? 0) > 0).length;
  const totals = statsQuery.data?.totals;
  const timeFmt = new Intl.DateTimeFormat(interfaceLocale === "vi" ? "vi-VN" : "en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const planPreview = core.proxyPlans ? {
    rows: core.proxyPlans.rows.map((row) => ({ ...row, valid: rowIssue(row, core.proxyPlans!.meta.min_margin_pct) == null })),
    fieldLabels: (core.proxyPlans.baseParams.field_labels as Record<string, string> | undefined) ?? {},
    typeLabels: (core.proxyPlans.baseParams.type_display as Record<string, string> | undefined) ?? {},
  } : null;
  const orderPanel = archetype === "A"
    ? <SellerOrderPanelSimulation title={core.activeContent.title} categoryName={catLabel} coverId={core.coverId} escrowDays={core.escrowDays} variants={displayVariants} serviceType={core.serviceType} />
    : <SellerDynamicOrderSimulation title={core.activeContent.title} categoryName={catLabel} coverId={core.coverId} escrowDays={core.escrowDays} workModel={core.workModel} b1={core.b1} b2={core.b2} b3={core.b3} backend={core.backend} onB1Change={core.setB1} onB2Change={core.setB2} onB3Change={core.setB3} planPreview={planPreview} />;

  const headerMeta = [
    catLabel || null,
    deliveryLabel,
    archetype === "A" ? t("edit.variantSummary", { count: variants.length, ready: readyCount, ...term }) : null,
    !dirty && lastSavedAt ? t("edit.lastSaved", { time: timeFmt.format(lastSavedAt) }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <FormHeader
        backHref="/seller/products"
        backLabel={ts("backToProducts")}
        title={(
          <span className="flex items-center gap-2.5">
            <ProductCover coverId={core.coverId} title={core.activeContent.title} className="h-8 w-8 rounded-lg" />
            <span className="truncate">{core.primaryContent.title.trim() || ts("editProductTitle")}</span>
          </span>
        )}
        tags={(
          <>
            <Tag tone={STATUS_TONE[product.status] ?? "neutral"}>{ts(STATUS_KEY[product.status] ?? "draftStatus")}</Tag>

            {dirty && <Tag tone="warn">{t("edit.unsaved")}</Tag>}
          </>
        )}
        meta={headerMeta}
        actions={(
          <>
            {product.status === "active" && (
              <Link href={productPath(product)} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-surface hover:text-fg">
                <ExternalLink size={13} /> {t("edit.viewLive")}
              </Link>
            )}
            {product.status === "active" && <Button variant="secondary" disabled={saving} onClick={pause}>{ts("pause")}</Button>}
            <Button variant={product.status === "active" ? "primary" : "secondary"} disabled={saving || !dirty} onClick={() => save(false)}>{saving ? tf("saving") : ts("saveChanges")}</Button>
            {product.status !== "active" && product.status !== "suspended" && (
              <Button disabled={saving || !evaluation.isSellable} onClick={() => save(true)}>{ts("activate")}</Button>
            )}
          </>
        )}
      />

      {error && <div role="alert" className="rounded-lg border border-bad/25 bg-bad-soft p-3 text-[13px] text-bad">{error}</div>}
      {notice && !dirty && <div role="status" className="rounded-lg border border-good/25 bg-good-soft p-3 text-[13px] text-good">{notice}</div>}

      <div role="tablist" aria-label={t("edit.tabsLabel")} className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors", tab === key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg")}>
            {t(`sections.${key}`, { ...term })}
            {key === "variants" && archetype === "A" && <span className="ml-1.5 rounded-full bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{variants.length}</span>}
            {key === "variants" && planSummary && (
              <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10.5px]", planSummary.issues > 0 ? "bg-bad-soft text-bad" : "bg-raised text-muted")}>
                {planSummary.issues > 0 ? planSummary.issues : planSummary.count}
              </span>
            )}
            {key === "reviews" && (reviewsQuery.data?.unreplied ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 font-mono text-[10.5px] text-warn">{reviewsQuery.data?.unreplied}</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {tab === "basics" && (
            <Card id={SECTION_DOM_ID.basics} className="p-5"><BasicsFields core={core} /></Card>
          )}
          {tab === "variants" && (
            <div id={SECTION_DOM_ID.variants} className="space-y-4">
              {archetype === "A" ? (
                <VariantsTable
                  variants={displayVariants}
                  stats={statsQuery.data ? variantStats : undefined}
                  lowStockThreshold={statsQuery.data?.low_stock_threshold ?? 20}
                  contentLocale={core.contentLocale}
                  primaryLocale={core.primaryLocale}
                  serviceType={core.serviceType}
                  pending={variantPending}
                  onAdd={addVariant}
                  onUpdate={updateVariant}
                  onSetActive={setVariantActive}
                  onReorder={reorderVariants}
                />
              ) : planLoad !== "idle" ? (
                <ProxyPlansPanel
                  productId={productId}
                  editor={core.proxyPlans}
                  onChange={core.setProxyPlans}
                  loadState={planLoad === "ready" ? "ready" : planLoad}
                  onRetry={() => { if (product) void loadProxyPlans(product, operations); }}
                  dirty={dirty}
                  saving={saving}
                  onSave={() => void save(false)}
                />
              ) : (
                <Card className="p-5">
                  <AdvancedFields core={core} interfaceLocale={interfaceLocale} dynamic translations={translations} providerHint={operations?.needs_setup_reason ?? null} />
                </Card>
              )}
            </div>
          )}
          {tab === "content" && (
            <Card id={SECTION_DOM_ID.content} className="p-5"><ContentFields core={core} /></Card>
          )}
          {tab === "advanced" && (
            <Card id={SECTION_DOM_ID.advanced} className="p-5">
              <AdvancedFields core={core} interfaceLocale={interfaceLocale} dynamic={archetype === "B"} translations={translations} providerHint={operations?.needs_setup_reason ?? null} />
            </Card>
          )}
          {tab === "reviews" && <SellerReviewsPanel productId={productId} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[150px]">
          <ReadinessCard evaluation={evaluation} titleMissing={!core.primaryContent.title.trim()} onJump={jump} title={t("readiness.editTitle")} />
          {archetype === "A" && (
            <Card className="p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">{t("edit.stats.title")}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[11px] text-faint">{t("edit.stats.sold")}</div><div className="font-mono text-[18px] font-semibold text-fg">{totals ? totals.sold.toLocaleString(interfaceLocale) : "—"}</div></div>
                <div><div className="text-[11px] text-faint">{t("edit.stats.revenue")}</div><div className="font-mono text-[18px] font-semibold text-fg">{totals ? formatCheckoutMoney(totals.revenue) : "—"}</div></div>
                <div><div className="text-[11px] text-faint">{t("edit.stats.errors")}</div><div className={cn("font-mono text-[18px] font-semibold", totals && totals.error > 0 ? "text-warn" : "text-fg")}>{totals ? totals.error.toLocaleString(interfaceLocale) : "—"}</div></div>
                <div><div className="text-[11px] text-faint">{t("edit.stats.rating")}</div><div className="font-mono text-[18px] font-semibold text-fg">{product.rating_avg != null ? product.rating_avg.toFixed(1) : "—"}{product.rating_count > 0 && <span className="ml-1 text-[11px] font-normal text-muted">({product.rating_count})</span>}</div></div>
              </div>
              {variants.length > 0 && (
                <Link href={`/seller/inventory/export?tab=report&variants=${variants.map((v) => v.public_key ?? v.id).join(",")}`} className="mt-3 inline-block text-[12px] text-iris hover:underline">{t("edit.stats.reportLink")}</Link>
              )}
            </Card>
          )}
          <CustomerGlance title={core.activeContent.title} categoryLabel={catLabel} coverId={core.coverId} deliveryLabel={deliveryLabel} escrowDays={core.escrowDays} highlightText={core.activeContent.highlightText} minPrice={minPrice} variantCount={planSummary ? planSummary.count : activeVariants.length} onPreview={() => setPreviewOpen(true)} serviceType={core.serviceType} />
        </aside>
      </div>

      <CustomerPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} product={previewProduct} orderPanel={orderPanel} unsaved={dirty} />
    </div>
  );
}
