"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Category, ProductLocale, ProductTranslation, Provider } from "@/lib/types";
import type { CoverId } from "@/lib/product-covers";
import {
  type B1ConfigState,
  type B2CreditState,
  type B3TaskState,
  type BackendState,
  type BuyerContentDraft,
  type WorkModelB,
  applyDproxySinglePlan,
  buildDynamicPricingLabels,
  buildDynamicPricingPlan,
  buyerContentToTranslation,
} from "@/features/seller-workbench/logic";
import { type DproxySalePackage, dproxyParamsFromPackages, packagesFromDproxyParams } from "@/lib/dproxy-plan";
import { categoryOptions, type ServiceType } from "./model";

/** What the operations endpoint knows about the product's provider. */
export type OperationsProvider = { id: number; name: string; adapter_type: string };
type SelectedProvider = Provider | OperationsProvider;

export const EMPTY_CONTENT: BuyerContentDraft = {
  title: "",
  description: "",
  highlightText: "",
  featuresText: "",
  specsText: "",
  warrantyText: "",
};

export const INITIAL_B1: B1ConfigState = {
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
export const INITIAL_B2: B2CreditState = {
  creditPrice: 0,
  packages: [
    { size: 500, label: "500 requests", discountPct: 0 },
    { size: 1000, label: "1,000 requests", discountPct: 10 },
    { size: 5000, label: "5,000 requests", discountPct: 20 },
  ],
  selectedPackageSize: 1000,
};
export const INITIAL_B3: B3TaskState = {
  basePrice: 0,
  platforms: [
    { key: "tiktok", label: "TikTok", mult: 1.2 },
    { key: "facebook", label: "Facebook", mult: 1 },
  ],
  selectedPlatform: "tiktok",
  urls: "",
};

/** Everything both the create and the edit page hold in common: buyer
 *  content per locale, classification, protection days and the dynamic
 *  (provider-backed) pricing state. Variants live with each page since one
 *  keeps local drafts and the other talks to the server row by row. */
export function useProductFormCore(interfaceLocale: ProductLocale, options: { loadProviders: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [contentLocale, setContentLocale] = useState<ProductLocale>(interfaceLocale);
  const [primaryLocale, setPrimaryLocale] = useState<ProductLocale>(interfaceLocale);
  const [content, setContent] = useState<Record<ProductLocale, BuyerContentDraft>>({ vi: { ...EMPTY_CONTENT }, en: { ...EMPTY_CONTENT } });
  const [categoryId, setCategoryId] = useState(0);
  const [serviceType, setServiceType] = useState<ServiceType>("account");
  const [coverId, setCoverId] = useState<CoverId>("account");
  const [escrowDays, setEscrowDays] = useState(3);
  const [workModel, setWorkModel] = useState<WorkModelB>("B2");
  const [b1, setB1] = useState<B1ConfigState>(INITIAL_B1);
  const [b2, setB2] = useState<B2CreditState>(INITIAL_B2);
  const [b3, setB3] = useState<B3TaskState>(INITIAL_B3);
  const [selectedProviderId, setSelectedProviderId] = useState(0);
  // Provider the operations endpoint reports for an existing product. Admin-
  // managed providers (e.g. the DProxy M2M partner) are absent from
  // sellerProviders, so this is the only way the form can name them.
  const [operationsProvider, setOperationsProvider] = useState<OperationsProvider | null>(null);
  // DProxy plans the admin mapped for this product (`plan_prices` in the
  // pricing params). One plan → the B1 single-package UI; several → the
  // seller prices each plan and the tuple set stays exactly as mapped.
  const [dproxyPackages, setDproxyPackages] = useState<DproxySalePackage[]>([]);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => setCategoriesError(true));
  }, []);

  useEffect(() => {
    if (!options.loadProviders) { setProviders([]); return; }
    api.sellerProviders()
      .then((items) => setProviders(items.filter((provider) => provider.is_active && provider.review_status === "approved")))
      .catch(() => setProviders([]));
  }, [options.loadProviders]);

  const catOptions = useMemo(() => categoryOptions(categories), [categories]);
  const activeContent = content[contentLocale];
  const primaryContent = content[primaryLocale];
  const secondaryLocale: ProductLocale = primaryLocale === "vi" ? "en" : "vi";

  const updateContent = useCallback(<K extends keyof BuyerContentDraft>(key: K, value: BuyerContentDraft[K]) => {
    setContent((current) => ({ ...current, [contentLocale]: { ...current[contentLocale], [key]: value } }));
  }, [contentLocale]);

  const requiredAdapterType = workModel === "B2" ? "seller_gateway" : workModel === "B3" ? "seller_task_webhook" : null;
  const compatibleProviders = useMemo(
    () => (workModel === "B1" ? providers : providers.filter((provider) => provider.adapter_type === requiredAdapterType)),
    [providers, requiredAdapterType, workModel],
  );
  const selectedProvider: SelectedProvider | undefined = compatibleProviders.find((provider) => provider.id === selectedProviderId)
    ?? (operationsProvider && operationsProvider.id === selectedProviderId ? operationsProvider : undefined);
  // Set by an admin, not pickable by the seller: lock the select and never
  // send provider_id back (a harmless Save must not rebind the product).
  const providerManagedByAdmin = Boolean(
    operationsProvider && operationsProvider.id === selectedProviderId
    && !compatibleProviders.some((provider) => provider.id === selectedProviderId),
  );
  const isDproxyProduct = selectedProvider?.adapter_type === "dproxy";
  const dproxyMultiPlan = isDproxyProduct && dproxyPackages.length > 1;

  // A single-plan DProxy product collapses the B1 grid to one
  // type/network/duration as soon as the provider is known. Multi-plan
  // products keep the admin's tuple set — collapsing would send a tuple the
  // upstream has no plan for and the save is (rightly) rejected.
  useEffect(() => {
    if (!isDproxyProduct || dproxyMultiPlan || b1.isSingleUnit) return;
    setB1(applyDproxySinglePlan(b1, {}));
  }, [isDproxyProduct, dproxyMultiPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Load the plan list from an existing product's pricing params. */
  const hydrateDproxyPackages = useCallback((params: Record<string, unknown> | null | undefined) => {
    setDproxyPackages(packagesFromDproxyParams(params));
  }, []);

  const updateDproxyPackagePrice = useCallback((index: number, price: number) => {
    setDproxyPackages((current) => current.map((item, i) => (i === index ? { ...item, price } : item)));
  }, []);

  /** The pricing payload for a provider-backed (route B) product. */
  const buildPricingPlan = useCallback(() => {
    if (dproxyMultiPlan) {
      return { strategy: "config" as const, params: dproxyParamsFromPackages(dproxyPackages) };
    }
    return buildDynamicPricingPlan(workModel, b1, b2, b3, selectedProvider?.adapter_type);
  }, [b1, b2, b3, dproxyMultiPlan, dproxyPackages, selectedProvider?.adapter_type, workModel]);

  const backend: BackendState = selectedProvider
    ? { status: "approved", name: selectedProvider.name, providerType: selectedProvider.adapter_type }
    : { status: "none", name: "" };

  const translationPayload = useCallback((locale: ProductLocale, dynamic: boolean): ProductTranslation => {
    const payload: ProductTranslation = content[locale].title.trim() ? buyerContentToTranslation(content[locale]) : {};
    if (dynamic) payload.pricing_labels = buildDynamicPricingLabels(workModel, locale, b1, b2, b3);
    return payload;
  }, [b1, b2, b3, content, workModel]);

  return {
    categories, categoriesError, catOptions, providers, compatibleProviders, selectedProvider, backend,
    contentLocale, setContentLocale, primaryLocale, setPrimaryLocale, secondaryLocale,
    content, setContent, activeContent, primaryContent, updateContent,
    categoryId, setCategoryId, serviceType, setServiceType, coverId, setCoverId, escrowDays, setEscrowDays,
    workModel, setWorkModel, b1, setB1, b2, setB2, b3, setB3, selectedProviderId, setSelectedProviderId,
    operationsProvider, setOperationsProvider, providerManagedByAdmin, isDproxyProduct,
    dproxyPackages, dproxyMultiPlan, hydrateDproxyPackages, updateDproxyPackagePrice, buildPricingPlan,
    translationPayload,
  };
}

export type ProductFormCore = ReturnType<typeof useProductFormCore>;
