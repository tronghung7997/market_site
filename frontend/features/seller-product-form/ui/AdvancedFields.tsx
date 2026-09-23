"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { ProductLocale, ProductTranslation } from "@/lib/types";
import { Button, Field, Select } from "@/components/ui";
import { ProductLanguageRail } from "@/components/products/ProductLanguageRail";
import { SellerPriceInput, useSellerPriceCurrency } from "@/features/seller-workbench/SellerPriceInput";
import type { ProductFormCore } from "../useProductFormCore";
import { SERVICE_TYPES, type ServiceType } from "../model";

/** Section 4 — translations, service type and (for provider-backed products)
 *  the integration + unit price. Optional for the common case. */
export function AdvancedFields({
  core, interfaceLocale, dynamic, translations, providerHint,
}: {
  core: ProductFormCore;
  interfaceLocale: ProductLocale;
  dynamic: boolean;
  translations: Partial<Record<ProductLocale, ProductTranslation>>;
  providerHint?: string | null;
}) {
  const t = useTranslations("sellerProductForm.advanced");
  const tf = useTranslations("seller.newProductFlow");
  const ts = useTranslations("seller");
  const router = useRouter();
  const { currency } = useSellerPriceCurrency();
  return (
    <div className="space-y-5">
      <div id="product-languages" className="scroll-mt-24 space-y-2">
        <div>
          <h3 className="text-[13px] font-semibold text-fg">{t("languagesTitle")}</h3>
          <p className="text-[12px] text-muted">{t("languagesHint")}</p>
        </div>
        <ProductLanguageRail
          interfaceLocale={interfaceLocale}
          activeLocale={core.contentLocale}
          translations={translations}
          requiredFields={{ specs: false, pricingLabels: dynamic }}
          primaryLocale={core.primaryLocale}
          onChange={core.setContentLocale}
          onPrimaryLocaleChange={core.setPrimaryLocale}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("serviceType")} hint={t("serviceTypeHint")}>
          <Select value={core.serviceType} onChange={(e) => core.setServiceType(e.target.value as ServiceType)}>
            {SERVICE_TYPES.map((type) => <option key={type} value={type}>{ts(`serviceType${type[0].toUpperCase()}${type.slice(1)}`)}</option>)}
          </Select>
        </Field>
      </div>
      {dynamic && (
        <div id="product-integration" className="scroll-mt-24 space-y-4 rounded-xl border border-line bg-surface p-4">
          <div>
            <h3 className="text-[13px] font-semibold text-fg">{tf("dynamicSetup")}</h3>
            {providerHint && <p className="mt-1 text-[12px] text-warn">{providerHint}</p>}
          </div>
          <Field
            label={tf("integrationLabel")}
            hint={core.providerManagedByAdmin
              ? tf("adminManagedIntegrationHint")
              : core.compatibleProviders.length > 0 ? tf("integrationHint") : tf("noCompatibleIntegrations")}
          >
            <Select value={core.selectedProviderId} onChange={(e) => core.setSelectedProviderId(Number(e.target.value))} disabled={core.providerManagedByAdmin || core.compatibleProviders.length === 0}>
              {core.providerManagedByAdmin && core.operationsProvider && <option value={core.operationsProvider.id}>{core.operationsProvider.name}</option>}
              {!core.providerManagedByAdmin && core.compatibleProviders.length === 0 && <option value={0}>{tf("integrationPlaceholder")}</option>}
              {core.compatibleProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </Select>
          </Field>
          {!core.providerManagedByAdmin && core.compatibleProviders.length === 0 && (
            <Button size="sm" variant="secondary" onClick={() => router.push("/seller/providers")}>{tf("createCompatibleIntegration")}</Button>
          )}
          {core.workModel === "B1" && core.isProxySourceProduct && <p className="text-[12.5px] text-muted">{tf("proxyPlansElsewhere")}</p>}
          {core.workModel === "B1" && !core.isProxySourceProduct && <Field label={tf("monthlyBasePrice", { currency })}><SellerPriceInput amountVnd={core.b1.basePrice} onAmountVndChange={(basePrice) => core.setB1({ ...core.b1, basePrice })} /></Field>}
          {core.workModel === "B2" && <Field label={tf("requestUnitPrice", { currency })}><SellerPriceInput amountVnd={core.b2.creditPrice} onAmountVndChange={(creditPrice) => core.setB2({ ...core.b2, creditPrice })} /></Field>}
          {core.workModel === "B3" && <Field label={tf("taskUnitPrice", { currency })}><SellerPriceInput amountVnd={core.b3.basePrice} onAmountVndChange={(basePrice) => core.setB3({ ...core.b3, basePrice })} /></Field>}
          <div className={`rounded-lg border p-3 text-[12px] ${core.selectedProvider ? "border-good/25 bg-good-soft" : "border-warn/25 bg-warn-soft"}`}>
            <strong className={core.selectedProvider ? "text-good" : "text-warn"}>{core.selectedProvider ? tf("integrationReadyTitle", { name: core.selectedProvider.name }) : tf("integrationRequiredTitle")}</strong>
            <p className="mt-1 text-muted">{core.selectedProvider ? tf("integrationReadyBody") : tf("integrationRequiredBody")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
