"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { AdminProductDetail as AdminProductDetailData, Category, ProductOperations, Provider } from "@/lib/types";
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

const STATUS_MAP: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  active: { label: "Đang bán", tone: "good" },
  draft: { label: "Nháp", tone: "neutral" },
  paused: { label: "Tạm dừng", tone: "warn" },
  suspended: { label: "Bị khoá", tone: "bad" },
};

export default function AdminProductDetail() {
  const { id } = useParams<{ id: string }>();
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
  const [savingContent, setSavingContent] = useState(false);
  const [contentMsg, setContentMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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
      setContent({
        title: p.title,
        category_id: p.category_id,
        service_type: p.service_type ?? "other",
        status: p.status,
        escrow_days: p.escrow_days,
        highlight_text: p.highlight_text ?? "",
        description: p.description ?? "",
        warranty_text: p.warranty_text ?? "",
      });
      setFeatures(p.features ?? []);
      setSpecs(p.specs ? Object.entries(p.specs).map(([k, v]) => ({ key: k, value: String(v) })) : []);
    } catch {
      setError("Không tải được sản phẩm");
    } finally {
      setLoading(false);
    }
  };

  const saveContent = async () => {
    setSavingContent(true); setContentMsg(null);
    try {
      const featureList = features.map((f) => f.trim()).filter(Boolean);
      const specsEntries = specs.filter((s) => s.key.trim());
      const specsObj = specsEntries.length > 0
        ? Object.fromEntries(specsEntries.map((s) => [s.key.trim(), s.value.trim()]))
        : undefined;
      await api.adminUpdateProduct(Number(id), {
        title: content.title.trim(),
        category_id: content.category_id,
        service_type: content.service_type,
        status: content.status,
        escrow_days: content.escrow_days,
        highlight_text: content.highlight_text.trim() || null,
        description: content.description.trim() || null,
        features: featureList.length > 0 ? featureList : null,
        specs: specsObj ?? null,
        warranty_text: content.warranty_text.trim() || null,
      });
      setContentMsg({ type: "ok", text: "Đã lưu nội dung!" });
      setEditingContent(false);
      await loadAll();
    } catch (e) {
      setContentMsg({ type: "err", text: e instanceof Error ? e.message : "Lỗi khi lưu" });
    } finally {
      setSavingContent(false);
    }
  };

  useEffect(() => { loadAll(); }, [id]);

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

  const st = STATUS_MAP[product.status] ?? { label: product.status, tone: "neutral" as const };
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
  const cleanFeatures = (product.features ?? []).filter((f) => f.trim());
  const cleanSpecs = product.specs ? Object.entries(product.specs).filter(([k]) => k.trim()) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/products" className="text-[12px] text-muted hover:text-primary transition-colors">
            ← Danh sách sản phẩm
          </Link>
          <h2 className="text-[18px] font-semibold mt-1">{product.title}</h2>
        </div>
        <Link href={`/products/${id}`}>
          <Button size="sm" variant="secondary"><Eye size={14} /> Xem trang mua</Button>

        </Link>
      </div>

      {/* Section 1: Thong tin san pham (admin editable: content + status) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold flex items-center gap-2">
            <Info size={14} /> Thông tin sản phẩm
          </h3>
          {!editingContent ? (
            <Button size="sm" variant="secondary" onClick={() => setEditingContent(true)}><Edit2 size={13} /> Sửa</Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={savingContent} onClick={saveContent}>{savingContent ? "Đang lưu…" : "Lưu"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingContent(false); loadAll(); }}>Huỷ</Button>
            </div>
          )}
        </div>

        {!editingContent ? (
          <Card className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-[11px] text-faint font-medium">Trạng thái</div>
                <div className="mt-1"><Tag tone={st.tone}>{st.label}</Tag></div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">Loại dịch vụ</div>
                <div className="text-[13px] font-medium mt-1">{SERVICE_LABELS[product.service_type ?? "other"] ?? product.service_type}</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">Danh mục</div>
                <div className="text-[13px] font-medium mt-1">{product.category_name ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">Seller</div>
                <div className="text-[13px] font-medium mt-1">{product.seller_email ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">Ký quỹ</div>
                <div className="text-[13px] font-medium mt-1">{product.escrow_days} ngày</div>
              </div>
              <div>
                <div className="text-[11px] text-faint font-medium">Biến thể</div>
                <div className="text-[13px] font-medium mt-1">{product.variants.length} biến thể</div>
              </div>
            </div>
            {product.highlight_text && (
              <div>
                <div className="text-[11px] text-faint font-medium">Dòng nổi bật</div>
                <div className="text-[13px] text-muted mt-1">{product.highlight_text}</div>
              </div>
            )}
            {product.description && (
              <div>
                <div className="text-[11px] text-faint font-medium mb-1">Mô tả</div>
                <MarkdownContent>{product.description}</MarkdownContent>
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
                <div className="text-[11px] text-faint font-medium mb-1.5">Thông số kỹ thuật</div>
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
            {product.warranty_text && (
              <div>
                <div className="text-[11px] text-faint font-medium mb-1">Bảo hành</div>
                <p className="text-[13px] text-muted whitespace-pre-wrap">{product.warranty_text}</p>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px] items-start">
            <Card className="p-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tên sản phẩm"><Input value={content.title} onChange={(e) => setContent({ ...content, title: e.target.value })} /></Field>
                <Field label="Danh mục">
                  <Select value={content.category_id} onChange={(e) => setContent({ ...content, category_id: Number(e.target.value) })}>
                    {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Loại dịch vụ">
                  <Select value={content.service_type} onChange={(e) => setContent({ ...content, service_type: e.target.value })}>
                    {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Ký quỹ (ngày)"><Input type="number" min={1} value={content.escrow_days} onChange={(e) => setContent({ ...content, escrow_days: Number(e.target.value) || 1 })} /></Field>
                <Field label="Trạng thái">
                  <Select value={content.status} onChange={(e) => setContent({ ...content, status: e.target.value })}>
                    <option value="active">Đang bán</option>
                    <option value="draft">Nháp</option>
                    <option value="paused">Tạm dừng</option>
                    <option value="suspended">Bị khoá</option>
                  </Select>
                </Field>
              </div>
              <Field label="Dòng nổi bật"><Input value={content.highlight_text} onChange={(e) => setContent({ ...content, highlight_text: e.target.value })} /></Field>
              <Field label="Mô tả">
                <MarkdownEditor
                  value={content.description}
                  onChange={(v) => setContent({ ...content, description: v })}
                  placeholder="VD: **Tài khoản Facebook uy tín**, tạo hơn 2 tháng tuổi."
                />
              </Field>
              <ListEditor
                label="Tính năng"
                items={features}
                addLabel="Thêm tính năng"
                emptyText="Chưa có tính năng nào."
                onAdd={() => setFeatures([...features, ""])}
                onRemove={(i) => setFeatures(features.filter((_, idx) => idx !== i))}
                renderRow={(f, i) => (
                  <Input
                    aria-label={`Tính năng ${i + 1}`}
                    value={f}
                    placeholder="VD: Bảo hành 24h nếu login lỗi"
                    onChange={(e) => {
                      const next = [...features]; next[i] = e.target.value;
                      setFeatures(next);
                    }}
                  />
                )}
              />
              <ListEditor
                label="Thông số kỹ thuật"
                items={specs}
                addLabel="Thêm thông số"
                emptyText="Chưa có thông số nào."
                onAdd={() => setSpecs([...specs, { key: "", value: "" }])}
                onRemove={(i) => setSpecs(specs.filter((_, idx) => idx !== i))}
                renderRow={(s, i) => (
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Tên thông số ${i + 1}`}
                      value={s.key}
                      placeholder="Tên (VD: Xuất xứ)"
                      onChange={(e) => {
                        const next = [...specs]; next[i] = { ...next[i], key: e.target.value };
                        setSpecs(next);
                      }}
                    />
                    <Input
                      aria-label={`Giá trị thông số ${i + 1}`}
                      value={s.value}
                      placeholder="Giá trị (VD: Việt Nam)"
                      onChange={(e) => {
                        const next = [...specs]; next[i] = { ...next[i], value: e.target.value };
                        setSpecs(next);
                      }}
                    />
                  </div>
                )}
              />
              <Field label="Chính sách bảo hành"><Textarea rows={3} value={content.warranty_text} onChange={(e) => setContent({ ...content, warranty_text: e.target.value })} /></Field>
              <p className="text-[12px] text-muted">Admin sửa nội dung/trạng thái trên sản phẩm của bất kỳ seller. Biến thể & kho vẫn do seller quản lý.</p>
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
