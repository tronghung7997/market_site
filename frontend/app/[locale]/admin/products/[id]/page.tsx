"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { AdminProductDetail as AdminProductDetailData, Category, ProductLocale, ProductOperations, ProductPricingLabels, Provider } from "@/lib/types";
import { Button, Banner, Card, Field, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { Activity, ArrowRight, Check, Edit2, Eye, Info, Sliders, Users } from "@/components/Icons";
import { STRATEGY_INFO, STRATEGY_FORMULAS, ADAPTER_INFO, PARAM_LABELS, formatParamValue } from "@/lib/pricing-config";
import { PricingParamsEditor } from "@/components/PricingParamsEditor";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ListEditor } from "@/components/ListEditor";
import { ProductPreviewCard } from "@/components/seller/ProductPreviewCard";
import { formatSpecKey } from "@/lib/utils";
import { isAdapterCompatible, type CompatMatrix } from "@/lib/compat";
import { SERVICE_LABELS } from "@/lib/labels";
import { ProductLanguageRail, productLanguageName } from "@/components/products/ProductLanguageRail";
import { ProductPricingLabelsEditor } from "@/components/products/ProductPricingLabelsEditor";

const CONTENT_EMPTY = {
  title: "", category_id: 0, service_type: "other", status: "active", escrow_days: 2,
  highlight_text: "", description: "", warranty_text: "",
};

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (l: Category[]) => l.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}

const STATUS_TONES: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  active: "good",
  draft: "neutral",
  paused: "warn",
  suspended: "bad",
};
const STATUS_LABEL_KEYS: Record<string, string> = {
  active: "activeStatus",
  draft: "draftStatus",
  paused: "pausedStatus",
  suspended: "suspendedStatus",
};

export default function AdminProductDetail() {
  const t = useTranslations("seller");
  const { id, locale: interfaceLocaleParam } = useParams<{ id: string; locale: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const interfaceLocale: ProductLocale = interfaceLocaleParam === "en" ? "en" : "vi";
  const requestedContentLocale = searchParams.get("contentLocale");
  const initialContentLocale: ProductLocale = requestedContentLocale === "en" || requestedContentLocale === "vi"
    ? requestedContentLocale
    : interfaceLocale;
  const [contentLocale, setContentLocale] = useState<ProductLocale>(initialContentLocale);
  const [product, setProduct] = useState<AdminProductDetailData | null>(null);
  const [ops, setOps] = useState<ProductOperations | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [compatMatrix, setCompatMatrix] = useState<CompatMatrix | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editProviderId, setEditProviderId] = useState<number | null>(null);
  const [editStrategy, setEditStrategy] = useState<string>("fixed");
  const [editParams, setEditParams] = useState<Record<string, unknown>>({});
  const [editCommission, setEditCommission] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Content edit (title/status/description…) — admin override on any product
  const [editingContent, setEditingContent] = useState(false);
  const [content, setContent] = useState<typeof CONTENT_EMPTY>(CONTENT_EMPTY);
  const [features, setFeatures] = useState<string[]>([]);
  const [specs, setSpecs] = useState<{ key: string; value: string }[]>([]);
  const [pricingLabels, setPricingLabels] = useState<ProductPricingLabels>({});
  const [savingContent, setSavingContent] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [contentMsg, setContentMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const markContentDirty = () => { setContentDirty(true); setContentMsg(null); };

  const applyProductToContent = (
    p: AdminProductDetailData,
    locale: ProductLocale,
    includeCommon: boolean,
  ) => {
    const translation = p.translations?.[locale] ?? (locale === "vi" ? {
      title: p.title,
      description: p.description,
      highlight_text: p.highlight_text,
      features: p.features,
      warranty_text: p.warranty_text,
    } : {});
    setContent((current) => ({
      ...(includeCommon ? {
        category_id: p.category_id,
        service_type: p.service_type ?? "other",
        status: p.status,
        escrow_days: p.escrow_days,
      } : current),
      title: translation.title ?? "",
      highlight_text: translation.highlight_text ?? "",
      description: translation.description ?? "",
      warranty_text: translation.warranty_text ?? "",
    }));
    setFeatures(translation.features ?? []);
    const localizedSpecs = translation.specs ?? (locale === "vi" ? p.specs : null);
    setSpecs(localizedSpecs ? Object.entries(localizedSpecs).map(([key, value]) => ({ key, value: String(value) })) : []);
    setPricingLabels(translation.pricing_labels ?? {});
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [p, o, provList, matrix, c] = await Promise.all([
        // Endpoint admin — GET /products/{id} public không còn commission_rate.
        api.adminProduct(Number(id)),
        api.productOperations(Number(id)),
        api.providers(),
        api.adapterCompatibility(),
        api.categories(),
      ]);
      setProduct(p);
      setOps(o);
      setProviders(provList);
      setCompatMatrix(matrix);
      setCats(c);
      setEditProviderId(o.provider?.id ?? null);
      setEditStrategy(o.pricing.strategy || "fixed");
      setEditParams(structuredClone(o.pricing.params ?? {}));
      setEditCommission(p.commission_rate != null ? String(p.commission_rate) : "");
      applyProductToContent(p, contentLocale, true);
      setContentDirty(false);
    } catch {
      setError("Không tải được sản phẩm");
    } finally {
      setLoading(false);
    }
  };

  const changeContentLocale = (nextLocale: ProductLocale) => {
    if (nextLocale === contentLocale || !product) return;
    if (contentDirty && !window.confirm(t("switchLanguageWarning", { language: productLanguageName(contentLocale, interfaceLocale) }))) {
      return;
    }
    setContentLocale(nextLocale);
    applyProductToContent(product, nextLocale, true);
    setContentDirty(false);
    setContentMsg(null);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("contentLocale", nextLocale);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  const saveContent = async () => {
    setSavingContent(true); setContentMsg(null);
    try {
      const featureList = features.map((f) => f.trim()).filter(Boolean);
      const specsEntries = specs.filter((s) => s.key.trim());
      await Promise.all([
        api.adminUpdateProduct(Number(id), {
          category_id: content.category_id,
          service_type: content.service_type,
          status: content.status,
          escrow_days: content.escrow_days,
        }),
        api.adminUpdateProductTranslation(Number(id), contentLocale, {
          title: content.title.trim(),
          highlight_text: content.highlight_text.trim() || null,
          description: content.description.trim() || null,
          features: featureList.length > 0 ? featureList : null,
          warranty_text: content.warranty_text.trim() || null,
          specs: specsEntries.length > 0
            ? Object.fromEntries(specsEntries.map((s) => [s.key.trim(), s.value.trim()]))
            : null,
          pricing_labels: Object.keys(pricingLabels).length > 0 ? pricingLabels : null,
        }),
      ]);
      setContentMsg({ type: "ok", text: t("savedLanguage", { language: productLanguageName(contentLocale, interfaceLocale) }) });
      setContentDirty(false);
      setEditingContent(false);
      await loadAll();
    } catch (e) {
      setContentMsg({ type: "err", text: e instanceof Error ? e.message : "Lỗi khi lưu" });
    } finally {
      setSavingContent(false);
    }
  };

  useEffect(() => { loadAll(); }, [id]);
  useEffect(() => {
    if (!dirty && !contentDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty, contentDirty]);

  const markDirty = () => { setDirty(true); setSaveMsg(null); };

  const handleSave = async () => {
    setSaving(true); setSaveMsg(null);
    try {
      await api.updateProductOperations(Number(id), {
        provider_id: editProviderId,
        pricing_strategy: editStrategy,
        pricing_params: editStrategy === "fixed" ? null : editParams,
        commission_rate: editCommission.trim() === "" ? null : Number(editCommission),
      });
      setSaveMsg({ type: "ok", text: "Đã lưu cấu hình vận hành!" });
      setDirty(false);
      await loadAll();
    } catch (e) {
      setSaveMsg({ type: "err", text: e instanceof Error ? e.message : "Lỗi khi lưu" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (error || !product || !ops) return <Card className="p-6 text-bad text-sm">{error ?? "Không tìm thấy"}</Card>;

  const st = { label: t(STATUS_LABEL_KEYS[content.status] ?? "status"), tone: STATUS_TONES[content.status] ?? "neutral" as const };
  const strategy = ops.pricing.strategy || "fixed";
  const sInfo = STRATEGY_INFO[strategy] ?? STRATEGY_INFO.fixed;
  const adapterType = ops.provider?.adapter_type ?? "seller_pool";
  const aInfo = ADAPTER_INFO[adapterType] ?? { label: adapterType, description: "" };
  const providerName = ops.provider?.name ?? "Seller Pool";
  const health = ops.provider?.health ?? "healthy";
  const healthDot = health === "healthy" ? "bg-good" : health === "degraded" ? "bg-warn" : "bg-bad";
  const healthLabel = health === "healthy" ? "Khoẻ" : health === "degraded" ? "Chậm" : "Lỗi";

  // 2 bước đầu (khách nhập / tính giá) luôn chạy được — không phụ thuộc
  // provider. 2 bước sau (cấp phát/giao hàng thật) chỉ chạy được khi
  // needs_setup = false, nên phản ánh đúng trạng thái đó thay vì luôn hiện
  // "hoạt động" dù sản phẩm đang bị chặn bán.
  const fulfillmentReady = !ops.needs_setup;
  const pipelineMap: Record<string, { label: string; active: boolean }[]> = {
    fixed: [
      { label: "Khách chọn variant", active: true },
      { label: "Tính giá cố định", active: true },
      { label: `Lấy từ kho (${aInfo.label})`, active: fulfillmentReady },
      { label: "Giao data", active: fulfillmentReady },
    ],
    config: [
      { label: "Khách cấu hình", active: true },
      { label: "Tính giá dynamic", active: true },
      { label: `${aInfo.label} tạo mới`, active: fulfillmentReady },
      { label: "Giao tài nguyên", active: fulfillmentReady },
    ],
    credit: [
      { label: "Khách mua gói credit", active: true },
      { label: "Trừ credit", active: true },
      { label: `${aInfo.label} cấp API key`, active: fulfillmentReady },
      { label: "Dùng theo request", active: fulfillmentReady },
    ],
    task: [
      { label: "Khách đặt tác vụ", active: true },
      { label: "Tính giá theo nền tảng", active: true },
      { label: `${aInfo.label} nhận task`, active: fulfillmentReady },
      { label: "Team xử lý → giao kết quả", active: fulfillmentReady },
    ],
  };
  const pipelineSteps = pipelineMap[strategy] ?? pipelineMap.fixed;

  const displayParams = Object.entries(ops.pricing.params ?? {}).filter(
    ([k]) => k !== "strategy" && k !== "fields"
  );
  const flatCats = flatten(cats);
  const cleanFeatures = features.filter((feature) => feature.trim());
  const cleanSpecs = specs.filter((spec) => spec.key.trim()).map((spec) => [spec.key, spec.value] as const);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/products" className="text-[12px] text-muted hover:text-primary transition-colors">
            ← {t("backToProducts")}
          </Link>
          <h2 className="text-[18px] font-semibold mt-1">{content.title || t("productFallback", { id })}</h2>
        </div>
        <Link href={`/products/${id}`} locale={contentLocale}>
          <Button size="sm" variant="secondary"><Eye size={14} /> {t("viewLanguage", { language: productLanguageName(contentLocale, interfaceLocale) })}</Button>

        </Link>
      </div>

      <ProductLanguageRail
        interfaceLocale={interfaceLocale}
        activeLocale={contentLocale}
        translations={product.translations}
        requiredFields={{ specs: Boolean(product.specs), pricingLabels: Boolean(product.pricing_params) }}
        dirty={contentDirty}
        onChange={changeContentLocale}
      />

      {/* Section 1: Thong tin san pham (admin editable: content + status) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[14px] font-semibold flex items-center gap-2">
            <Info size={14} /> {t("productInformation")}
          </h3>
          {!editingContent ? (
            <Button size="sm" variant="secondary" onClick={() => { setEditingContent(true); setContentDirty(false); }}><Edit2 size={13} /> {t("edit")}</Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={savingContent} onClick={saveContent}>{savingContent ? t("saving") : t("saveLanguage", { language: productLanguageName(contentLocale, interfaceLocale) })}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingContent(false); loadAll(); }}>{t("cancel")}</Button>
            </div>
          )}
        </div>

        {!editingContent ? (
          <Card className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-[11px] text-faint font-medium">{t("status")}</div>
                <div className="mt-1"><Tag tone={st.tone}>{st.label}</Tag></div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">{t("serviceType")}</div>
                <div className="text-[13px] font-medium mt-1">{SERVICE_LABELS[product.service_type ?? "other"] ?? product.service_type}</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">{t("productCategory")}</div>
                <div className="text-[13px] font-medium mt-1">{product.category_name ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">{t("sellerLabel")}</div>
                <div className="text-[13px] font-medium mt-1">{product.seller_email ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">{t("escrowLabel")}</div>
                <div className="text-[13px] font-medium mt-1">{product.escrow_days} ngày</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">{t("variantsTab")}</div>
                <div className="text-[13px] font-medium mt-1">{product.variants.length} biến thể</div>
              </div>
            </div>
            {content.highlight_text && (
              <div>
                <div className="text-[11px] text-faint font-medium">Dòng nổi bật</div>
                <div className="text-[13px] text-muted mt-1">{content.highlight_text}</div>
              </div>
            )}
            {content.description && (
              <div>
                <div className="text-[11px] text-faint font-medium mb-1">Mô tả</div>
                <MarkdownContent>{content.description}</MarkdownContent>
              </div>
            )}
            {cleanFeatures.length > 0 && (
              <div>
                <div className="text-[11px] text-faint font-medium mb-1.5">Tính năng</div>
                <ul className="space-y-1">
                  {cleanFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[13px] text-muted">
                      <Check size={12} className="text-good mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cleanSpecs.length > 0 && (
              <div>
                <div className="text-[11px] text-faint font-medium mb-1.5">{t("specsLabel")}</div>
                <div className="rounded-lg border border-line overflow-hidden">
                  <div className="divide-y divide-line">
                    {cleanSpecs.map(([k, v]) => (
                      <div key={k} className="flex text-[12.5px]">
                        <span className="w-[140px] shrink-0 px-2.5 py-1.5 text-muted bg-raised/40">{formatSpecKey(k)}</span>
                        <span className="px-2.5 py-1.5 flex-1 break-words">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {content.warranty_text && (
              <div>
                <div className="text-[11px] text-faint font-medium mb-1">{t("warrantyLabel")}</div>
                <p className="text-[13px] text-muted whitespace-pre-wrap">{content.warranty_text}</p>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px] items-start">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold">{t("customerContent")} · {productLanguageName(contentLocale, interfaceLocale)}</div>
                  <div className="mt-0.5 text-[11px] text-faint">{t("customerContentHint", { language: contentLocale.toUpperCase() })}</div>
                </div>
                <Tag tone="iris" className="font-mono">{contentLocale.toUpperCase()}</Tag>
              </div>
              <Field label={t("productName")}><Input value={content.title} onChange={(e) => { setContent({ ...content, title: e.target.value }); markContentDirty(); }} /></Field>
              <Field label={t("highlightLabel")}><Input value={content.highlight_text} onChange={(e) => { setContent({ ...content, highlight_text: e.target.value }); markContentDirty(); }} /></Field>
              <Field label={t("descriptionLabel")}>
                <MarkdownEditor
                  value={content.description}
                  onChange={(value) => { setContent({ ...content, description: value }); markContentDirty(); }}
                  placeholder={contentLocale === "en" ? "Describe the product, delivery, and intended use." : "VD: **Tài khoản Facebook uy tín**, tạo hơn 2 tháng tuổi."}
                />
              </Field>
              <ListEditor
                label={t("featuresLabel")}
                items={features}
                addLabel={t("addFeature")}
                emptyText={t("noFeatures")}
                onAdd={() => { setFeatures([...features, ""]); markContentDirty(); }}
                onRemove={(index) => { setFeatures(features.filter((_, itemIndex) => itemIndex !== index)); markContentDirty(); }}
                renderRow={(feature, index) => (
                  <Input
                    aria-label={`Tính năng ${index + 1}`}
                    value={feature}
                    placeholder={contentLocale === "en" ? "Example: 24/7 technical support" : "VD: Bảo hành 24h nếu login lỗi"}
                    onChange={(event) => {
                      const next = [...features]; next[index] = event.target.value;
                      setFeatures(next); markContentDirty();
                    }}
                  />
                )}
              />
              <ListEditor
                label={`${t("specsLabel")} · ${contentLocale.toUpperCase()}`}
                hint={productLanguageName(contentLocale, interfaceLocale)}
                items={specs}
                addLabel={t("addSpec")}
                emptyText={t("noSpecs")}
                onAdd={() => { setSpecs([...specs, { key: "", value: "" }]); markContentDirty(); }}
                onRemove={(index) => { setSpecs(specs.filter((_, itemIndex) => itemIndex !== index)); markContentDirty(); }}
                renderRow={(s, i) => (
                  <div className="flex items-center gap-2">
                    <Input aria-label={`Tên thông số ${i + 1}`} value={s.key} placeholder={t("specNamePlaceholder")}
                      onChange={(e) => { const next = [...specs]; next[i] = { ...next[i], key: e.target.value }; setSpecs(next); markContentDirty(); }} />
                    <Input aria-label={`Giá trị thông số ${i + 1}`} value={s.value} placeholder={t("specValuePlaceholder")}
                      onChange={(e) => { const next = [...specs]; next[i] = { ...next[i], value: e.target.value }; setSpecs(next); markContentDirty(); }} />
                  </div>
                )}
              />
              <ProductPricingLabelsEditor
                locale={contentLocale}
                params={product.pricing_params}
                value={pricingLabels}
                onChange={setPricingLabels}
                onDirty={markContentDirty}
              />
              <Field label={t("warrantyLabel")}><Textarea rows={3} value={content.warranty_text} onChange={(e) => { setContent({ ...content, warranty_text: e.target.value }); markContentDirty(); }} /></Field>

              <div className="border-t border-line pt-4">
                <div className="text-[13px] font-semibold">{t("commonInfo")}</div>
                <div className="mt-0.5 text-[11px] text-faint">{t("appliesBothLanguages")}</div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("productCategory")}>
                  <Select value={content.category_id} onChange={(e) => { setContent({ ...content, category_id: Number(e.target.value) }); markContentDirty(); }}>
                    {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label={t("serviceType")}>
                  <Select value={content.service_type} onChange={(e) => { setContent({ ...content, service_type: e.target.value }); markContentDirty(); }}>
                    {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field label={t("escrowDaysLabel")}><Input type="number" min={1} value={content.escrow_days} onChange={(e) => { setContent({ ...content, escrow_days: Number(e.target.value) || 1 }); markContentDirty(); }} /></Field>
                <Field label={t("status")}>
                  <Select value={content.status} onChange={(e) => { setContent({ ...content, status: e.target.value }); markContentDirty(); }}>
                    <option value="active">{t("activeStatus")}</option>
                    <option value="draft">{t("draftStatus")}</option>
                    <option value="paused">{t("pausedStatus")}</option>
                    <option value="suspended">{t("suspendedStatus")}</option>
                  </Select>
                </Field>
              </div>
              <p className="text-[12px] text-muted">{t("adminEditHint")}</p>
            </Card>
            <div className="lg:sticky lg:top-6">
              <ProductPreviewCard
                title={content.title}
                categoryName={flatCats.find((c) => c.id === content.category_id)?.name}
                serviceType={content.service_type}
                status={content.status}
                escrowDays={content.escrow_days}
                highlightText={content.highlight_text}
                description={content.description}
                features={features}
                specs={specs}
                warrantyText={content.warranty_text}
                variants={product.variants}
              />
            </div>
          </div>
        )}
        {contentMsg && <p className={`text-[13px] ${contentMsg.type === "ok" ? "text-good" : "text-bad"}`}>{contentMsg.text}</p>}
      </div>

      {/* Section 2: Van hanh (editable) */}

      {ops.needs_setup && (
        <Banner tone="bad" icon={<Info size={15} />} title="Sản phẩm chưa bán được">
          {ops.needs_setup_reason}
        </Banner>
      )}

      {/* Pipeline */}
      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <ArrowRight size={14} /> Pipeline bàn giao
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {pipelineSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`px-3 py-2 rounded-lg text-[12px] font-medium border ${step.active ? "bg-iris/10 border-iris/30 text-iris" : "bg-raised border-line text-muted"}`}>
                {step.label}
              </div>
              {i < pipelineSteps.length - 1 && <ArrowRight size={12} className="text-faint" />}
            </div>
          ))}
        </div>
      </Card>

      {/* Chien luoc gia */}
      <Card className="p-5 space-y-4">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Sliders size={14} /> Chiến lược giá
        </h3>

        {/* Strategy cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(STRATEGY_INFO).map(([key, info]) => (
            <button key={key} onClick={() => { setEditStrategy(key); if (key === "fixed") setEditParams({}); markDirty(); }}
              className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${editStrategy === key ? "border-iris bg-iris/5 ring-1 ring-iris/30" : "border-line bg-raised hover:border-muted"}`}>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full border-2 ${editStrategy === key ? "border-iris bg-iris" : "border-muted"}`} />
                <span className="text-[13px] font-semibold">{info.label}</span>
              </div>
              <p className="text-[12px] text-muted mt-1 ml-5">{info.description}</p>
              <p className="text-[11px] font-mono text-faint mt-1 ml-5">{STRATEGY_FORMULAS[key]}</p>
            </button>
          ))}
        </div>

        {/* Params editor */}
        {editStrategy !== "fixed" && (
          <div className="space-y-4 pt-2">
            <div className="text-[12px] font-medium text-muted">Tham số chiến lược</div>
            <PricingParamsEditor strategy={editStrategy} params={editParams} onChange={(p) => { setEditParams(p); markDirty(); }} />
          </div>
        )}
        {editStrategy === "fixed" && (
          <div className="bg-raised rounded-lg px-4 py-3 text-[13px] text-muted">
            Giá cố định theo variant — không cần cấu hình thêm.
          </div>
        )}
      </Card>

      {/* Nha cung cap */}
      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Users size={14} /> Nhà cung cấp
        </h3>
        <div className="space-y-3">
          <Field label="Chọn nhà cung cấp" hint="Lựa chọn không tương thích với chiến lược giá đã chọn ở trên bị vô hiệu hoá.">
            <Select value={editProviderId ?? ""} onChange={(e) => { setEditProviderId(e.target.value ? Number(e.target.value) : null); markDirty(); }}>
              <option value="">— Không gán (Seller Pool) —</option>
              {providers.map((p) => {
                const compatible = isAdapterCompatible(p.adapter_type, editStrategy, compatMatrix);
                return (
                  <option key={p.id} value={p.id} disabled={!compatible}>
                    {ADAPTER_INFO[p.adapter_type]?.label ?? p.adapter_type} — {p.name}{!compatible ? " — không tương thích" : ""}
                  </option>
                );
              })}
            </Select>
          </Field>
          {(() => {
            const selected = providers.find((p) => p.id === editProviderId);
            if (!selected || isAdapterCompatible(selected.adapter_type, editStrategy, compatMatrix)) return null;
            return (
              <Banner tone="bad" icon={<Info size={15} />}>
                Adapter &quot;{selected.adapter_type}&quot; không tương thích với chiến lược &quot;{editStrategy}&quot; — lưu sẽ bị từ chối.
              </Banner>
            );
          })()}
          {ops.provider && (
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-muted">Hiện tại:</span>
              <span className="text-[13px] font-medium">{providerName}</span>
              <Tag tone="iris">{aInfo.label}</Tag>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${healthDot}`} />
                <span className="text-[12px] text-muted">{healthLabel}</span>
              </div>
            </div>
          )}
        </div>
        {adapterType === "mock" && (
          <div className="bg-warn/10 border border-warn/20 rounded-lg px-3 py-2 text-[12px] text-warn">
            Sản phẩm đang dùng dữ liệu demo. Khi kết nối API thật, dữ liệu sẽ tự chuyển sang nguồn thật.
          </div>
        )}
      </Card>

      {/* Hoa hong affiliate */}
      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Sliders size={14} /> Hoa hồng affiliate
        </h3>
        <Field label="Tỷ lệ hoa hồng (%)" hint="Để trống để kế thừa từ danh mục / mặc định hệ thống">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={editCommission}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) { setEditCommission(v); markDirty(); }
            }}
            placeholder="VD: 5"
          />
        </Field>
        <p className="text-[12px] text-muted">
          Hoa hồng chi cho affiliate khi đơn của sản phẩm này hoàn tất, trừ vào quỹ affiliate.
        </p>
      </Card>

      {/* Save button */}
      {dirty && (
        <Card className="p-4 flex items-center gap-3 border-iris/30 bg-iris/5">
          <Button size="lg" disabled={saving} onClick={handleSave}>
            {saving ? "Đang lưu..." : "Lưu cấu hình vận hành"}
          </Button>
          {saveMsg && <span className={`text-[13px] ${saveMsg.type === "ok" ? "text-good" : "text-bad"}`}>{saveMsg.text}</span>}
        </Card>
      )}
      {!dirty && saveMsg && (
        <Card className="p-4 border-good/30 bg-good/5">
          <span className="text-[13px] text-good">{saveMsg.text}</span>
        </Card>
      )}

      {/* Thong ke */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Tổng đơn" value={String(ops.stats.total_orders)} />
        <StatCard label="Doanh thu" value={vnd(ops.stats.revenue)} />
        <StatCard label="Tỷ lệ thành công" value={`${(ops.stats.success_rate * 100).toFixed(1)}%`} tone={ops.stats.success_rate >= 0.95 ? "good" : ops.stats.success_rate >= 0.8 ? "warn" : "bad"} />
        <StatCard label="Khiếu nại" value={String(ops.stats.disputes)} tone={ops.stats.disputes === 0 ? "good" : "warn"} />
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-primary";
  return (
    <Card className="p-4 text-center">
      <div className="text-[11px] text-muted font-medium">{label}</div>
      <div className={`text-[18px] font-bold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}
