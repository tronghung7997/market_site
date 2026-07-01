"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Category, ProductDetail, ProductOperations, Provider, Resource, Variant } from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { Activity, ArrowRight, Bolt, Check, Clock, Edit2, Eye, Info, Package, Plus, Sliders, Trash, Users } from "@/components/Icons";

const SERVICE_TYPES = [
  { value: "account", label: "Tài khoản" },
  { value: "proxy", label: "Proxy" },
  { value: "token", label: "Token" },
  { value: "endpoint", label: "Endpoint" },
  { value: "cloud", label: "Cloud" },
  { value: "payment", label: "Thanh toán" },
  { value: "takedown", label: "Takedown" },
  { value: "other", label: "Khác" },
];

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (l: Category[]) => l.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}

const TABS = [
  { key: "info", label: "Thông tin", icon: Edit2 },
  { key: "variants", label: "Biến thể", icon: Package },
  { key: "operations", label: "Vận hành", icon: Activity },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const STRATEGY_INFO: Record<string, { label: string; description: string; pipelineLabel: string }> = {
  fixed: { label: "Cố định", description: "Giá set trên mỗi biến thể. Khách chọn biến thể + số lượng.", pipelineLabel: "Cố định" },
  config: { label: "Cấu hình", description: "Giá tính dynamic theo tuỳ chọn khách chọn (loại, mạng, thời hạn).", pipelineLabel: "Dynamic" },
  credit: { label: "Credit", description: "Khách mua gói credit (số request). Mỗi request trừ credit.", pipelineLabel: "Credit" },
  task: { label: "Tác vụ", description: "Giá theo nền tảng và số URL. Team xử lý thủ công.", pipelineLabel: "Tác vụ" },
};

const ADAPTER_INFO: Record<string, { label: string; description: string }> = {
  seller_pool: { label: "Seller Pool", description: "Lấy từ kho hàng bạn upload" },
  mock: { label: "Demo", description: "Dữ liệu giả, chưa kết nối API thật" },
  manual: { label: "Thủ công", description: "Team xử lý và giao hàng thủ công" },
  topproxy: { label: "TopProxy API", description: "Cấp phát tự động qua TopProxy" },
  scrapecreators: { label: "ScrapCreators API", description: "Cấp phát tự động qua ScrapCreators" },
};

const STRATEGY_FORMULAS: Record<string, string> = {
  fixed: "Giá = variant.price x quantity",
  config: "Giá = base_price x type_mult x network_mult x (days / 30) x quantity",
  credit: "Giá = credit_price x package_size",
  task: "Giá = base_price x platform_mult x quantity (số URL)",
};

function formatParamValue(val: unknown): string {
  if (typeof val === "number") return vnd(val);
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map((v) => typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)).join(", ");
  if (typeof val === "object" && val !== null) {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "number" ? (v < 10 ? `x${v}` : vnd(v)) : v}`)
      .join(" | ");
  }
  return String(val);
}

const PARAM_LABELS: Record<string, string> = {
  base_price: "Giá cơ bản",
  credit_price: "Giá mỗi credit",
  type_mult: "Hệ số loại",
  network_mult: "Hệ số mạng",
  platform_mult: "Hệ số nền tảng",
  duration_options: "Tuỳ chọn thời hạn",
  packages: "Gói credit",
  volume_tiers: "Giảm giá theo SL",
};

export default function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("info");

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [serviceType, setServiceType] = useState("other");
  const [description, setDescription] = useState("");
  const [highlightText, setHighlightText] = useState("");
  const [escrowDays, setEscrowDays] = useState(3);
  const [features, setFeatures] = useState("");
  const [warrantyText, setWarrantyText] = useState("");
  const [specs, setSpecs] = useState("");
  const [status, setStatus] = useState("active");
  const [commissionRate, setCommissionRate] = useState("");

  const loadProduct = async () => {
    try {
      const [p, c] = await Promise.all([api.product(Number(id)), api.categories()]);
      setProduct(p);
      setCats(c);
      setTitle(p.title);
      setCategoryId(p.category_id);
      setServiceType(p.service_type ?? "other");
      setDescription(p.description ?? "");
      setHighlightText(p.highlight_text ?? "");
      setEscrowDays(p.escrow_days);
      setFeatures((p.features ?? []).join("\n"));
      setWarrantyText(p.warranty_text ?? "");
      setSpecs(p.specs ? Object.entries(p.specs).map(([k, v]) => `${k}: ${v}`).join("\n") : "");
      setStatus(p.status);
      setCommissionRate(p.commission_rate != null ? String(p.commission_rate) : "");
    } catch {
      setError("Không tải được sản phẩm");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProduct(); }, [id]);

  const save = async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const featureList = features.split("\n").map((f) => f.trim()).filter(Boolean);
      let specsObj: Record<string, string> | undefined;
      if (specs.trim()) {
        specsObj = {};
        for (const line of specs.split("\n")) {
          const idx = line.indexOf(":");
          if (idx > 0) specsObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      await api.updateProduct(Number(id), {
        title: title.trim(),
        category_id: categoryId,
        service_type: serviceType,
        description: description.trim() || null,
        highlight_text: highlightText.trim() || null,
        escrow_days: escrowDays,
        features: featureList.length > 0 ? featureList : null,
        warranty_text: warrantyText.trim() || null,
        specs: specsObj ?? null,
        status,
        ...(commissionRate.trim() !== "" ? { commission_rate: Number(commissionRate) } : {}),
      });
      setSuccess("Đã lưu thành công!");
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
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Chỉnh sửa sản phẩm</h2>
        <Link href={`/products/${id}`}><Button size="sm" variant="secondary"><Eye size={14} /> Xem trang mua</Button></Link>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${tab === t.key ? "border-iris text-iris" : "border-transparent text-muted hover:text-primary"}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab: Thong tin */}
      {tab === "info" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] items-start">
          <Card className="p-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Tên sản phẩm">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Danh mục">
                <Select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                  {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Loại dịch vụ">
                <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                  {SERVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Ký quỹ (ngày)">
                <Input type="number" min={1} value={escrowDays} onChange={(e) => setEscrowDays(Number(e.target.value) || 3)} />
              </Field>
              <Field label="Trạng thái">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Đang bán</option>
                  <option value="draft">Nháp</option>
                  <option value="paused">Tạm dừng</option>
                </Select>
              </Field>
            </div>

            <Field label="Hoa hồng affiliate (%)" hint="Để trống để kế thừa từ danh mục">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={commissionRate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) setCommissionRate(v);
                }}
                placeholder="VD: 5"
              />
              {commissionRate.trim() !== "" && (Number(commissionRate) < 0 || Number(commissionRate) > 100) && (
                <p className="text-bad text-[12px] mt-1">Giá trị phải từ 0 đến 100</p>
              )}
            </Field>

            <Field label="Dòng nổi bật">
              <Input value={highlightText} onChange={(e) => setHighlightText(e.target.value)} />
            </Field>

            <Field label="Mô tả">
              <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>

            <Field label="Tính năng" hint="Mỗi dòng một tính năng">
              <Textarea rows={4} value={features} onChange={(e) => setFeatures(e.target.value)} />
            </Field>

            <Field label="Thông số kỹ thuật" hint="key: value">
              <Textarea rows={4} value={specs} onChange={(e) => setSpecs(e.target.value)} />
            </Field>

            <Field label="Chính sách bảo hành">
              <Textarea rows={3} value={warrantyText} onChange={(e) => setWarrantyText(e.target.value)} />
            </Field>

            {error && <p className="text-bad text-[13px]">{error}</p>}
            {success && <p className="text-good text-[13px]">{success}</p>}

            <Button size="lg" disabled={saving} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </Card>

          <div>
            <VariantManager productId={Number(id)} variants={product.variants} onRefresh={loadProduct} />
          </div>
        </div>
      )}

      {/* Tab: Bien the */}
      {tab === "variants" && (
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

/* ── Operations Tab ─────────────────────────────────────────────── */

function OperationsTab({ productId }: { productId: number }) {
  const { account } = useAuth();
  const isAdmin = account?.roles?.includes("admin") ?? false;

  const [ops, setOps] = useState<ProductOperations | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
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
        const pList = await api.providers();
        setProviders(pList);
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
      await api.updateProductOperations(productId, {
        provider_id: editProviderId,
        pricing_strategy: editStrategy,
        pricing_params: editStrategy === "fixed" ? null : editParams,
      });
      setSaveMsg({ type: "ok", text: "Đã lưu cấu hình vận hành!" });
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

  const pipelineMap: Record<string, { label: string; active: boolean }[]> = {
    fixed: [
      { label: "Khách chọn variant", active: true },
      { label: "Tính giá cố định", active: true },
      { label: `Lấy từ kho (${aInfo.label})`, active: true },
      { label: "Giao data", active: true },
    ],
    config: [
      { label: "Khách cấu hình", active: true },
      { label: "Tính giá dynamic", active: true },
      { label: `${aInfo.label} tạo mới`, active: true },
      { label: "Giao tài nguyên", active: true },
    ],
    credit: [
      { label: "Khách mua gói credit", active: true },
      { label: "Trừ credit", active: true },
      { label: `${aInfo.label} cấp API key`, active: true },
      { label: "Dùng theo request", active: true },
    ],
    task: [
      { label: "Khách đặt tác vụ", active: true },
      { label: "Tính giá theo nền tảng", active: true },
      { label: `${aInfo.label} nhận task`, active: true },
      { label: "Team xử lý → giao kết quả", active: true },
    ],
  };
  const pipelineSteps = pipelineMap[strategy] ?? pipelineMap.fixed;

  const displayParams = Object.entries(ops.pricing.params ?? {}).filter(
    ([k]) => k !== "strategy" && k !== "fields"
  );

  return (
    <div className="space-y-6 max-w-[800px]">
      {/* Section 1: Pipeline */}
      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <ArrowRight size={14} /> Pipeline bàn giao
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {pipelineSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`px-3 py-2 rounded-lg text-[12px] font-medium border ${step.active ? "bg-iris/10 border-iris/30 text-iris" : "bg-surface-2 border-line text-muted"}`}>
                {step.label}
              </div>
              {i < pipelineSteps.length - 1 && <ArrowRight size={12} className="text-faint" />}
            </div>
          ))}
        </div>
      </Card>

      {/* Section 2: Chiến lược giá */}
      <Card className="p-5 space-y-4">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Sliders size={14} /> Chiến lược giá
        </h3>

        {isAdmin ? (
          <>
            {/* Strategy cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(STRATEGY_INFO).map(([key, info]) => (
                <button key={key} onClick={() => { setEditStrategy(key); if (key === "fixed") setEditParams({}); markDirty(); }}
                  className={`text-left rounded-lg border p-3 transition-all ${editStrategy === key ? "border-iris bg-iris/5 ring-1 ring-iris/30" : "border-line bg-surface-2 hover:border-muted"}`}>
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
                <AdminPricingParamsEditor strategy={editStrategy} params={editParams} onChange={(p) => { setEditParams(p); markDirty(); }} />
              </div>
            )}
            {editStrategy === "fixed" && (
              <div className="bg-surface-2 rounded-lg px-4 py-3 text-[13px] text-muted">
                Giá cố định theo variant — không cần cấu hình thêm.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Tag tone="iris">{sInfo.label}</Tag>
              <span className="text-[13px] text-muted">{sInfo.description}</span>
            </div>
            <div className="bg-surface-2 rounded-lg px-4 py-2.5 text-[12px] font-mono text-muted">
              {STRATEGY_FORMULAS[strategy] ?? STRATEGY_FORMULAS.fixed}
            </div>
            {displayParams.length > 0 && (
              <div className="space-y-2">
                <div className="text-[12px] font-medium text-muted">Tham số hiện tại</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {displayParams.map(([key, val]) => (
                    <div key={key} className="bg-surface-2 rounded-lg px-3 py-2">
                      <div className="text-[11px] text-faint">{PARAM_LABELS[key] ?? key}</div>
                      <div className="text-[13px] font-medium mt-0.5">{formatParamValue(val)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Section 3: Nhà cung cấp */}
      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Users size={14} /> Nhà cung cấp
        </h3>

        {isAdmin ? (
          <div className="space-y-3">
            <Field label="Chọn nhà cung cấp">
              <Select value={editProviderId ?? ""} onChange={(e) => { setEditProviderId(e.target.value ? Number(e.target.value) : null); markDirty(); }}>
                <option value="">— Không gán (Seller Pool) —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.adapter_type})</option>
                ))}
              </Select>
            </Field>
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
          </>
        )}

        {adapterType === "mock" && (
          <div className="bg-warn/10 border border-warn/20 rounded-lg px-3 py-2 text-[12px] text-warn">
            Sản phẩm đang dùng dữ liệu demo. Khi kết nối API thật, dữ liệu sẽ tự chuyển sang nguồn thật.
          </div>
        )}
      </Card>

      {/* Admin save button */}
      {isAdmin && dirty && (
        <Card className="p-4 flex items-center gap-3 border-iris/30 bg-iris/5">
          <Button size="lg" disabled={saving} onClick={handleSave}>
            {saving ? "Đang lưu…" : "Lưu cấu hình vận hành"}
          </Button>
          {saveMsg && <span className={`text-[13px] ${saveMsg.type === "ok" ? "text-good" : "text-bad"}`}>{saveMsg.text}</span>}
        </Card>
      )}
      {isAdmin && !dirty && saveMsg && (
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
          {!isAdmin && (
            <p className="text-warn">
              Liên hệ quản trị viên để thay đổi chiến lược giá hoặc nhà cung cấp.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ── Admin Pricing Params Editor ────────────────────────────────── */

function KVEditor({ label, value, onChange }: {
  label: string;
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const entries = Object.entries(value);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const addEntry = () => {
    if (!newKey.trim()) return;
    onChange({ ...value, [newKey.trim()]: Number(newVal) || 0 });
    setNewKey(""); setNewVal("");
  };

  const removeEntry = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const updateVal = (key: string, v: number) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[12px] font-mono bg-surface-2 rounded px-2 py-1 min-w-[80px]">{k}</span>
          <Input type="number" className="w-[120px]" value={v} onChange={(e) => updateVal(k, Number(e.target.value))} />
          <button onClick={() => removeEntry(k)} className="text-bad text-[12px] hover:underline">Xoá</button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input placeholder="Key" className="w-[120px]" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <Input type="number" placeholder="Giá trị" className="w-[120px]" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={addEntry}>Thêm</Button>
      </div>
    </div>
  );
}

function ListEditor({ label, value, onChange, placeholder }: {
  label: string;
  value: unknown[];
  onChange: (v: unknown[]) => void;
  placeholder?: string;
}) {
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (!newItem.trim()) return;
    // Try parsing as JSON object, fallback to number or string
    let parsed: unknown;
    try { parsed = JSON.parse(newItem); } catch { parsed = isNaN(Number(newItem)) ? newItem : Number(newItem); }
    onChange([...value, parsed]);
    setNewItem("");
  };

  const removeItem = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      {value.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12px] font-mono bg-surface-2 rounded px-2 py-1 flex-1 truncate">
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </span>
          <button onClick={() => removeItem(i)} className="text-bad text-[12px] hover:underline">Xoá</button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input placeholder={placeholder ?? "Giá trị mới"} className="flex-1" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={addItem}>Thêm</Button>
      </div>
    </div>
  );
}

function AdminPricingParamsEditor({ strategy, params, onChange }: {
  strategy: string;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const setParam = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  if (strategy === "config") {
    return (
      <div className="space-y-4">
        <Field label="Giá cơ bản (VND)">
          <Input type="number" value={params.base_price as number ?? ""} onChange={(e) => setParam("base_price", Number(e.target.value) || 0)} />
        </Field>
        <KVEditor label="Hệ số loại (type_mult)" value={(params.type_mult as Record<string, number>) ?? {}} onChange={(v) => setParam("type_mult", v)} />
        <KVEditor label="Hệ số mạng (network_mult)" value={(params.network_mult as Record<string, number>) ?? {}} onChange={(v) => setParam("network_mult", v)} />
        <ListEditor label="Tuỳ chọn thời hạn (ngày)" value={(params.duration_options as unknown[]) ?? []} onChange={(v) => setParam("duration_options", v)} placeholder="VD: 7, 30, 90" />
        <ListEditor label="Giảm giá theo SL (volume_tiers)" value={(params.volume_tiers as unknown[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} placeholder='VD: {"min_qty":5,"discount":0.05}' />
      </div>
    );
  }

  if (strategy === "credit") {
    return (
      <div className="space-y-4">
        <Field label="Giá mỗi credit (VND)">
          <Input type="number" value={params.credit_price as number ?? ""} onChange={(e) => setParam("credit_price", Number(e.target.value) || 0)} />
        </Field>
        <ListEditor label="Gói credit (packages)" value={(params.packages as unknown[]) ?? []} onChange={(v) => setParam("packages", v)} placeholder='VD: {"size":100,"label":"100 credits"}' />
        <ListEditor label="Giảm giá theo SL (volume_tiers)" value={(params.volume_tiers as unknown[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} placeholder='VD: {"min_qty":5,"discount":0.05}' />
      </div>
    );
  }

  if (strategy === "task") {
    return (
      <div className="space-y-4">
        <Field label="Giá cơ bản (VND)">
          <Input type="number" value={params.base_price as number ?? ""} onChange={(e) => setParam("base_price", Number(e.target.value) || 0)} />
        </Field>
        <KVEditor label="Hệ số nền tảng (platform_mult)" value={(params.platform_mult as Record<string, number>) ?? {}} onChange={(v) => setParam("platform_mult", v)} />
        <ListEditor label="Giảm giá theo SL (volume_tiers)" value={(params.volume_tiers as unknown[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} placeholder='VD: {"min_qty":5,"discount":0.05}' />
      </div>
    );
  }

  return null;
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

  const [resourceVariant, setResourceVariant] = useState<number | null>(null);
  const [resourceText, setResourceText] = useState("");
  const [addingRes, setAddingRes] = useState(false);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loadingRes, setLoadingRes] = useState(false);

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

  const removeVariant = async (vid: number) => {
    if (!confirm("Xoá biến thể này?")) return;
    await api.deleteVariant(vid);
    onRefresh();
  };

  const loadResources = async (variantId: number) => {
    setLoadingRes(true);
    try {
      const list = await api.sellerVariantResources(variantId);
      setResources(list);
    } catch { setResources([]); }
    finally { setLoadingRes(false); }
  };

  const toggleResourcePanel = (variantId: number) => {
    if (resourceVariant === variantId) {
      setResourceVariant(null);
      setResources([]);
    } else {
      setResourceVariant(variantId);
      loadResources(variantId);
    }
  };

  const markError = async (resourceId: number) => {
    if (!confirm(`Xác nhận báo lỗi tài nguyên #${resourceId}?\n\nTài nguyên sẽ bị đánh dấu lỗi và không thể cấp phát cho khách hàng.`)) return;
    try {
      await api.markResourceError(resourceId);
      if (resourceVariant) await loadResources(resourceVariant);
    } catch { /* ignore */ }
  };

  const addResources = async () => {
    if (!resourceVariant || !resourceText.trim()) return;
    setAddingRes(true);
    try {
      const items = resourceText.split("\n").map((l) => l.trim()).filter(Boolean);
      await api.addResources(resourceVariant, items);
      setResourceText("");
      await loadResources(resourceVariant);
      onRefresh();
    } catch { } finally { setAddingRes(false); }
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
            <Field label="Giá (VND)">
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25000" />
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
        <Card key={v.id} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{v.name}</div>
              <div className="flex items-center gap-2 mt-1">
                {v.delivery_mode === "instant"
                  ? <Tag tone="good"><Bolt size={10} /> Giao ngay</Tag>
                  : <Tag tone="warn"><Clock size={10} /> {v.sla_hours}h</Tag>}
                <Tag tone="iris">{v.duration_days ? `${v.duration_days} ngày` : "Vĩnh viễn"}</Tag>
                <span className="font-mono text-[13px] font-semibold tabular">{vnd(v.price)}</span>
              </div>
              {v.delivery_mode === "instant" && (
                <div className="text-[12px] text-muted mt-1">
                  <Package size={12} className="inline -mt-0.5 mr-1" />{v.stock_count} trong kho
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {v.delivery_mode === "instant" && (
                <Button size="sm" variant="ghost" onClick={() => toggleResourcePanel(v.id)}>
                  <Plus size={13} /> Kho
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => removeVariant(v.id)}>
                <Trash size={13} />
              </Button>
            </div>
          </div>
          {resourceVariant === v.id && (
            <div className="mt-3 pt-3 border-t border-line space-y-3">
              <Field label="Thêm tài nguyên vào kho" hint="Mỗi dòng là một item (credential/key/data)">
                <Textarea rows={4} value={resourceText} onChange={(e) => setResourceText(e.target.value)}
                  placeholder="tw1|pass|mail@ex.com|cookie&#10;tw2|pass|mail@ex.com|cookie" />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" disabled={addingRes} onClick={addResources}>
                  {addingRes ? "Đang thêm…" : "Thêm vào kho"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setResourceVariant(null); setResourceText(""); setResources([]); }}>Huỷ</Button>
              </div>
              {loadingRes ? (
                <Spinner />
              ) : resources.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[12px] font-medium text-muted">Tài nguyên ({resources.length})</div>
                  {resources.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-faint">#{r.id}</span>
                        {r.status === "available" && <Tag tone="good">Sẵn sàng</Tag>}
                        {r.status === "assigned" && <Tag tone="iris">Đang dùng</Tag>}
                        {r.status === "expired" && <Tag tone="warn">Hết hạn</Tag>}
                        {r.status === "error" && <Tag tone="bad">Lỗi</Tag>}
                      </div>
                      {(r.status === "available" || r.status === "assigned") && (
                        <Button size="sm" variant="ghost" onClick={() => markError(r.id)}>Báo lỗi</Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
