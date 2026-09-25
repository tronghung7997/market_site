"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, TriangleAlert, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useVariantTermFor } from "@/lib/variant-term";
import { productPath } from "@/lib/routes";
import { SERVICE_LABELS } from "@/lib/labels";
import { STRATEGY_INFO, STRATEGY_FORMULAS, ADAPTER_INFO } from "@/lib/pricing-config";
import { isAdapterCompatible, type CompatMatrix } from "@/lib/compat";
import { fulfillmentFromProduct, fulfillmentTagKey, fulfillmentTagValues, fulfillmentTone } from "@/lib/fulfillment";
import type {
  AdminProductBulkAction, AdminProductDetail, Category, ProductLocale, ProductOperations,
  ProductPricingLabels, Provider,
} from "@/lib/types";
import { Banner, Button, Card, Field, Input, Monogram, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { ArrowRight } from "@/components/Icons";
import { ConfirmModal } from "@/components/admin";
import { PricingParamsEditor } from "@/components/PricingParamsEditor";
import { PricingGridEditor, isGridParams } from "@/features/pricing-grid";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ListEditor } from "@/components/ListEditor";
import { ProductPreviewCard } from "@/components/seller/ProductPreviewCard";
import { ProductLanguageRail, productLanguageName } from "@/components/products/ProductLanguageRail";
import { ProductPricingLabelsEditor, hasPlanTable } from "@/components/products/ProductPricingLabelsEditor";
import { AdminReviewsPanel, TrustSeedPanel } from "@/features/reviews";
import { bulkResultMessage, describeActivity, statusActionsFor, statusMeta } from "../model";

const TABS = [
  { key: "overview", label: "Tổng quan" },
  { key: "content", label: "Nội dung" },
  { key: "operations", label: "Giá & nguồn hàng" },
  { key: "reviews", label: "Đánh giá" },
  { key: "history", label: "Lịch sử" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const CONTENT_EMPTY = {
  title: "", category_id: 0, service_type: "other", escrow_days: 2,
  highlight_text: "", description: "", warranty_text: "",
};

function flatten(cats: Category[]): { id: number; label: string }[] {
  const out: { id: number; label: string }[] = [];
  const walk = (list: Category[], prefix: string) => list.forEach((c) => {
    const label = prefix ? `${prefix} › ${c.name}` : c.name;
    out.push({ id: c.id, label });
    walk(c.children ?? [], label);
  });
  walk(cats, "");
  return out;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Metric({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad"; sub?: string }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-fg";
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className={cn("mt-1 truncate font-mono text-[17px] font-semibold tabular-nums", color)}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-faint">{sub}</p>}
    </div>
  );
}

function Section({ title, hint, action, children, className }: {
  title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={cn("p-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

/** Thanh lưu dính đáy khi có thay đổi chưa lưu. */
function SaveBar({ label, saving, onSave, onDiscard, message }: {
  label: string; saving: boolean; onSave: () => void; onDiscard: () => void;
  message?: { type: "ok" | "err"; text: string } | null;
}) {
  return (
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-panel px-4 py-2.5 text-white shadow-card-lg">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
      <span className="min-w-0 flex-1 text-[13px]">{message?.type === "err" ? <span className="text-red-300">{message.text}</span> : label}</span>
      <button type="button" onClick={onDiscard} disabled={saving} className="h-8 rounded-lg px-3 text-[13px] text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50">
        Huỷ thay đổi
      </button>
      <Button size="sm" loading={saving} onClick={onSave}>Lưu thay đổi</Button>
    </div>
  );
}

export function AdminProductEditor({ productId }: { productId: number }) {
  const apiErrorMessage = useApiErrorMessage();
  const t = useTranslations("seller");
  const tp = useTranslations("products");
  const termFor = useVariantTermFor();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { locale: interfaceLocaleParam } = useParams<{ locale: string }>();
  const interfaceLocale: ProductLocale = interfaceLocaleParam === "en" ? "en" : "vi";

  const rawTab = searchParams.get("tab");
  const tab: TabKey = TABS.some((x) => x.key === rawTab) ? (rawTab as TabKey) : "overview";
  const setTab = (next: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab"); else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const requested = searchParams.get("contentLocale");
  const [contentLocale, setContentLocale] = React.useState<ProductLocale>(
    requested === "en" || requested === "vi" ? requested : interfaceLocale,
  );

  const [product, setProduct] = React.useState<AdminProductDetail | null>(null);
  const [ops, setOps] = React.useState<ProductOperations | null>(null);
  const [providers, setProviders] = React.useState<Provider[]>([]);
  const [compatMatrix, setCompatMatrix] = React.useState<CompatMatrix | null>(null);
  const [cats, setCats] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Vận hành (giá, nguồn hàng, hoa hồng)
  const [editProviderId, setEditProviderId] = React.useState<number | null>(null);
  const [editStrategy, setEditStrategy] = React.useState("fixed");
  const [editParams, setEditParams] = React.useState<Record<string, unknown>>({});
  const [editCommission, setEditCommission] = React.useState("");
  const [opsDirty, setOpsDirty] = React.useState(false);
  const [opsSaving, setOpsSaving] = React.useState(false);
  const [opsMsg, setOpsMsg] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Nội dung (theo ngôn ngữ) + thông tin chung
  const [content, setContent] = React.useState(CONTENT_EMPTY);
  const [features, setFeatures] = React.useState<string[]>([]);
  const [specs, setSpecs] = React.useState<{ key: string; value: string }[]>([]);
  const [pricingLabels, setPricingLabels] = React.useState<ProductPricingLabels>({});
  // Thứ tự backend phủ nhãn cho buyer tiếng Việt khi sản phẩm còn tính theo
  // công thức (resolve_product_pricing_params): en rồi vi.
  const labelOverlays = React.useMemo(
    () => [product?.translations?.en?.pricing_labels, product?.translations?.vi?.pricing_labels] as (Record<string, unknown> | null | undefined)[],
    [product],
  );
  const [contentDirty, setContentDirty] = React.useState(false);
  const [contentSaving, setContentSaving] = React.useState(false);
  const [contentMsg, setContentMsg] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Trạng thái
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [statusBusy, setStatusBusy] = React.useState(false);
  const [statusNotice, setStatusNotice] = React.useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [suspendReason, setSuspendReason] = React.useState("");
  const statusRef = React.useRef<HTMLDivElement>(null);

  const activityQ = useQuery({
    queryKey: ["admin", "products", productId, "activity"],
    queryFn: () => api.adminProductActivity(productId),
    staleTime: 10_000,
  });

  const applyContent = React.useCallback((p: AdminProductDetail, locale: ProductLocale) => {
    const tr = p.translations?.[locale] ?? (locale === "vi" ? {
      title: p.title, description: p.description, highlight_text: p.highlight_text,
      features: p.features, warranty_text: p.warranty_text,
    } : {});
    setContent({
      category_id: p.category_id,
      service_type: p.service_type ?? "other",
      escrow_days: p.escrow_days,
      title: tr.title ?? "",
      highlight_text: tr.highlight_text ?? "",
      description: tr.description ?? "",
      warranty_text: tr.warranty_text ?? "",
    });
    setFeatures(tr.features ?? []);
    const localizedSpecs = tr.specs ?? (locale === "vi" ? p.specs : null);
    setSpecs(localizedSpecs ? Object.entries(localizedSpecs).map(([key, value]) => ({ key, value: String(value) })) : []);
    setPricingLabels(tr.pricing_labels ?? {});
  }, []);

  const applyOps = React.useCallback((p: AdminProductDetail, o: ProductOperations) => {
    setEditProviderId(o.provider?.id ?? null);
    setEditStrategy(o.pricing.strategy || "fixed");
    setEditParams(structuredClone(o.pricing.params ?? {}));
    setEditCommission(p.commission_rate != null ? String(p.commission_rate) : "");
  }, []);

  const loadAll = React.useCallback(async (opts: { keepContent?: boolean; keepOps?: boolean } = {}) => {
    try {
      const [p, o, provList, matrix, c] = await Promise.all([
        api.adminProduct(productId),
        api.productOperations(productId),
        api.providers(),
        api.adapterCompatibility(),
        api.categories(),
      ]);
      setProduct(p);
      setOps(o);
      setProviders(provList);
      setCompatMatrix(matrix);
      setCats(c);
      if (!opts.keepOps) { applyOps(p, o); setOpsDirty(false); }
      if (!opts.keepContent) { applyContent(p, contentLocale); setContentDirty(false); }
      setLoadError(null);
    } catch (e) {
      setLoadError(apiErrorMessage(e, "Không tải được sản phẩm"));
    } finally {
      setLoading(false);
    }
  }, [productId, contentLocale, applyContent, applyOps, apiErrorMessage]);

  React.useEffect(() => { void loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [productId]);

  React.useEffect(() => {
    if (!opsDirty && !contentDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [opsDirty, contentDirty]);

  React.useEffect(() => {
    if (!statusOpen) return;
    const close = (e: MouseEvent) => { if (!statusRef.current?.contains(e.target as Node)) setStatusOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setStatusOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [statusOpen]);

  const refreshAfterMutation = async (opts: { keepContent?: boolean; keepOps?: boolean }) => {
    await loadAll(opts);
    await activityQ.refetch();
    await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
  };

  const changeStatus = async (action: Exclude<AdminProductBulkAction, "set_category">, reason?: string) => {
    setStatusBusy(true);
    setStatusNotice(null);
    try {
      if (action === "suspend") {
        await api.adminSuspendProduct(productId, reason);
        setStatusNotice({ tone: "good", text: "Đã khoá sản phẩm." });
      } else {
        const result = await api.adminBulkProducts({ ids: [productId], action });
        const target = { activate: "active", pause: "paused", draft: "draft" }[action];
        setStatusNotice(result.skipped.some((s) => s.reason === "needs_setup")
          ? { tone: "bad", text: "Chưa mở bán được: sản phẩm chưa thiết lập xong nguồn hàng / giá. Xem tab Giá & nguồn hàng." }
          : result.updated.includes(productId)
            ? { tone: "good", text: `Đã chuyển sang “${statusMeta(target).label}”.` }
            : bulkResultMessage(result, action));
      }
      await refreshAfterMutation({ keepContent: contentDirty, keepOps: opsDirty });
    } catch (e) {
      setStatusNotice({ tone: "bad", text: apiErrorMessage(e, "Không đổi được trạng thái") });
    } finally {
      setStatusBusy(false);
      setSuspendOpen(false);
      setSuspendReason("");
    }
  };

  const changeContentLocale = (next: ProductLocale) => {
    if (next === contentLocale || !product) return;
    if (contentDirty && !window.confirm(t("switchLanguageWarning", { language: productLanguageName(contentLocale, interfaceLocale) }))) return;
    setContentLocale(next);
    applyContent(product, next);
    setContentDirty(false);
    setContentMsg(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("contentLocale", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const markContent = () => { setContentDirty(true); setContentMsg(null); };
  const markOps = () => { setOpsDirty(true); setOpsMsg(null); };

  const saveContent = async () => {
    if (!content.title.trim()) {
      setContentMsg({ type: "err", text: "Tên sản phẩm không được để trống." });
      return;
    }
    setContentSaving(true);
    setContentMsg(null);
    try {
      const featureList = features.map((f) => f.trim()).filter(Boolean);
      const specEntries = specs.filter((s) => s.key.trim());
      await api.adminUpdateProduct(productId, {
        category_id: content.category_id,
        service_type: content.service_type,
        escrow_days: content.escrow_days,
      });
      await api.adminUpdateProductTranslation(productId, contentLocale, {
        title: content.title.trim(),
        highlight_text: content.highlight_text.trim() || null,
        description: content.description.trim() || null,
        features: featureList.length > 0 ? featureList : null,
        warranty_text: content.warranty_text.trim() || null,
        specs: specEntries.length > 0 ? Object.fromEntries(specEntries.map((s) => [s.key.trim(), s.value.trim()])) : null,
        pricing_labels: Object.keys(pricingLabels).length > 0 ? pricingLabels : null,
      });
      setContentMsg({ type: "ok", text: t("savedLanguage", { language: productLanguageName(contentLocale, interfaceLocale) }) });
      await refreshAfterMutation({ keepOps: opsDirty });
    } catch (e) {
      setContentMsg({ type: "err", text: apiErrorMessage(e, "Lỗi khi lưu nội dung") });
    } finally {
      setContentSaving(false);
    }
  };

  const saveOps = async () => {
    setOpsSaving(true);
    setOpsMsg(null);
    try {
      await api.updateProductOperations(productId, {
        provider_id: editProviderId,
        pricing_strategy: editStrategy,
        pricing_params: editStrategy === "fixed" ? null : editParams,
        commission_rate: editCommission.trim() === "" ? null : Number(editCommission),
      });
      setOpsMsg({ type: "ok", text: "Đã lưu giá & nguồn hàng." });
      await refreshAfterMutation({ keepContent: contentDirty });
    } catch (e) {
      setOpsMsg({ type: "err", text: apiErrorMessage(e, "Lỗi khi lưu cấu hình") });
    } finally {
      setOpsSaving(false);
    }
  };

  if (loading) return <div className="py-16"><Spinner /></div>;
  if (loadError || !product || !ops) {
    return (
      <Card className="p-6">
        <p className="text-[13px] text-bad">{loadError ?? "Không tìm thấy sản phẩm"}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setLoading(true); void loadAll(); }}>Thử lại</Button>
          <Link href="/admin/products"><Button size="sm" variant="ghost">← Danh sách sản phẩm</Button></Link>
        </div>
      </Card>
    );
  }

  const st = statusMeta(product.status);
  const flatCats = flatten(cats);
  const categoryLabel = (id: number) => flatCats.find((c) => c.id === id)?.label;
  const buyerFulfillment = fulfillmentFromProduct(product);
  const term = termFor(product.service_type);
  const strategy = ops.pricing.strategy || "fixed";
  const sInfo = STRATEGY_INFO[strategy] ?? STRATEGY_INFO.fixed;
  const adapterType = ops.provider?.adapter_type ?? "seller_pool";
  const aInfo = ADAPTER_INFO[adapterType] ?? { label: adapterType, description: "" };
  const health = ops.provider?.health ?? "healthy";
  const healthTone = health === "healthy" ? "good" : health === "degraded" ? "warn" : "bad";
  const healthLabel = health === "healthy" ? "Khoẻ" : health === "degraded" ? "Chậm" : "Lỗi";
  const ready = !ops.needs_setup;
  const activeVariants = product.variants.filter((v) => v.is_active);
  const priceFrom = activeVariants.filter((v) => v.price > 0).reduce<number | null>((m, v) => (m == null || v.price < m ? v.price : m), null);
  const totalStock = product.variants.reduce((sum, v) => sum + (v.delivery_mode === "instant" ? v.stock_count ?? 0 : 0), 0);
  const hasInstant = product.variants.some((v) => v.delivery_mode === "instant");

  const pipeline: Record<string, { label: string; active: boolean }[]> = {
    fixed: buyerFulfillment.kind === "sla" ? [
      { label: tp("pipeline.pickVariant", { ...term }), active: true },
      { label: tp("pipeline.fixedPrice"), active: true },
      { label: tp("pipeline.waitSeller"), active: ready },
      { label: tp("pipeline.deliverSla"), active: ready },
    ] : [
      { label: tp("pipeline.pickVariant", { ...term }), active: true },
      { label: tp("pipeline.fixedPrice"), active: true },
      { label: tp("pipeline.takeFromStock"), active: ready },
      { label: tp("pipeline.deliverNow"), active: ready },
    ],
    config: [
      { label: tp("pipeline.configure"), active: true },
      { label: tp("pipeline.dynamicPrice"), active: true },
      { label: tp("pipeline.provisionNew"), active: ready },
      { label: tp("pipeline.deliverResource"), active: ready },
    ],
    credit: [
      { label: tp("pipeline.buyCredit"), active: true },
      { label: tp("pipeline.deductCredit"), active: true },
      { label: tp("pipeline.issueKey"), active: ready },
      { label: tp("pipeline.useByRequest"), active: ready },
    ],
    task: [
      { label: tp("pipeline.placeTask"), active: true },
      { label: tp("pipeline.priceByPlatform"), active: true },
      { label: tp("pipeline.sellerBackendAccepts"), active: ready },
      { label: tp("pipeline.callbackResult"), active: ready },
    ],
  };
  const pipelineSteps = pipeline[strategy] ?? pipeline.fixed;
  const selectedProvider = providers.find((p) => p.id === editProviderId);
  const providerIncompatible = selectedProvider != null && !isAdapterCompatible(selectedProvider.adapter_type, editStrategy, compatMatrix);
  const activity = activityQ.data ?? [];

  return (
    <div className="space-y-4 pb-4">
      {/* ══════════ Đầu trang ══════════ */}
      <div>
        <Link href="/admin/products" className="text-[12.5px] font-medium text-muted hover:text-fg">← Sản phẩm</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Monogram text={product.title} className="h-12 w-12 shrink-0 text-[15px]" />
            <div className="min-w-0">
              <h1 className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-fg sm:text-[24px]">{product.title}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Tag tone={st.tone}>{st.label}</Tag>
                <Tag tone={fulfillmentTone(buyerFulfillment.kind)}>{tp(fulfillmentTagKey(buyerFulfillment), fulfillmentTagValues(buyerFulfillment))}</Tag>
                {ops.needs_setup && <Tag tone="bad"><TriangleAlert size={11} /> Chưa bán được</Tag>}
                {ops.demo_mode && <Tag tone="iris">Dữ liệu demo</Tag>}
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted">
                <span className="font-mono">#{product.id}</span>
                <span className="text-faint"> · </span>
                {product.seller_email ?? "Chưa có người bán"}
                <span className="text-faint"> · </span>
                {product.category_name ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={productPath(product)} locale={contentLocale} target="_blank">
              <Button size="sm" variant="secondary"><ExternalLink size={13} /> Xem trên chợ</Button>
            </Link>
            <div ref={statusRef} className="relative">
              <Button size="sm" loading={statusBusy} onClick={() => setStatusOpen((v) => !v)} aria-haspopup="menu" aria-expanded={statusOpen}>
                Đổi trạng thái <ChevronDown size={14} />
              </Button>
              {statusOpen && (
                <div role="menu" className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-card-lg">
                  {statusActionsFor(product.status).map((a) => (
                    <button
                      key={a.action}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStatusOpen(false);
                        if (a.action === "suspend") setSuspendOpen(true);
                        else void changeStatus(a.action);
                      }}
                      className={cn("block w-full px-3 py-2 text-left text-[13px] hover:bg-raised", a.danger && "text-bad")}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {statusNotice && (
        <Banner tone={statusNotice.tone} action={<button type="button" aria-label="Đóng" onClick={() => setStatusNotice(null)}><X size={14} /></button>}>
          {statusNotice.text}
        </Banner>
      )}

      {/* ══════════ Tab ══════════ */}
      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Quản lý sản phẩm">
        {TABS.map((x) => {
          const on = tab === x.key;
          const dirtyDot = (x.key === "content" && contentDirty) || (x.key === "operations" && opsDirty);
          const warnDot = x.key === "operations" && ops.needs_setup;
          return (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(x.key)}
              className={cn("relative inline-flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-1 text-[13.5px] font-medium", on ? "text-fg" : "text-muted hover:text-fg")}
            >
              {x.label}
              {x.key === "history" && activity.length > 0 && <span className="text-[11.5px] tabular-nums text-faint">{activity.length}</span>}
              {dirtyDot && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Có thay đổi chưa lưu" />}
              {!dirtyDot && warnDot && <span className="h-1.5 w-1.5 rounded-full bg-bad" title="Cần thiết lập" />}
              {on && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-iris" />}
            </button>
          );
        })}
      </div>

      {/* ══════════ Tổng quan ══════════ */}
      {tab === "overview" && (
        <div className="space-y-4">
          {ops.needs_setup && (
            <Banner tone="bad" icon={<TriangleAlert size={15} />} title="Sản phẩm chưa bán được"
              action={<Button size="sm" variant="secondary" onClick={() => setTab("operations")}>Thiết lập ngay</Button>}>
              {ops.needs_setup_reason}
            </Banner>
          )}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Giá từ" value={priceFrom != null ? vnd(priceFrom) : "Theo cấu hình"} sub={`${activeVariants.length}/${product.variants.length} gói đang bật`} />
            <Metric label="Tồn kho" value={hasInstant ? totalStock : "Theo đơn"} tone={hasInstant && totalStock === 0 ? "bad" : undefined} sub={hasInstant ? "gói giao ngay" : "cấp hàng khi có đơn"} />
            <Metric label="Đơn hàng" value={ops.stats.total_orders} sub={`${product.sold_count} đã bán`} />
            <Metric label="Doanh thu" value={vnd(ops.stats.revenue)} />
            <Metric label="Thành công" value={`${(ops.stats.success_rate * 100).toFixed(1)}%`}
              tone={ops.stats.total_orders === 0 ? undefined : ops.stats.success_rate >= 0.95 ? "good" : ops.stats.success_rate >= 0.8 ? "warn" : "bad"}
              sub={`${ops.stats.disputes} khiếu nại`} />
            <Metric label="Đánh giá" value={product.rating_count > 0 ? `${(product.rating_avg ?? 0).toFixed(1)}★` : "—"} sub={`${product.rating_count} lượt`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4">
              <Section title="Gói bán" hint="Người bán quản lý gói, giá gói và kho hàng ở khu người bán.">
                {product.variants.length === 0 ? (
                  <p className="text-[13px] text-muted">Sản phẩm chưa có gói nào{strategy !== "fixed" ? " — giá tính theo cấu hình ở tab Giá & nguồn hàng." : "."}</p>
                ) : (
                  <div className="-mx-4 -my-4 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-[13px]">
                      <thead>
                        <tr className="border-b border-line bg-raised/40 text-left text-[12px] text-muted">
                          <th className="px-4 py-2 font-medium">Gói</th>
                          <th className="px-3 py-2 text-right font-medium">Giá</th>
                          <th className="px-3 py-2 font-medium">Bàn giao</th>
                          <th className="px-3 py-2 text-right font-medium">Tồn kho</th>
                          <th className="px-4 py-2 font-medium">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {product.variants.map((v) => (
                          <tr key={v.id} className={cn("border-b border-line/70 last:border-0", !v.is_active && "text-faint")}>
                            <td className="max-w-[260px] truncate px-4 py-2 font-medium">{v.name}{v.duration_days ? <span className="ml-1.5 text-[12px] font-normal text-faint">{v.duration_days} ngày</span> : null}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{vnd(v.price)}</td>
                            <td className="px-3 py-2 text-[12.5px]">{v.delivery_mode === "instant" ? "Giao ngay" : `Thủ công · ${v.sla_hours}h`}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {v.delivery_mode === "instant"
                                ? <span className={cn((v.stock_count ?? 0) === 0 && v.is_active && "text-bad")}>{v.stock_count ?? 0}</span>
                                : <span className="font-sans text-[12px] text-faint">—</span>}
                            </td>
                            <td className="px-4 py-2">{v.is_active ? <Tag tone="good">Đang bật</Tag> : <Tag>Đã tắt</Tag>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title="Luồng xử lý đơn" hint={ready ? "Đơn mới chạy đủ các bước dưới đây." : "Các bước mờ đang bị chặn cho tới khi thiết lập xong."}>
                <div className="flex flex-wrap items-center gap-2">
                  {pipelineSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={cn("rounded-lg border px-3 py-1.5 text-[12px] font-medium", step.active ? "border-iris/30 bg-iris/10 text-iris" : "border-line bg-raised text-muted line-through decoration-muted/50")}>
                        {step.label}
                      </span>
                      {i < pipelineSteps.length - 1 && <ArrowRight size={12} className="text-faint" />}
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            <div className="min-w-0 space-y-4">
              <Section title="Thông tin">
                <dl className="-my-2 divide-y divide-line/70">
                  <InfoRow label="Người bán">{product.seller_email ?? "—"}</InfoRow>
                  <InfoRow label="Danh mục">{categoryLabel(product.category_id) ?? product.category_name ?? "—"}</InfoRow>
                  <InfoRow label="Loại dịch vụ">{SERVICE_LABELS[product.service_type ?? "other"] ?? product.service_type}</InfoRow>
                  <InfoRow label="Ký quỹ">{product.escrow_days} ngày</InfoRow>
                  <InfoRow label="Nguồn hàng">
                    <span className="inline-flex items-center gap-1.5">
                      {ops.provider && <span className={cn("h-2 w-2 rounded-full", healthTone === "good" ? "bg-good" : healthTone === "warn" ? "bg-warn" : "bg-bad")} title={healthLabel} />}
                      {ops.provider?.name ?? "Kho người bán"}
                    </span>
                  </InfoRow>
                  <InfoRow label="Chiến lược giá">{sInfo.label}</InfoRow>
                  <InfoRow label="Hoa hồng affiliate">{product.commission_rate != null ? `${product.commission_rate}%` : "Kế thừa"}</InfoRow>
                  <InfoRow label="Tạo lúc">{fmtDateTime(product.created_at)}</InfoRow>
                </dl>
              </Section>

              <Section title="Thao tác gần đây" action={activity.length > 0 ? (
                <button type="button" onClick={() => setTab("history")} className="text-[12.5px] font-medium text-iris hover:underline">Xem tất cả</button>
              ) : undefined}>
                {activityQ.isLoading ? (
                  <div className="h-10 animate-pulse rounded bg-raised" />
                ) : activity.length === 0 ? (
                  <p className="text-[13px] text-muted">Chưa có thao tác admin nào được ghi.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {activity.slice(0, 3).map((entry) => {
                      const d = describeActivity(entry, categoryLabel);
                      return (
                        <li key={entry.id} className="text-[12.5px]">
                          <p className="font-medium text-fg">{d.title}{d.detail && <span className="font-normal text-muted"> · {d.detail}</span>}</p>
                          <p className="text-[11.5px] text-faint">{entry.actor_email ?? "Hệ thống"} · {fmtDateTime(entry.created_at)}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ Nội dung ══════════ */}
      {tab === "content" && (
        <div className="space-y-4">
          <ProductLanguageRail
            interfaceLocale={interfaceLocale}
            activeLocale={contentLocale}
            translations={product.translations}
            requiredFields={{
              specs: Boolean(product.specs),
              pricingLabels: { vi: Boolean(product.pricing_params) && !hasPlanTable(product.pricing_params), en: Boolean(product.pricing_params) },
            }}
            dirty={contentDirty}
            onChange={changeContentLocale}
          />
          {contentMsg?.type === "ok" && !contentDirty && <Banner tone="good">{contentMsg.text}</Banner>}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4">
              <Section title={`Nội dung khách thấy · ${productLanguageName(contentLocale, interfaceLocale)}`} hint={t("customerContentHint", { language: contentLocale.toUpperCase() })}>
                <div className="space-y-4">
                  <Field label={t("productName")}>
                    <Input value={content.title} onChange={(e) => { setContent({ ...content, title: e.target.value }); markContent(); }} />
                  </Field>
                  <Field label={t("highlightLabel")} hint="Một dòng ngắn hiện dưới tên sản phẩm trên chợ.">
                    <Input value={content.highlight_text} onChange={(e) => { setContent({ ...content, highlight_text: e.target.value }); markContent(); }} />
                  </Field>
                  <Field label={t("descriptionLabel")}>
                    <MarkdownEditor
                      value={content.description}
                      onChange={(value) => { setContent({ ...content, description: value }); markContent(); }}
                      placeholder={contentLocale === "en" ? "Describe the product, delivery, and intended use." : "VD: **Tài khoản Facebook uy tín**, tạo hơn 2 tháng tuổi."}
                    />
                  </Field>
                  <ListEditor
                    label={t("featuresLabel")}
                    items={features}
                    addLabel={t("addFeature")}
                    emptyText={t("noFeatures")}
                    onAdd={() => { setFeatures([...features, ""]); markContent(); }}
                    onRemove={(index) => { setFeatures(features.filter((_, i) => i !== index)); markContent(); }}
                    renderRow={(feature, index) => (
                      <Input
                        aria-label={`Tính năng ${index + 1}`}
                        value={feature}
                        placeholder={contentLocale === "en" ? "Example: 24/7 technical support" : "VD: Bảo hành 24h nếu login lỗi"}
                        onChange={(event) => { const next = [...features]; next[index] = event.target.value; setFeatures(next); markContent(); }}
                      />
                    )}
                  />
                  <ListEditor
                    label={`${t("specsLabel")} · ${contentLocale.toUpperCase()}`}
                    items={specs}
                    addLabel={t("addSpec")}
                    emptyText={t("noSpecs")}
                    onAdd={() => { setSpecs([...specs, { key: "", value: "" }]); markContent(); }}
                    onRemove={(index) => { setSpecs(specs.filter((_, i) => i !== index)); markContent(); }}
                    renderRow={(s, i) => (
                      <div className="flex items-center gap-2">
                        <Input aria-label={`Tên thông số ${i + 1}`} value={s.key} placeholder={t("specNamePlaceholder")}
                          onChange={(e) => { const next = [...specs]; next[i] = { ...next[i], key: e.target.value }; setSpecs(next); markContent(); }} />
                        <Input aria-label={`Giá trị thông số ${i + 1}`} value={s.value} placeholder={t("specValuePlaceholder")}
                          onChange={(e) => { const next = [...specs]; next[i] = { ...next[i], value: e.target.value }; setSpecs(next); markContent(); }} />
                      </div>
                    )}
                  />
                  <ProductPricingLabelsEditor locale={contentLocale} params={product.pricing_params} value={pricingLabels} onChange={setPricingLabels} onDirty={markContent} onOpenPriceGrid={() => setTab("operations")} />
                  <Field label={t("warrantyLabel")}>
                    <Textarea rows={3} value={content.warranty_text} onChange={(e) => { setContent({ ...content, warranty_text: e.target.value }); markContent(); }} />
                  </Field>
                </div>
              </Section>

              <Section title={t("commonInfo")} hint={t("appliesBothLanguages")}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t("productCategory")}>
                    <Select value={content.category_id} onChange={(e) => { setContent({ ...content, category_id: Number(e.target.value) }); markContent(); }}>
                      {flatCats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("serviceType")}>
                    <Select value={content.service_type} onChange={(e) => { setContent({ ...content, service_type: e.target.value }); markContent(); }}>
                      {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("escrowDaysLabel")}>
                    <Input type="number" min={1} value={content.escrow_days} onChange={(e) => { setContent({ ...content, escrow_days: Number(e.target.value) || 1 }); markContent(); }} />
                  </Field>
                </div>
                <p className="mt-3 text-[12px] text-muted">Trạng thái bán đổi bằng nút “Đổi trạng thái” ở đầu trang — mỗi lần đổi được ghi vào Lịch sử.</p>
              </Section>
            </div>
            <div className="xl:sticky xl:top-20">
              <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-muted">Xem trước trên chợ</p>
              <ProductPreviewCard
                title={content.title}
                categoryName={flatCats.find((c) => c.id === content.category_id)?.label}
                serviceType={content.service_type}
                status={product.status}
                escrowDays={content.escrow_days}
                highlightText={content.highlight_text}
                description={content.description}
                features={features}
                specs={specs}
                warrantyText={content.warranty_text}
                variants={product.variants}
                coverId={product.cover_id}
              />
            </div>
          </div>
          {contentDirty && (
            <SaveBar
              label={`Bản ${productLanguageName(contentLocale, interfaceLocale)} có thay đổi chưa lưu`}
              saving={contentSaving}
              message={contentMsg}
              onSave={saveContent}
              onDiscard={() => { applyContent(product, contentLocale); setContentDirty(false); setContentMsg(null); }}
            />
          )}
        </div>
      )}

      {/* ══════════ Giá & nguồn hàng ══════════ */}
      {tab === "operations" && (
        <div className="space-y-4">
          {ops.needs_setup && (
            <Banner tone="bad" icon={<TriangleAlert size={15} />} title="Sản phẩm chưa bán được">{ops.needs_setup_reason}</Banner>
          )}
          {opsMsg?.type === "ok" && !opsDirty && <Banner tone="good">{opsMsg.text}</Banner>}

          <Section title="1. Chiến lược giá" hint="Cách hệ thống tính số tiền buyer trả.">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(STRATEGY_INFO).map(([key, info]) => {
                const on = editStrategy === key;
                return (
                  <button key={key} type="button"
                    onClick={() => { setEditStrategy(key); if (key === "fixed") setEditParams({}); markOps(); }}
                    aria-pressed={on}
                    className={cn("rounded-lg border p-3 text-left transition-colors", on ? "border-iris bg-iris/5 ring-1 ring-iris/30" : "border-line bg-raised hover:border-line-2")}>
                    <span className="flex items-center gap-2">
                      <span className={cn("h-3 w-3 rounded-full border-2", on ? "border-iris bg-iris" : "border-muted")} />
                      <span className="text-[13px] font-semibold">{info.label}</span>
                      {key === strategy && <Tag>Đang dùng</Tag>}
                    </span>
                    <span className="ml-5 mt-1 block text-[12px] text-muted">{info.description}</span>
                    <span className="ml-5 mt-1 block font-mono text-[11px] text-faint">{STRATEGY_FORMULAS[key]}</span>
                  </button>
                );
              })}
            </div>
            {editStrategy !== "fixed" ? (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <p className="text-[12.5px] font-medium text-muted">Tham số chiến lược</p>
                {editStrategy === "config" && isGridParams(editParams) ? (
                  <PricingGridEditor
                    productId={productId}
                    adapter={ops.provider?.adapter_type ?? null}
                    costSourceStale={editProviderId !== (ops.provider?.id ?? null)}
                    params={editParams}
                    labelOverlays={labelOverlays}
                    onChange={(p) => { setEditParams(p); markOps(); }}
                  />
                ) : (
                  <PricingParamsEditor strategy={editStrategy} params={editParams} onChange={(p) => { setEditParams(p); markOps(); }} />
                )}
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-raised px-4 py-3 text-[13px] text-muted">Giá lấy từ từng gói do người bán đặt — không cần cấu hình thêm.</p>
            )}
          </Section>

          <Section title="2. Nguồn hàng" hint="Nơi hệ thống lấy hàng để giao cho buyer.">
            <div className="space-y-3">
              <Field label="Nhà cung cấp" hint="Nguồn không tương thích với chiến lược giá đã chọn bị vô hiệu hoá.">
                <Select value={editProviderId ?? ""} onChange={(e) => { setEditProviderId(e.target.value ? Number(e.target.value) : null); markOps(); }}>
                  <option value="">— Kho người bán (không gán API) —</option>
                  {providers.map((p) => {
                    const compatible = isAdapterCompatible(p.adapter_type, editStrategy, compatMatrix);
                    return (
                      <option key={p.id} value={p.id} disabled={!compatible}>
                        {ADAPTER_INFO[p.adapter_type]?.label ?? p.adapter_type} — {p.name}{!p.is_active ? " (đã tắt)" : ""}{!compatible ? " — không tương thích" : ""}
                      </option>
                    );
                  })}
                </Select>
              </Field>
              {providerIncompatible && (
                <Banner tone="bad">Nguồn “{selectedProvider?.name}” không tương thích với chiến lược “{STRATEGY_INFO[editStrategy]?.label ?? editStrategy}” — lưu sẽ bị từ chối.</Banner>
              )}
              {ops.provider && (
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-muted">Đang dùng:</span>
                  <span className="font-medium">{ops.provider.name}</span>
                  <Tag tone="iris">{aInfo.label}</Tag>
                  <Tag tone={healthTone}>{healthLabel}</Tag>
                </div>
              )}
              {adapterType === "mock" && (
                <Banner tone="warn">Sản phẩm đang dùng dữ liệu demo. Khi kết nối API thật, dữ liệu sẽ tự chuyển sang nguồn thật.</Banner>
              )}
            </div>
          </Section>

          <Section title="3. Hoa hồng affiliate" hint="Chi cho affiliate khi đơn của sản phẩm này hoàn tất, trừ vào quỹ affiliate.">
            <div className="max-w-xs">
              <Field label="Tỷ lệ hoa hồng (%)" hint="Để trống để kế thừa từ danh mục / mặc định hệ thống.">
                <Input type="number" min={0} max={100} step="0.1" value={editCommission} placeholder="Kế thừa"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) { setEditCommission(v); markOps(); }
                  }} />
              </Field>
            </div>
          </Section>

          {opsDirty && (
            <SaveBar
              label="Cấu hình giá & nguồn hàng có thay đổi chưa lưu"
              saving={opsSaving}
              message={opsMsg}
              onSave={saveOps}
              onDiscard={() => { applyOps(product, ops); setOpsDirty(false); setOpsMsg(null); }}
            />
          )}
        </div>
      )}

      {/* ══════════ Đánh giá ══════════ */}
      {tab === "reviews" && (
        <div className="space-y-6">
          <section className="space-y-3" aria-labelledby="reviews-heading">
            <div>
              <h2 id="reviews-heading" className="text-[14px] font-semibold text-fg">Đánh giá của khách</h2>
              <p className="mt-0.5 text-[12px] text-muted">Ẩn đánh giá vi phạm khỏi trang mua — tiền và đơn hàng không bị ảnh hưởng; có thể hiện lại bất kỳ lúc nào.</p>
            </div>
            <AdminReviewsPanel productId={product.id} />
          </section>
          <section className="space-y-3" aria-labelledby="trust-seed-heading">
            <div>
              <h2 id="trust-seed-heading" className="text-[14px] font-semibold text-fg">Đánh giá mồi</h2>
              <p className="mt-0.5 text-[12px] text-muted">Đánh giá demo cho sản phẩm mới. Được đánh dấu riêng, không tính vào doanh thu hay tỷ lệ khiếu nại, và xoá lại được toàn bộ.</p>
            </div>
            <TrustSeedPanel productId={product.id} />
          </section>
        </div>
      )}

      {/* ══════════ Lịch sử ══════════ */}
      {tab === "history" && (
        <Section title="Lịch sử thao tác admin" hint="Đổi trạng thái, danh mục và nội dung do admin thực hiện trên sản phẩm này.">
          {activityQ.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-raised" />)}</div>
          ) : activityQ.isError ? (
            <div className="text-[13px] text-bad">
              Không tải được lịch sử. <button type="button" className="font-medium underline" onClick={() => activityQ.refetch()}>Thử lại</button>
            </div>
          ) : activity.length === 0 ? (
            <p className="text-[13px] text-muted">Chưa có thao tác nào. Các thay đổi từ giờ trở đi sẽ hiện ở đây.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {activity.map((entry) => {
                const d = describeActivity(entry, categoryLabel);
                return (
                  <li key={entry.id} className="relative">
                    <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-iris" />
                    <p className="text-[13px] font-medium text-fg">{d.title}</p>
                    {d.detail && <p className="mt-0.5 text-[12.5px] text-muted">{d.detail}</p>}
                    <p className="mt-0.5 text-[11.5px] text-faint">{entry.actor_email ?? "Hệ thống"} · {fmtDateTime(entry.created_at)}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      )}

      <ConfirmModal
        isOpen={suspendOpen}
        onClose={() => { setSuspendOpen(false); setSuspendReason(""); }}
        onConfirm={() => void changeStatus("suspend", suspendReason.trim() || undefined)}
        title="Khoá sản phẩm này?"
        description="Sản phẩm biến mất khỏi chợ và người bán không tự mở lại được. Đơn đang chạy không bị ảnh hưởng."
        confirmText="Khoá sản phẩm"
        variant="danger"
        isLoading={statusBusy}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted">Lý do (ghi vào lịch sử)</span>
          <textarea value={suspendReason} maxLength={500} rows={2} onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="VD: Bán tài khoản vi phạm chính sách"
            className="rounded-lg border border-line-2 bg-surface px-3 py-2 text-[13px] outline-none focus:border-iris" />
        </label>
      </ConfirmModal>
    </div>
  );
}
