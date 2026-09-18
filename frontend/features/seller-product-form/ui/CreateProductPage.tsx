"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useVariantTerm } from "@/lib/variant-term";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { canUseSellerProviders } from "@/lib/seller-tier";
import type { ProductLocale, ProductTranslation, Variant } from "@/lib/types";
import { Button, Tag } from "@/components/ui";
import { parseResourceItems } from "@/features/seller-inventory";
import {
  buildDynamicPricingPlan,
  buyerContentToTranslation,
  createNewProductPackageDraft,
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  hasCompleteLocalizedContent,
  namedNewProductPackages,
  parseFeatureLines,
  parseSpecLines,
  toWorkbenchVariantsFromDrafts,
} from "@/features/seller-workbench/logic";
import { SellerOrderPanelSimulation } from "@/features/seller-workbench/SellerOrderPanelSimulation";
import { SellerDynamicOrderSimulation } from "@/features/seller-workbench/SellerDynamicOrderSimulation";
import { useProductFormCore } from "../useProductFormCore";
import { buildPreviewProduct, categoryLabel, missingCount, receiveModeFor, type ChecklistJump, type ReceiveMode } from "../model";
import { SECTION_DOM_ID, scrollToJump } from "../jump";
import { SectionCard } from "./SectionCard";
import { BasicsFields } from "./BasicsFields";
import { ContentFields } from "./ContentFields";
import { AdvancedFields } from "./AdvancedFields";
import { ReceiveModePicker } from "./ReceiveModePicker";
import { DraftPackages } from "./DraftPackages";
import { ReadinessCard } from "./ReadinessCard";
import { CustomerGlance } from "./CustomerGlance";
import { CustomerPreviewDialog } from "./CustomerPreviewDialog";
import { FormHeader } from "./FormHeader";

export function CreateProductPage() {
  const router = useRouter();
  const interfaceLocale = useLocale() as ProductLocale;
  const t = useTranslations("sellerProductForm");
  const tf = useTranslations("seller.newProductFlow");
  const ts = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const { account } = useAuth();
  const canUseProviders = canUseSellerProviders(account?.seller_tier);
  const core = useProductFormCore(interfaceLocale, { loadProviders: canUseProviders, defaultEscrowFromAdmin: true });
  const term = useVariantTerm(core.serviceType);

  const [receiveMode, setReceiveMode] = useState<ReceiveMode>("instant");
  const { archetype, deliveryMode, workModel } = receiveModeFor(receiveMode);
  const [packages, setPackages] = useState(() => [createNewProductPackageDraft({ clientId: "pkg-initial" })]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProductId, setCreatedProductId] = useState<number | null>(null);
  const [createdProductKey, setCreatedProductKey] = useState<string | null>(null);

  useEffect(() => { core.setWorkModel(workModel); }, [workModel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (archetype === "A") { core.setSelectedProviderId(0); return; }
    if (!core.compatibleProviders.some((p) => p.id === core.selectedProviderId)) core.setSelectedProviderId(core.compatibleProviders[0]?.id ?? 0);
  }, [archetype, core.compatibleProviders, core.selectedProviderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectReceiveMode = (next: ReceiveMode) => {
    setReceiveMode(next);
    if (next === "api") { core.setServiceType("endpoint"); core.setCoverId("endpoint"); }
    else if (next === "task") { core.setServiceType("takedown"); core.setCoverId("takedown"); }
    else if (core.serviceType === "endpoint" || core.serviceType === "takedown") { core.setServiceType("account"); core.setCoverId("account"); }
  };

  const pendingStockByClientId = useMemo(
    () => Object.fromEntries(packages.map((pkg) => [pkg.clientId, parseResourceItems(pkg.stockText, true).length])),
    [packages],
  );
  const workbenchVariants = toWorkbenchVariantsFromDrafts(packages, { contentLocale: core.contentLocale, primaryLocale: core.primaryLocale, deliveryMode, pendingStockByClientId });
  const primaryContentComplete = hasCompleteLocalizedContent(core.content, core.primaryLocale);
  const primaryVariantComplete = namedNewProductPackages(packages, core.primaryLocale).length > 0;

  const evaluation = archetype === "A"
    ? evaluateRouteAChecklist({ title: core.primaryContent.title, description: core.primaryContent.description, variants: workbenchVariants, escrowDays: core.escrowDays, contentLanguageComplete: primaryContentComplete && primaryVariantComplete })
    : evaluateRouteBChecklist({ title: core.primaryContent.title, description: core.primaryContent.description, workModel, priceValid: workModel === "B2" ? core.b2.creditPrice > 0 : core.b3.basePrice > 0, backend: core.backend, escrowDays: core.escrowDays, contentLanguageComplete: primaryContentComplete });
  const missing = missingCount(evaluation);
  const basicsDone = Boolean(core.primaryContent.title.trim()) && core.categoryId > 0;
  const variantsDone = evaluation.checks.filter((c) => ["variant", "stock_sla", "pricing", "backend"].includes(c.key)).every((c) => c.pass);
  const contentDone = Boolean(core.primaryContent.description.trim());

  const jump = (target: ChecklistJump) => {
    if (target.section === "advanced") setAdvancedOpen(true);
    scrollToJump(target);
  };

  const translations: Partial<Record<ProductLocale, ProductTranslation>> = { vi: core.translationPayload("vi", archetype === "B"), en: core.translationPayload("en", archetype === "B") };
  const previewVariants: Variant[] = workbenchVariants.map((v, index) => ({
    id: v.id ?? -(index + 1), product_id: 0, name: v.name, price: v.price, delivery_mode: v.delivery_mode, sla_hours: v.sla_hours ?? 24, sort_order: index, is_active: true, stock_count: v.stock_count, duration_days: null,
  }));
  const catLabel = categoryLabel(core.catOptions, core.categoryId);
  const previewProduct = buildPreviewProduct({
    id: createdProductId ?? 0, title: core.activeContent.title, categoryId: core.categoryId, categoryName: core.catOptions.find((o) => o.id === core.categoryId)?.name ?? "",
    serviceType: core.serviceType, coverId: core.coverId, escrowDays: core.escrowDays, highlightText: core.activeContent.highlightText, description: core.activeContent.description,
    features: parseFeatureLines(core.activeContent.featuresText), specs: parseSpecLines(core.activeContent.specsText), warrantyText: core.activeContent.warrantyText,
    variants: previewVariants, status: "draft", pricingStrategy: archetype === "B" ? buildDynamicPricingPlan(workModel, core.b1, core.b2, core.b3).strategy : "fixed",
    sellerName: account?.email?.split("@")[0] ?? null, locale: core.contentLocale,
  });
  const minPrice = previewVariants.filter((v) => v.price > 0).reduce<number | null>((min, v) => (min == null || v.price < min ? v.price : min), null);
  const deliveryLabel = t(`receive.short.${receiveMode}`);

  const retireSaved = async (serverId: number) => {
    try { await api.updateVariant(serverId, { is_active: false }); }
    catch (reason) { setError(apiErrorMessage(reason, tf("saveFailed"))); throw reason; }
  };

  const save = async (publishImmediately: boolean) => {
    if (!core.primaryContent.title.trim() || !core.categoryId) {
      setError(tf("requiredFields"));
      jump(!core.primaryContent.title.trim() ? { section: "basics", field: "product-title" } : { section: "basics", field: "product-category" });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const primary = buyerContentToTranslation(core.primaryContent);
      const productData = {
        title: primary.title, content_locale: core.primaryLocale, category_id: core.categoryId, service_type: core.serviceType, cover_id: core.coverId,
        description: primary.description || null, highlight_text: primary.highlight_text, features: primary.features, specs: primary.specs, warranty_text: primary.warranty_text,
        escrow_days: core.escrowDays, status: "draft",
      };
      let productId = createdProductId;
      if (productId == null) {
        const created = await api.createProduct(productData);
        productId = created.id;
        setCreatedProductId(productId);
        setCreatedProductKey(created.public_key ?? null);
      } else {
        await api.updateProduct(productId, productData);
      }
      await api.updateProductTranslation(productId, core.primaryLocale, core.translationPayload(core.primaryLocale, archetype === "B"));
      if (core.content[core.secondaryLocale].title.trim()) await api.updateProductTranslation(productId, core.secondaryLocale, core.translationPayload(core.secondaryLocale, archetype === "B"));

      if (archetype === "A") {
        await api.updateSellerPricing(productId, { pricing_strategy: "fixed", pricing_params: null, provider_id: null });
        const nextPackages = [...packages];
        for (let index = 0; index < nextPackages.length; index += 1) {
          const pkg = nextPackages[index];
          const primaryName = pkg.names[core.primaryLocale].trim();
          if (!primaryName) continue;
          const variantData = { name: primaryName, content_locale: core.primaryLocale, price: pkg.price, delivery_mode: deliveryMode, sla_hours: pkg.slaHours, sort_order: index };
          let variantId = pkg.serverId;
          if (variantId == null) variantId = (await api.createVariant(productId, variantData)).id;
          else await api.updateVariant(variantId, variantData);
          await api.updateVariantTranslation(variantId, core.primaryLocale, primaryName);
          const secondaryName = pkg.names[core.secondaryLocale].trim();
          if (secondaryName) await api.updateVariantTranslation(variantId, core.secondaryLocale, secondaryName);
          const pendingItems = parseResourceItems(pkg.stockText, true);
          let committedStock = pkg.committedStock;
          let stockText = pkg.stockText;
          let uploadedFileName = pkg.uploadedFileName;
          if (deliveryMode === "instant" && pendingItems.length > 0) {
            const result = await api.addResources(variantId, pendingItems);
            committedStock += result.count;
            stockText = "";
            uploadedFileName = null;
          }
          nextPackages[index] = { ...pkg, serverId: variantId, committedStock, stockText, uploadedFileName };
        }
        setPackages(nextPackages);
      } else {
        const pricing = core.buildPricingPlan();
        await api.updateSellerPricing(productId, { pricing_strategy: pricing.strategy, pricing_params: pricing.params, provider_id: core.selectedProviderId || null });
      }

      if (publishImmediately && evaluation.isSellable) {
        if (archetype === "B") {
          const operations = await api.productOperations(productId);
          if (operations.needs_setup || operations.demo_mode) { setError(tf("providerNotReady")); return; }
        }
        await api.updateSellerProductStatus(productId, "active");
      }
      router.push(`/seller/products/${createdProductKey ?? productId}`);
    } catch (reason) {
      setError(apiErrorMessage(reason, tf("saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const orderPanel = archetype === "A"
    ? <SellerOrderPanelSimulation title={core.activeContent.title} categoryName={catLabel} coverId={core.coverId} escrowDays={core.escrowDays} variants={workbenchVariants} serviceType={core.serviceType} />
    : <SellerDynamicOrderSimulation title={core.activeContent.title} categoryName={catLabel} coverId={core.coverId} escrowDays={core.escrowDays} workModel={workModel} b1={core.b1} b2={core.b2} b3={core.b3} backend={core.backend} onB1Change={core.setB1} onB2Change={core.setB2} onB3Change={core.setB3} />;

  return (
    <div className="space-y-5">
      <FormHeader
        backHref="/seller/products"
        backLabel={ts("backToProducts")}
        title={t("create.title")}
        tags={<Tag tone={evaluation.isSellable ? "good" : "neutral"}>{evaluation.isSellable ? tf("ready") : tf("draft")}</Tag>}
        meta={evaluation.isSellable ? t("create.readyMeta") : t("create.missingMeta", { count: missing })}
        actions={(
          <>
            <Button variant="secondary" disabled={saving} onClick={() => save(false)}>{tf("saveDraft")}</Button>
            <Button disabled={saving || !evaluation.isSellable} onClick={() => save(true)}>{saving ? tf("saving") : tf("publish")}</Button>
          </>
        )}
      />

      {(error || core.categoriesError) && <div role="alert" className="rounded-lg border border-bad/25 bg-bad-soft p-3 text-[13px] text-bad">{error || tf("categoriesFailed")}</div>}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <SectionCard id={SECTION_DOM_ID.basics} number={1} state={basicsDone ? "done" : "todo"} title={t("sections.basics")} subtitle={t("sections.basicsHint")}>
            <BasicsFields core={core} />
          </SectionCard>

          <SectionCard id={SECTION_DOM_ID.variants} number={2} state={variantsDone ? "done" : "todo"} title={t("sections.variants", { ...term })} subtitle={t("sections.variantsHint", { ...term })}>
            <div className="space-y-4">
              <ReceiveModePicker value={receiveMode} onChange={selectReceiveMode} lockedAdvanced={!canUseProviders} lockedReason={tf("providerTierBody", { tier: tf("providerRequiredTier") })} />
              {archetype === "A" ? (
                <DraftPackages packages={packages} onChange={setPackages} contentLocale={core.contentLocale} primaryLocale={core.primaryLocale} deliveryMode={deliveryMode} onRetireSaved={retireSaved} serviceType={core.serviceType} />
              ) : (
                <div className="rounded-xl border border-line bg-surface p-4 text-[12.5px] text-muted">
                  {t("variants.dynamicNote")}{" "}
                  <button type="button" onClick={() => jump({ section: "advanced", field: "product-integration" })} className="font-medium text-iris hover:underline">{t("variants.dynamicLink")}</button>
                </div>
              )}
              {archetype === "A" && deliveryMode === "instant" && <p className="text-[12px] text-muted">{t("variants.stockNote")}</p>}
            </div>
          </SectionCard>

          <SectionCard id={SECTION_DOM_ID.content} number={3} state={contentDone ? "done" : "todo"} title={t("sections.content")} subtitle={t("sections.contentHint")}>
            <ContentFields core={core} />
          </SectionCard>

          <SectionCard id={SECTION_DOM_ID.advanced} number={4} state="optional" title={t("sections.advanced")} subtitle={t("sections.advancedHint")} collapsible open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
            <AdvancedFields core={core} interfaceLocale={interfaceLocale} dynamic={archetype === "B"} translations={translations} />
          </SectionCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[150px]">
          <ReadinessCard evaluation={evaluation} titleMissing={!core.primaryContent.title.trim()} onJump={jump} title={t("readiness.createTitle")} />
          <CustomerGlance title={core.activeContent.title} categoryLabel={catLabel} coverId={core.coverId} deliveryLabel={deliveryLabel} escrowDays={core.escrowDays} highlightText={core.activeContent.highlightText} minPrice={minPrice} variantCount={previewVariants.length} onPreview={() => setPreviewOpen(true)} serviceType={core.serviceType} />
        </aside>
      </div>

      <CustomerPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} product={previewProduct} orderPanel={orderPanel} unsaved />
    </div>
  );
}
