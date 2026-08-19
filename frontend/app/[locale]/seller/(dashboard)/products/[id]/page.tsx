"use client";

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState, type ElementType } from "react";
import { api, vnd, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Category, ProductDetail, ProductLocale, ProductOperations, ProductPricingLabels, Provider, Resource, Variant } from "@/lib/types";
import { Banner, Button, Card, Field, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ListEditor } from "@/components/ListEditor";
import { ProductPreviewCard, STATUS_TAG } from "@/components/seller/ProductPreviewCard";
import { Activity, ArrowRight, Bolt, Check, ClipboardList, Clock, Edit2, Eye, FileText, Info, Package, Plus, Shield, Sliders, Trash, Users } from "@/components/Icons";
import { isAdapterCompatible } from "@/lib/compat";
import { STRATEGY_INFO, STRATEGY_FORMULAS, ADAPTER_INFO } from "@/lib/pricing-config";
import { PricingParamsEditor } from "@/components/PricingParamsEditor";
import { ProductLanguageRail, productLanguageName } from "@/components/products/ProductLanguageRail";
import { ProductPricingLabelsEditor } from "@/components/products/ProductPricingLabelsEditor";

const SERVICE_TYPES = [
  { value: "account", key: "serviceTypeAccount" },
  { value: "proxy", key: "serviceTypeProxy" },
  { value: "token", key: "serviceTypeToken" },
  { value: "endpoint", key: "serviceTypeEndpoint" },
  { value: "cloud", key: "serviceTypeCloud" },
  { value: "payment", key: "serviceTypePayment" },
  { value: "takedown", key: "serviceTypeTakedown" },
  { value: "other", key: "serviceTypeOther" },
];

/* Tiêu đề khối, giống hệt mẫu icon+heading đang dùng ở tab Vận hành cùng file
   và trang chi tiết admin — tách 1 danh sách field phẳng thành các khối có
   phân cấp thay vì lặp lại JSX 3 lần. */
function SectionHead({ icon: Icon, title, hint }: { icon: ElementType; title: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <h3 className="text-[14px] font-semibold flex items-center gap-2">
        <Icon size={14} /> {title}
      </h3>
      {hint && <p className="text-[12px] text-faint">{hint}</p>}
    </div>
  );
}

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (l: Category[]) => l.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}

const TABS = [
  { key: "info", labelKey: "editInfoTab", icon: Edit2 },
  { key: "variants", labelKey: "variantsTab", icon: Package },
  { key: "operations", labelKey: "operationsTab", icon: Activity },
] as const;

const STATUS_LABEL_KEYS: Record<string, string> = {
  active: "activeStatus",
  draft: "draftStatus",
  paused: "pausedStatus",
  suspended: "suspendedStatus",
};
const STRATEGY_LABEL_KEYS: Record<string, string> = {
  fixed: "strategyFixed",
  config: "strategyConfig",
  credit: "strategyCredit",
  task: "strategyTask",
};

type TabKey = (typeof TABS)[number]["key"];

/* Seller không cần biết field nào tên gì — trước đây mảng object (packages,
   volume_tiers) bị JSON.stringify thẳng ra màn hình. Tính sẵn giá thật từng
   gói/từng nền tảng, giống cách RapidAPI hiện "plan" cho provider thay vì
   tham số thô (nghiên cứu trước khi sửa — xem tóm tắt trong hội thoại). */
function applyVolumeDiscount(
  amount: number, qty: number, tiers?: { min_qty: number; discount: number }[],
): { amount: number; discountPct: number | null } {
  if (!tiers?.length) return { amount, discountPct: null };
  const applicable = tiers.filter((t) => qty >= t.min_qty);
  if (!applicable.length) return { amount, discountPct: null };
  const best = applicable.reduce((a, b) => (b.min_qty > a.min_qty ? b : a));
  return { amount: Math.round(amount * (1 - best.discount)), discountPct: best.discount };
}

function PlanSummary({ strategy, params }: { strategy: string; params: Record<string, unknown> }) {
  if (strategy === "credit") {
    const creditPrice = params.credit_price as number | undefined;
    const packages = (params.packages as { size: number; label?: string }[] | undefined) ?? [];
    const tiers = params.volume_tiers as { min_qty: number; discount: number }[] | undefined;
    if (creditPrice == null || packages.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="text-[12px] font-medium text-muted">Gói bán ra ({vnd(creditPrice)}/request)</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {packages.map((p) => {
            const base = creditPrice * p.size;
            const { amount, discountPct } = applyVolumeDiscount(base, p.size, tiers);
            return (
              <div key={p.size} className="bg-raised rounded-lg px-3 py-2.5">
                <div className="text-[12.5px] font-medium">{p.label ?? `${p.size.toLocaleString("vi-VN")} requests`}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="font-mono text-[15px] font-semibold">{vnd(amount)}</span>
                  {discountPct != null && <Tag tone="good">-{Math.round(discountPct * 100)}%</Tag>}
                </div>
                <div className="text-[11px] text-faint mt-0.5">{vnd(Math.round(amount / p.size))}/request</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (strategy === "task") {
    const basePrice = params.base_price as number | undefined;
    const platformMult = params.platform_mult as Record<string, number> | undefined;
    const tiers = params.volume_tiers as { min_qty: number; discount: number }[] | undefined;
    if (basePrice == null || !platformMult) return null;
    return (
      <div className="space-y-2">
        <div className="text-[12px] font-medium text-muted">Giá theo nền tảng (mỗi URL)</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(platformMult).map(([platform, mult]) => (
            <div key={platform} className="bg-raised rounded-lg px-3 py-2.5">
              <div className="text-[12.5px] font-medium capitalize">{platform}</div>
              <span className="font-mono text-[15px] font-semibold">{vnd(Math.round(basePrice * mult))}</span>
            </div>
          ))}
        </div>
        {!!tiers?.length && (
          <div className="text-[12px] text-muted">
            Giảm giá khi 1 đơn có nhiều URL: {tiers.map((t) => `từ ${t.min_qty} URL -${Math.round(t.discount * 100)}%`).join(", ")}
          </div>
        )}
      </div>
    );
  }

  if (strategy === "config") {
    const basePrice = params.base_price as number | undefined;
    const typeMult = params.type_mult as Record<string, number> | undefined;
    const networkMult = params.network_mult as Record<string, number> | undefined;
    const durationOptions = params.duration_options as { days: number; label?: string }[] | undefined;
    if (basePrice == null) return null;
    const firstType = typeMult ? Object.keys(typeMult)[0] : null;
    const firstNetwork = networkMult ? Object.keys(networkMult)[0] : null;
    const refDays = durationOptions?.[0]?.days ?? 30;
    const exampleAmount = Math.round(
      basePrice
      * (firstType && typeMult ? typeMult[firstType] : 1)
      * (firstNetwork && networkMult ? networkMult[firstNetwork] : 1)
      * (refDays / 30),
    );
    return (
      <div className="space-y-2">
        <div className="text-[12px] font-medium text-muted">Ví dụ giá thật</div>
        <div className="bg-raised rounded-lg px-3 py-2.5 text-[13px]">
          {firstType && <>Loại <strong>{firstType}</strong></>}
          {firstNetwork && <>, mạng <strong>{firstNetwork}</strong></>}
          , thuê <strong>{refDays} ngày</strong>
          <div className="font-mono text-[16px] font-semibold mt-1">{vnd(exampleAmount)}</div>
        </div>
        <div className="text-[11px] text-faint">Giá đổi theo loại/mạng/số ngày khách chọn — đây chỉ là 1 ví dụ để hình dung.</div>
      </div>
    );
  }

  return null;
}

export default function EditProduct() {
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
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("info");
  // Đọc riêng, độc lập với fetch của OperationsTab: chỉ cần biết strategy để
  // quyết định có hiện tab/khối "Biến thể" hay không — biến thể không có ý
  // nghĩa gì với strategy khác "fixed" (xem SetupSummaryCard bên dưới).
  const [ops, setOps] = useState<ProductOperations | null>(null);
  const isFixed = ops ? ops.pricing.strategy === "fixed" : true;
  const visibleTabs = isFixed ? TABS : TABS.filter((t) => t.key !== "variants");

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [serviceType, setServiceType] = useState("other");
  const [description, setDescription] = useState("");
  // Preview bên phải parse lại toàn bộ markdown mỗi lần description đổi —
  // tốn hơn hẳn 1 state input thường. Gõ trong MDXEditor cập nhật state này
  // ở MỌI keystroke; dùng useDeferredValue để React ưu tiên phần gõ (mượt
  // ngay), còn khối Preview được phép "theo sau" vài khung hình khi gõ
  // nhanh — không mất dữ liệu (state description vẫn luôn đúng, save() đọc
  // thẳng state gốc chứ không qua giá trị deferred này).
  const deferredDescription = useDeferredValue(description);
  const [highlightText, setHighlightText] = useState("");
  const [escrowDays, setEscrowDays] = useState(3);
  const [features, setFeatures] = useState<string[]>([]);
  const [warrantyText, setWarrantyText] = useState("");
  const [specs, setSpecs] = useState<{ key: string; value: string }[]>([]);
  const [pricingLabels, setPricingLabels] = useState<ProductPricingLabels>({});
  const [status, setStatus] = useState("active");
  const [dirty, setDirty] = useState(false);
  const markDirty = () => setDirty(true);

  const applyProductToForm = (p: ProductDetail, locale: ProductLocale) => {
    const translation = p.translations?.[locale] ?? (locale === "vi" ? {
      title: p.title,
      description: p.description,
      highlight_text: p.highlight_text,
      features: p.features,
      warranty_text: p.warranty_text,
    } : {});
    setTitle(translation.title ?? "");
    setDescription(translation.description ?? "");
    setHighlightText(translation.highlight_text ?? "");
    setFeatures(translation.features ?? []);
    setWarrantyText(translation.warranty_text ?? "");
    setCategoryId(p.category_id);
    setServiceType(p.service_type ?? "other");
    setEscrowDays(p.escrow_days);
    const localizedSpecs = translation.specs ?? (locale === "vi" ? p.specs : null);
    setSpecs(localizedSpecs ? Object.entries(localizedSpecs).map(([key, value]) => ({ key, value: String(value) })) : []);
    setPricingLabels(translation.pricing_labels ?? {});
    setStatus(p.status);
    setDirty(false);
  };

  const loadProduct = async () => {
    try {
      const [p, c, o] = await Promise.all([
        api.sellerProduct(Number(id)), api.categories(), api.productOperations(Number(id)),
      ]);
      setProduct(p);
      setCats(c);
      setOps(o);
      if (o.pricing.strategy !== "fixed") {
        setTab((t) => (t === "variants" ? "info" : t));
      }
      applyProductToForm(p, contentLocale);
    } catch {
      setError("Không tải được sản phẩm");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProduct(); }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  const changeContentLocale = (nextLocale: ProductLocale) => {
    if (nextLocale === contentLocale || !product) return;
    if (dirty && !window.confirm(t("switchLanguageWarning", { language: productLanguageName(contentLocale, interfaceLocale) }))) {
      return;
    }
    setContentLocale(nextLocale);
    applyProductToForm(product, nextLocale);
    setSuccess(null);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("contentLocale", nextLocale);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  const save = async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const featureList = features.map((f) => f.trim()).filter(Boolean);
      const specsEntries = specs.filter((s) => s.key.trim());
      await Promise.all([
        api.updateProduct(Number(id), {
          category_id: categoryId,
          service_type: serviceType,
          escrow_days: escrowDays,
        }),
        api.updateProductTranslation(Number(id), contentLocale, {
          title: title.trim(),
          description: description.trim() || null,
          highlight_text: highlightText.trim() || null,
          features: featureList.length > 0 ? featureList : null,
          warranty_text: warrantyText.trim() || null,
          specs: specsEntries.length > 0
            ? Object.fromEntries(specsEntries.map((s) => [s.key.trim(), s.value.trim()]))
            : null,
          pricing_labels: Object.keys(pricingLabels).length > 0 ? pricingLabels : null,
        }),
      ]);
      setSuccess(t("savedLanguage", { language: productLanguageName(contentLocale, interfaceLocale) }));
      await loadProduct();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi cập nhật");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (!product) return <Card className="p-6 text-bad text-sm">{error ?? "Không tìm thấy"}</Card>;

  const flatCats = flatten(cats);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid place-items-center h-11 w-11 shrink-0 rounded-lg bg-iris/8 border border-iris/15 font-serif text-[16px] font-bold text-iris-hi">
            {product.title.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-faint uppercase tracking-wide">{t("editProductTitle")}</p>
            <h1 className="font-serif text-[19px] leading-tight tracking-tight font-semibold truncate">{title || t("productFallback", { id })}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <Tag tone="iris">{product.category_name ?? "Chưa phân loại"}</Tag>
              <Tag tone={STATUS_TAG[product.status]?.tone ?? "neutral"}>{t(STATUS_LABEL_KEYS[product.status] ?? "status")}</Tag>
              <Tag tone="neutral"><Package size={11} /> {t("variantCount", { count: product.variants.length })}</Tag>
            </div>
          </div>
        </div>
        <Link href={`/products/${id}`} locale={contentLocale} className="shrink-0"><Button size="sm" variant="secondary"><Eye size={14} /> {t("viewLanguage", { language: productLanguageName(contentLocale, interfaceLocale) })}</Button></Link>
      </div>

      {/* Tab bar — cuộn ngang trên mobile thay vì vỡ chữ 2 dòng, giống thanh nav ở layout cha */}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {visibleTabs.map((tabItem) => {
          const Icon = tabItem.icon;
          return (
            <button key={tabItem.key} onClick={() => setTab(tabItem.key)}
              className={`flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${tab === tabItem.key ? "border-iris text-iris" : "border-transparent text-muted hover:text-primary"}`}>
              <Icon size={14} /> {t(tabItem.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Tab: Thong tin */}
      {tab === "info" && (
        <div className="space-y-5">
          <ProductLanguageRail
            interfaceLocale={interfaceLocale}
            activeLocale={contentLocale}
            translations={product.translations}
            requiredFields={{ specs: Boolean(product.specs), pricingLabels: Boolean(product.pricing_params) }}
            dirty={dirty}
            onChange={changeContentLocale}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px] items-start">
          <div className="min-w-0 space-y-5">
            <Card className="p-6 space-y-5">
              <SectionHead icon={ClipboardList} title={t("commonInfo")} hint={t("appliesAllLanguages")} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t("productCategory")}>
                  <Select value={categoryId} onChange={(e) => { setCategoryId(Number(e.target.value)); markDirty(); }}>
                    {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <Field label={t("serviceType")}>
                  <Select value={serviceType} onChange={(e) => { setServiceType(e.target.value); markDirty(); }}>
                    {SERVICE_TYPES.map((service) => <option key={service.value} value={service.value}>{t(service.key)}</option>)}
                  </Select>
                </Field>
                <Field label={t("escrowDaysLabel")}>
                  <Input type="number" min={1} value={escrowDays} onChange={(e) => { setEscrowDays(Number(e.target.value) || 3); markDirty(); }} />
                </Field>
                <Field label={t("status")}>
                  <div className="flex h-10 items-center justify-between rounded-lg border border-line bg-raised/50 px-3 text-[13px]">
                    <span>{t(STATUS_LABEL_KEYS[status] ?? "status")}</span>
                    <Tag tone="neutral">{t("adminManaged")}</Tag>
                  </div>
                </Field>
              </div>
            </Card>

            <Card className="p-6 space-y-5">
              <SectionHead icon={FileText} title={`${contentLocale.toUpperCase()} · ${productLanguageName(contentLocale, interfaceLocale)}`} hint={t("customerContent")} />
              <Field label={t("productName")}>
                <Input value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }} />
              </Field>
              <Field label={t("highlightLabel")}>
                <Input value={highlightText} onChange={(e) => { setHighlightText(e.target.value); markDirty(); }} />
              </Field>
              <Field label={t("descriptionLabel")}>
                <MarkdownEditor
                  value={description}
                  onChange={(v) => { setDescription(v); markDirty(); }}
                  placeholder={contentLocale === "en" ? "Describe the product, delivery, and intended use." : "VD: **Tài khoản Facebook uy tín**, tạo hơn 2 tháng tuổi."}
                />
              </Field>
              <ListEditor
                label={t("featuresLabel")}
                items={features}
                addLabel={t("addFeature")}
                emptyText={t("noFeatures")}
                onAdd={() => { setFeatures([...features, ""]); markDirty(); }}
                onRemove={(i) => { setFeatures(features.filter((_, idx) => idx !== i)); markDirty(); }}
                renderRow={(f, i) => (
                  <Input
                    aria-label={`Tính năng ${i + 1}`}
                    value={f}
                    placeholder={contentLocale === "en" ? "Example: 24/7 technical support" : "VD: Bảo hành 24h nếu login lỗi"}
                    onChange={(e) => {
                      const next = [...features]; next[i] = e.target.value;
                      setFeatures(next); markDirty();
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
                onAdd={() => { setSpecs([...specs, { key: "", value: "" }]); markDirty(); }}
                onRemove={(i) => { setSpecs(specs.filter((_, idx) => idx !== i)); markDirty(); }}
                renderRow={(s, i) => (
                  <div className="flex items-center gap-2">
                    <Input aria-label={`Tên thông số ${i + 1}`} value={s.key} placeholder={t("specNamePlaceholder")}
                      onChange={(e) => { const next = [...specs]; next[i] = { ...next[i], key: e.target.value }; setSpecs(next); markDirty(); }} />
                    <Input aria-label={`Giá trị thông số ${i + 1}`} value={s.value} placeholder={t("specValuePlaceholder")}
                      onChange={(e) => { const next = [...specs]; next[i] = { ...next[i], value: e.target.value }; setSpecs(next); markDirty(); }} />
                  </div>
                )}
              />
              <ProductPricingLabelsEditor
                locale={contentLocale}
                params={product.pricing_params}
                value={pricingLabels}
                onChange={setPricingLabels}
                onDirty={markDirty}
              />
            </Card>

            <Card className="p-6 space-y-5">
              <SectionHead icon={Shield} title={`${t("warrantyLabel")} · ${contentLocale.toUpperCase()}`} />
              <Field label={t("warrantyTerms")}>
                <Textarea rows={3} value={warrantyText} onChange={(e) => { setWarrantyText(e.target.value); markDirty(); }} />
              </Field>
            </Card>

            {/* Thanh lưu — cùng khuôn với tab Vận hành bên dưới (dirty mới hiện
                nút, card iris khi có thay đổi chưa lưu, card xanh khi vừa lưu
                xong) để hai tab của cùng trang nhất quán với nhau. */}
            {dirty && (
              <Card className="p-4 flex flex-wrap items-center gap-3 border-iris/30 bg-iris/5">
                <Button size="lg" disabled={saving} onClick={save}>
                  {saving ? t("saving") : t("saveLanguage", { language: productLanguageName(contentLocale, interfaceLocale) })}
                </Button>
                <span className="text-[13px] text-muted">{t("unsavedChanges")}</span>
                {error && <span className="text-[13px] text-bad">{error}</span>}
              </Card>
            )}
            {!dirty && success && (
              <Card className="p-4 border-good/30 bg-good/5">
                <span className="text-[13px] text-good">{success}</span>
              </Card>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            {/* Biến thể lên trước — đây là việc seller cần thao tác thường
                xuyên (nạp hàng, đổi giá); khối Xem trước để sau vì chỉ để
                tham khảo, không nên đẩy Biến thể xuống dưới màn hình. */}
            {isFixed ? (
              <VariantManager productId={Number(id)} variants={product.variants} onRefresh={loadProduct} />
            ) : (
              <SetupSummaryCard ops={ops} onViewOperations={() => setTab("operations")} />
            )}
            <div className="lg:sticky lg:top-6">
              <ProductPreviewCard
                title={title}
                categoryName={flatCats.find((c) => c.id === categoryId)?.name}
                serviceType={serviceType}
                status={status}
                escrowDays={escrowDays}
                highlightText={highlightText}
                description={deferredDescription}
                features={features}
                specs={specs}
                warrantyText={warrantyText}
                variants={product.variants}
              />
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Tab: Bien the — chỉ tồn tại khi strategy là "fixed" (visibleTabs đã lọc) */}
      {tab === "variants" && isFixed && (
        <div className="max-w-[600px]">
          <VariantManager productId={Number(id)} variants={product.variants} onRefresh={loadProduct} />
        </div>
      )}

      {/* Tab: Van hanh */}
      {tab === "operations" && (
        <OperationsTab productId={Number(id)} />
      )}
    </div>
  );
}

/* ── Setup summary (thay cho Biến thể khi strategy khác "fixed") ──── */

function SetupSummaryCard({ ops, onViewOperations }: { ops: ProductOperations | null; onViewOperations: () => void }) {
  const t = useTranslations("seller");
  const locale = useLocale();
  if (!ops) return <Card className="p-4"><Spinner /></Card>;

  const strategy = ops.pricing.strategy || "fixed";
  const sInfo = STRATEGY_INFO[strategy] ?? STRATEGY_INFO.fixed;
  const strategyLabel = t(STRATEGY_LABEL_KEYS[strategy] ?? "strategyFixed");
  const adapterType = ops.provider?.adapter_type ?? null;
  const aInfo = adapterType ? (ADAPTER_INFO[adapterType] ?? { label: adapterType, description: "" }) : null;

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-[14px] font-semibold flex items-center gap-2">
        <Activity size={14} /> {t("operationsConfig")}
      </h3>
      <p className="text-[12.5px] text-muted">
        {t("operationsSummary", { strategy: strategyLabel })}
      </p>

      <div className="flex items-center gap-2 flex-wrap text-[13px]">
        <Tag tone="iris">{strategyLabel}</Tag>
        {ops.provider ? (
          <>
            <span className="text-faint">·</span>
            <span className="font-medium">{ops.provider.name}</span>
            {aInfo && <Tag tone="neutral">{aInfo.label}</Tag>}
          </>
        ) : (
          <Tag tone="neutral">{t("providerNotAssigned")}</Tag>
        )}
      </div>

      {ops.needs_setup ? (
        <Banner tone="warn" icon={<Info size={15} />} title={t("notReadyToSell")}>
          {locale === "vi" ? (ops.needs_setup_reason ?? t("setupIncomplete")) : t("setupIncomplete")}
        </Banner>
      ) : ops.demo_mode ? (
        <Banner tone="iris" icon={<Info size={15} />} title={t("demoMode")}>
          {t("demoModeDescription")}
        </Banner>
      ) : (
        <Banner tone="good" icon={<Check size={15} />} title={t("readyToSell")}>
          {t("readyToSellDescription")}
        </Banner>
      )}

      <Button size="sm" variant="secondary" onClick={onViewOperations}>{t("viewOperationsDetails")}</Button>
    </Card>
  );
}

/* ── Operations Tab ─────────────────────────────────────────────── */

function OperationsTab({ productId }: { productId: number }) {
  const { account } = useAuth();
  const isAdmin = account?.roles?.includes("admin") ?? false;

  const [ops, setOps] = useState<ProductOperations | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pendingProviders, setPendingProviders] = useState<Provider[]>([]);
  const [compatMatrix, setCompatMatrix] = useState<Record<string, string[] | "*"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin edit state
  const [editProviderId, setEditProviderId] = useState<number | null>(null);
  const [editStrategy, setEditStrategy] = useState<string>("fixed");
  const [editParams, setEditParams] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadOps = async () => {
    setLoading(true);
    try {
      const o = await api.productOperations(productId);
      setOps(o);
      setEditProviderId(o.provider?.id ?? null);
      setEditStrategy(o.pricing.strategy || "fixed");
      setEditParams(structuredClone(o.pricing.params ?? {}));
      if (isAdmin) {
        const [pList, matrix] = await Promise.all([api.providers(), api.adapterCompatibility()]);
        setProviders(pList);
        setCompatMatrix(matrix);
      } else {
        // Seller thường chỉ được chọn trong CHÍNH provider của họ, và chỉ khi
        // đã được admin duyệt — xem providers/service.py::_validate_provider_assignment.
        try {
          const [pList, matrix] = await Promise.all([api.sellerProviders(), api.adapterCompatibility()]);
          setProviders(pList.filter((p) => p.review_status === "approved"));
          setPendingProviders(pList.filter((p) => p.review_status === "pending_review"));
          setCompatMatrix(matrix);
        } catch {
          // Seller chưa đủ tier để tự đăng ký provider — bỏ qua, phần chọn
          // provider tự phục vụ ẩn đi, seller vẫn xem được provider admin đã gán.
          setPendingProviders([]);
        }
      }
    } catch {
      setError("Không tải được thông tin vận hành");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOps(); }, [productId]);

  const markDirty = () => { setDirty(true); setSaveMsg(null); };

  const handleSave = async () => {
    setSaving(true); setSaveMsg(null);
    try {
      if (isAdmin) {
        await api.updateProductOperations(productId, {
          provider_id: editProviderId,
          pricing_strategy: editStrategy,
          pricing_params: editStrategy === "fixed" ? null : editParams,
        });
      } else {
        // Seller thường: sửa chiến lược giá + tham số CHO SẢN PHẨM CỦA MÌNH, và
        // (mới) tự gắn được provider CỦA CHÍNH MÌNH đã được admin duyệt —
        // provider dùng chung/của seller khác vẫn ngoài tầm, backend tự chặn.
        await api.updateSellerPricing(productId, {
          pricing_strategy: editStrategy,
          pricing_params: editStrategy === "fixed" ? null : editParams,
          provider_id: editProviderId,
        });
      }
      setSaveMsg({ type: "ok", text: "Đã lưu cấu hình giá!" });
      setDirty(false);
      await loadOps();
    } catch (e) {
      setSaveMsg({ type: "err", text: e instanceof Error ? e.message : "Lỗi khi lưu" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (error || !ops) return <Card className="p-6 text-bad text-sm">{error ?? "Không có dữ liệu"}</Card>;

  const strategy = ops.pricing.strategy || "fixed";
  const sInfo = STRATEGY_INFO[strategy] ?? STRATEGY_INFO.fixed;
  const adapterType = ops.provider?.adapter_type ?? "seller_pool";
  const aInfo = ADAPTER_INFO[adapterType] ?? { label: adapterType, description: "" };
  const providerName = ops.provider?.name ?? "Seller Pool";
  const health = ops.provider?.health ?? "healthy";

  const healthDot = health === "healthy" ? "bg-good" : health === "degraded" ? "bg-warn" : "bg-bad";
  const healthLabel = health === "healthy" ? "Khoẻ" : health === "degraded" ? "Chậm" : "Lỗi";

  // 2 bước đầu (khách nhập / tính giá) luôn chạy được. 2 bước sau (cấp phát/
  // giao hàng thật) chỉ chạy khi needs_setup = false — phản ánh đúng trạng
  // thái thay vì luôn hiện "hoạt động" dù sản phẩm đang bị chặn bán.
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
  const selectedProvider = providers.find((p) => p.id === editProviderId);
  const selectedProviderCompatible = selectedProvider
    ? isAdapterCompatible(selectedProvider.adapter_type, editStrategy, compatMatrix)
    : editProviderId == null;

  return (
    <div className="space-y-6">
      {ops.needs_setup && (
        <Banner tone="bad" icon={<Info size={15} />} title="Sản phẩm chưa bán được">
          {ops.needs_setup_reason}
        </Banner>
      )}

      {!isAdmin && (
        <Card className="p-5 space-y-3 border-iris/25">
          <h3 className="text-[14px] font-semibold">Trạng thái để sản phẩm bán được</h3>
          <div className="grid gap-2 sm:grid-cols-3 text-[12.5px]">
            <div className={`rounded-lg border px-3 py-2 ${providers.length > 0 ? "border-good/30 bg-good-soft text-good" : "border-line bg-raised text-muted"}`}>
              {providers.length > 0 ? "✓ Có backend đã duyệt" : "1. Đăng ký backend"}
            </div>
            <div className={`rounded-lg border px-3 py-2 ${selectedProvider && selectedProviderCompatible ? "border-good/30 bg-good-soft text-good" : "border-line bg-raised text-muted"}`}>
              {selectedProvider && selectedProviderCompatible ? "✓ Backend khớp chiến lược giá" : "2. Gắn backend phù hợp"}
            </div>
            <div className={`rounded-lg border px-3 py-2 ${!ops.needs_setup ? "border-good/30 bg-good-soft text-good" : "border-line bg-raised text-muted"}`}>
              {!ops.needs_setup ? "✓ Sẵn sàng bán" : "3. Lưu cấu hình để hoàn tất"}
            </div>
          </div>
          {pendingProviders.length > 0 && (
            <p className="text-[12px] text-warn">{pendingProviders.length} backend của bạn đang chờ admin duyệt nên chưa xuất hiện trong danh sách chọn. <Link href="/seller/providers" className="underline">Xem trạng thái backend</Link></p>
          )}
          {providers.length === 0 && pendingProviders.length === 0 && (
            <p className="text-[12px] text-muted">Chưa có backend nào được duyệt. <Link href="/seller/providers" className="text-iris-hi underline">Đăng ký backend</Link> trước, hoặc liên hệ admin để dùng hạ tầng chung.</p>
          )}
        </Card>
      )}

      {/* Section 1: Pipeline */}
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

      {/* Section 2: Chiến lược giá — sản phẩm của bạn, bạn tự cấu hình */}
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
            <PlanSummary strategy={editStrategy} params={editParams} />
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

      {/* Section 3: Nhà cung cấp */}
      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Users size={14} /> Nhà cung cấp
        </h3>

        {isAdmin ? (
          <div className="space-y-3">
            <Field label="Chọn nhà cung cấp" hint="Lựa chọn không tương thích với chiến lược giá đã chọn ở trên bị vô hiệu hoá.">
              <Select value={editProviderId ?? ""} onChange={(e) => { setEditProviderId(e.target.value ? Number(e.target.value) : null); markDirty(); }}>
                <option value="">— Không gán (Seller Pool) —</option>
                {providers.map((p) => {
                  const compatible = isAdapterCompatible(p.adapter_type, editStrategy, compatMatrix);
                  return (
                    <option key={p.id} value={p.id} disabled={!compatible}>
                      {p.name} ({p.adapter_type}){!compatible ? " — không tương thích" : ""}
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
        ) : providers.length > 0 ? (
          <div className="space-y-3">
            <Field label="Chọn backend của bạn" hint="Chỉ liệt kê backend do chính bạn đăng ký và đã được duyệt.">
              <Select value={editProviderId ?? ""} onChange={(e) => { setEditProviderId(e.target.value ? Number(e.target.value) : null); markDirty(); }}>
                <option value="">— Không gán —</option>
                {providers.map((p) => {
                  const compatible = isAdapterCompatible(p.adapter_type, editStrategy, compatMatrix);
                  return (
                    <option key={p.id} value={p.id} disabled={!compatible}>
                      {p.name} ({p.adapter_type}){!compatible ? " — không tương thích" : ""}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <p className="text-[12.5px] text-faint">
              Quản lý ở <Link href="/seller/providers" className="text-iris-hi underline">Backend của tôi</Link> — muốn dùng hạ tầng dùng chung thì liên hệ admin.
            </p>
            {(() => {
              const selected = providers.find((p) => p.id === editProviderId);
              if (!selected || isAdapterCompatible(selected.adapter_type, editStrategy, compatMatrix)) return null;
              return (
                <Banner tone="bad" icon={<Info size={15} />}>
                  Backend &quot;{selected.adapter_type}&quot; không tương thích với chiến lược &quot;{editStrategy}&quot; — lưu sẽ bị từ chối.
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
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-medium">{providerName}</span>
              <Tag tone="iris">{aInfo.label}</Tag>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${healthDot}`} />
                <span className="text-[12px] text-muted">{healthLabel}</span>
              </div>
            </div>
            <p className="text-[13px] text-muted">{aInfo.description}</p>
            <p className="text-[12.5px] text-faint">
              Muốn tự đấu nối backend riêng? Đăng ký ở <Link href="/seller/providers" className="text-iris-hi underline">Backend của tôi</Link> (cần hạng trusted trở lên, chờ admin duyệt).
            </p>
            {pendingProviders.length > 0 && (
              <p className="text-[12.5px] text-warn">Backend đã nộp đang chờ duyệt nên chưa thể gắn vào sản phẩm.</p>
            )}
          </>
        )}

        {ops.demo_mode && (
          <Banner tone="iris" icon={<Info size={15} />}>
            Sản phẩm đang dùng dữ liệu demo. Khi kết nối API thật, dữ liệu sẽ tự chuyển sang nguồn thật.
          </Banner>
        )}
      </Card>

      {/* Save button — mọi seller sửa được Chiến lược giá cho sản phẩm của mình;
          admin sửa thêm Nhà cung cấp trong cùng lần lưu này. */}
      {dirty && (
        <Card className="p-4 flex items-center gap-3 border-iris/30 bg-iris/5">
          <Button size="lg" disabled={saving} onClick={handleSave}>
            {saving ? "Đang lưu…" : "Lưu cấu hình giá"}
          </Button>
          {saveMsg && <span className={`text-[13px] ${saveMsg.type === "ok" ? "text-good" : "text-bad"}`}>{saveMsg.text}</span>}
        </Card>
      )}
      {!dirty && saveMsg && (
        <Card className="p-4 border-good/30 bg-good/5">
          <span className="text-[13px] text-good">{saveMsg.text}</span>
        </Card>
      )}

      {/* Section 4: Thống kê */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Tổng đơn" value={String(ops.stats.total_orders)} />
        <StatCard label="Doanh thu" value={vnd(ops.stats.revenue)} />
        <StatCard label="Tỷ lệ thành công" value={`${(ops.stats.success_rate * 100).toFixed(1)}%`} tone={ops.stats.success_rate >= 0.95 ? "good" : ops.stats.success_rate >= 0.8 ? "warn" : "bad"} />
        <StatCard label="Khiếu nại" value={String(ops.stats.disputes)} tone={ops.stats.disputes === 0 ? "good" : "warn"} />
      </div>

      {/* Section 5: Hướng dẫn */}
      <Card className="p-5 space-y-3 border-iris/20">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Info size={14} /> Hướng dẫn
        </h3>
        <div className="text-[13px] text-muted space-y-2">
          <p>
            Sản phẩm của bạn đang dùng chiến lược <strong className="text-primary">{sInfo.label}</strong>.
            {strategy === "fixed" && " Khi khách mua, hệ thống sẽ lấy giá từ biến thể, trừ tiền ví và giao hàng tự động."}
            {strategy === "config" && " Khi khách mua, hệ thống sẽ tính giá theo tuỳ chọn khách chọn, trừ tiền ví và giao hàng tự động."}
            {strategy === "credit" && " Khi khách mua gói credit, hệ thống sẽ cấp API key. Mỗi request tự trừ credit."}
            {strategy === "task" && " Khi khách đặt tác vụ, hệ thống sẽ tạo task cho team xử lý thủ công."}
          </p>
          {!isAdmin && ops.needs_setup && (
            <p className="text-bad">
              {ops.needs_setup_reason ?? "Cấu hình chưa hoàn tất."}{" "}
              {ops.needs_setup_reason?.includes("Chưa gắn nhà cung cấp")
                ? "Đây là phần quản trị viên phụ trách — liên hệ để họ gắn nhà cung cấp cho sản phẩm này."
                : "Thử đổi chiến lược giá ở trên cho khớp với nhà cung cấp đang gắn, hoặc liên hệ quản trị viên để đổi nhà cung cấp."}
            </p>
          )}
        </div>
      </Card>
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

/* ── Variant Manager ───────────────────────────────────────────── */

function VariantManager({ productId, variants, onRefresh }: {
  productId: number; variants: Variant[]; onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [mode, setMode] = useState("instant");
  const [sla, setSla] = useState("24");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const addVariant = async () => {
    if (!name.trim() || !price) return;
    setSaving(true);
    try {
      await api.createVariant(productId, {
        name: name.trim(),
        price: Number(price),
        delivery_mode: mode,
        sla_hours: Number(sla) || 24,
        duration_days: duration ? Number(duration) : null,
      });
      setName(""); setPrice(""); setDuration(""); setAdding(false);
      onRefresh();
    } catch { } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">Biến thể ({variants.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => setAdding(!adding)}>
          <Plus size={13} /> Thêm
        </Button>
      </div>

      {adding && (
        <Card className="p-4 space-y-3 border-iris/30">
          <Field label="Tên biến thể">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Email + cookies" />
          </Field>
          <div className="grid gap-3 grid-cols-2">
            <Field label="Giá bán">
              <MoneyInput value={price.replace(/\D/g, "")} onValueChange={setPrice} placeholder="vd 25.000" />
            </Field>
            <Field label="Giao hàng">
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="instant">Giao ngay</option>
                <option value="manual">Thủ công</option>
              </Select>
            </Field>
          </div>
          {mode === "manual" && (
            <Field label="SLA (giờ)">
              <Input type="number" value={sla} onChange={(e) => setSla(e.target.value)} />
            </Field>
          )}
          <Field label="Thời hạn sử dụng (ngày)" hint="Để trống = vĩnh viễn">
            <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="VD: 7, 30…" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={saving} onClick={addVariant}>{saving ? "Đang thêm…" : "Thêm biến thể"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Huỷ</Button>
          </div>
        </Card>
      )}

      {variants.map((v) => (
        <VariantCard
          key={v.id}
          variant={v}
          editing={editing === v.id}
          onEdit={() => setEditing(v.id)}
          onDone={() => setEditing(null)}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

/* Một biến thể là điều khoản bán: giao thế nào, dùng được bao lâu, giá bao nhiêu.
   Sửa ngay tại chỗ — giá trị biến thành ô nhập đúng vị trí nó đang đứng, card
   không nhảy và không mở hộp thoại. */
function VariantCard({ variant: v, editing, onEdit, onDone, onRefresh }: {
  variant: Variant; editing: boolean; onEdit: () => void; onDone: () => void; onRefresh: () => void;
}) {
  const [name, setName] = useState(v.name);
  const [price, setPrice] = useState(String(v.price));
  const [mode, setMode] = useState(v.delivery_mode);
  const [sla, setSla] = useState(String(v.sla_hours));
  const [duration, setDuration] = useState(v.duration_days ? String(v.duration_days) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [stocking, setStocking] = useState(false);
  const [paste, setPaste] = useState("");
  const [stockMsg, setStockMsg] = useState("");

  useEffect(() => {
    if (!editing) {
      setName(v.name); setPrice(String(v.price)); setMode(v.delivery_mode);
      setSla(String(v.sla_hours)); setDuration(v.duration_days ? String(v.duration_days) : "");
      setErr("");
    }
  }, [editing, v]);

  const priceChanged = Number(price) !== v.price;

  const save = async () => {
    if (!name.trim() || !Number(price)) return;
    setBusy(true);
    setErr("");
    try {
      await api.updateVariant(v.id, {
        name: name.trim(),
        price: Number(price),
        delivery_mode: mode,
        sla_hours: Number(sla) || 24,
        // null = vĩnh viễn; gửi hẳn null chứ không bỏ field, nếu không backend
        // sẽ giữ nguyên thời hạn cũ và seller không xoá được nó.
        duration_days: duration ? Number(duration) : null,
      });
      onDone();
      onRefresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không lưu được, thử lại.");
    } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.updateVariant(v.id, { is_active: !v.is_active });
      onRefresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không đổi được trạng thái.");
    } finally { setBusy(false); }
  };

  const addStock = async () => {
    const lines = paste.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      await api.addResources(v.id, lines);
      setPaste("");
      setStockMsg(`Đã nạp ${lines.length} dòng vào kho.`);
      onRefresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không nạp được hàng, thử lại.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.deleteVariant(v.id);
      onRefresh();
    } catch (e) {
      // Backend chặn xoá khi gói còn kho hoặc đã có đơn, và nói rõ lý do — hiện
      // nguyên văn thay vì im lặng như trước.
      setErr(e instanceof ApiError ? e.message : "Không xoá được gói này.");
      setBusy(false);
    }
  };

  if (editing) {
    return (
      /* Giữ đúng cấu trúc 2 dòng của trạng thái đọc: tên ở dòng trên, điều khoản ở
         dòng dưới, nút ở góc phải. Mỗi ô nhập đứng đúng chỗ giá trị nó thay thế,
         nên card không phình ra và không đẩy các gói khác xuống. */
      <Card className="p-4 border-iris/40">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            {/* Chiều rộng đặt ở div bọc ngoài, không phải className của Input/Select:
                `cn` chỉ nối chuỗi (không dùng tailwind-merge), nên `w-…` truyền vào
                sẽ đụng `w-full` sẵn có của component và thắng thua theo thứ tự CSS. */}
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Tên biến thể"
              placeholder="Tên biến thể"
              className="text-[13px] font-medium"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-[130px]">
                <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Cách giao hàng">
                  <option value="instant">Giao ngay</option>
                  <option value="manual">Thủ công</option>
                </Select>
              </div>
              {mode === "manual" && (
                <div className="flex items-center gap-1">
                  <div className="w-[72px]">
                    <Input type="number" min={1} value={sla} onChange={(e) => setSla(e.target.value)}
                      aria-label="SLA, số giờ" className="tabular" />
                  </div>
                  <span className="text-[12px] text-faint">giờ</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className="w-[104px]">
                  <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)}
                    aria-label="Thời hạn sử dụng, số ngày. Để trống là vĩnh viễn"
                    placeholder="Vĩnh viễn" className="tabular" />
                </div>
                <span className="text-[12px] text-faint">ngày</span>
              </div>
              <div className="w-[148px]">
                <MoneyInput value={String(price).replace(/\D/g, "")} onValueChange={setPrice} placeholder="Giá" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" disabled={busy || !name.trim() || !Number(price)} onClick={save}>
              {busy ? "Đang lưu…" : "Lưu"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDone}>Huỷ</Button>
          </div>
        </div>

        {priceChanged && (
          <p className="text-[12px] text-muted mt-2">
            Giá mới chỉ áp dụng cho đơn đặt sau khi lưu. Đơn đã mua giữ nguyên giá cũ.
          </p>
        )}
        {err && <p className="text-[12px] text-bad mt-2">{err}</p>}
      </Card>
    );
  }

  return (
    <Card className={cn("p-4", !v.is_active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium truncate">{v.name}</span>
            {!v.is_active && <Tag tone="neutral">Đang tắt</Tag>}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {v.delivery_mode === "instant"
              ? <Tag tone="good"><Bolt size={10} /> Giao ngay</Tag>
              : <Tag tone="warn"><Clock size={10} /> {v.sla_hours}h</Tag>}
            <Tag tone="iris">{v.duration_days ? `${v.duration_days} ngày` : "Vĩnh viễn"}</Tag>
            <span className="font-mono text-[13px] font-semibold tabular">{vnd(v.price)}</span>
          </div>
          {v.delivery_mode === "instant" && (
            <div className="flex items-center gap-2 mt-1.5 text-[12px]">
              <span className={cn("inline-flex items-center gap-1", v.stock_count === 0 ? "text-bad" : "text-muted")}>
                <Package size={12} />
                {v.stock_count > 0 ? `${v.stock_count} trong kho` : "Chưa có hàng"}
              </span>
              <span className="text-line-2">·</span>
              <button onClick={() => setStocking((s) => !s)}
                className="text-iris-hi hover:underline cursor-pointer">
                Nạp hàng
              </button>
              {/* Trỏ thẳng tới đúng gói này chứ không phải đầu danh sách — seller
                  có thể có hàng chục gói. */}
              <Link href={`/seller/inventory?variant=${v.id}`} className="text-faint hover:text-iris-hi transition-colors">
                Xem kho
              </Link>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onEdit}><Edit2 size={13} /> Sửa</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={toggleActive}>
            {v.is_active ? "Tắt bán" : "Bật bán"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} className="text-bad hover:text-bad"
            aria-label="Xoá gói" onClick={remove}>
            <Trash size={13} />
          </Button>
        </div>
      </div>

      {/* Chỉ NẠP hàng, cố ý không liệt kê/sửa từng dòng ở đây: vừa tạo gói xong thì
          việc cần làm ngay là bỏ hàng vào, còn truy dòng hỏng là việc của trang Kho
          hàng. Dựng thêm một trình sửa dòng thứ hai ở đây chỉ tạo ra hai bản, bản
          này dở hơn. */}
      {stocking && (
        <div className="mt-3 pt-3 border-t border-line space-y-2">
          <textarea
            autoFocus
            rows={4}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"Mỗi dòng một sản phẩm\nuid1|pass1|mail1@vd.com\nuid2|pass2|mail2@vd.com"}
            className="w-full font-mono text-[12px] rounded-lg border border-line bg-surface px-3 py-2 focus:border-iris focus:bg-panel focus:outline-none"
          />
          {stockMsg && <p className="text-[12px] text-good">{stockMsg}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || !paste.trim()} onClick={addStock}>
              {busy ? "Đang thêm…" : `Thêm ${paste.split("\n").filter((l) => l.trim()).length} dòng vào kho`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setStocking(false); setPaste(""); setStockMsg(""); }}>
              Xong
            </Button>
          </div>
        </div>
      )}

      {err && <p className="text-[12px] text-bad mt-2">{err}</p>}
    </Card>
  );
}
