"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { ProductDetail, ProductOperations, Provider } from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag } from "@/components/ui";
import { Activity, ArrowRight, Eye, Info, Sliders, Users } from "@/components/Icons";

const STATUS_MAP: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  active: { label: "Đang bán", tone: "good" },
  draft: { label: "Nháp", tone: "neutral" },
  paused: { label: "Tạm dừng", tone: "warn" },
  suspended: { label: "Bị khoá", tone: "bad" },
};

const SERVICE_LABELS: Record<string, string> = {
  account: "Tài khoản", proxy: "Proxy", token: "Token", endpoint: "Endpoint",
  cloud: "Cloud", payment: "Thanh toán", takedown: "Takedown", other: "Khác",
};

const STRATEGY_INFO: Record<string, { label: string; description: string; pipelineLabel: string }> = {
  fixed: { label: "Cố định", description: "Giá set trên mỗi biến thể. Khách chọn biến thể + số lượng.", pipelineLabel: "Cố định" },
  config: { label: "Cấu hình", description: "Giá tính dynamic theo tuỳ chọn khách chọn (loại, mạng, thời hạn).", pipelineLabel: "Dynamic" },
  credit: { label: "Credit", description: "Khách mua gói credit (số request). Mỗi request trừ credit.", pipelineLabel: "Credit" },
  task: { label: "Tác vụ", description: "Giá theo nền tảng và số URL. Team xử lý thủ công.", pipelineLabel: "Tác vụ" },
};

const ADAPTER_INFO: Record<string, { label: string; description: string }> = {
  seller_pool: { label: "Seller Pool", description: "Lấy từ kho hàng seller upload" },
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

export default function AdminProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [ops, setOps] = useState<ProductOperations | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
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

  const loadAll = async () => {
    setLoading(true);
    try {
      const [p, o, provList] = await Promise.all([
        api.product(Number(id)),
        api.productOperations(Number(id)),
        api.providers(),
      ]);
      setProduct(p);
      setOps(o);
      setProviders(provList);
      setEditProviderId(o.provider?.id ?? null);
      setEditStrategy(o.pricing.strategy || "fixed");
      setEditParams(structuredClone(o.pricing.params ?? {}));
      setEditCommission(p.commission_rate != null ? String(p.commission_rate) : "");
    } catch {
      setError("Không tải được sản phẩm");
    } finally {
      setLoading(false);
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

      {/* Section 1: Thong tin san pham (read-only) */}
      <Card className="p-5 space-y-4">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Info size={14} /> Thông tin sản phẩm
        </h3>
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
            <div className="text-[13px] font-medium mt-1">{product.variants.length} bien the</div>
          </div>
        </div>
        {product.description && (
          <div>
            <div className="text-[11px] text-faint font-medium">Mô tả</div>
            <div className="text-[13px] text-muted mt-1 whitespace-pre-wrap">{product.description}</div>
          </div>
        )}
      </Card>

      {/* Section 2: Van hanh (editable) */}

      {/* Pipeline */}
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

      {/* Chien luoc gia */}
      <Card className="p-5 space-y-4">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Sliders size={14} /> Chiến lược giá
        </h3>

        {/* Strategy cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(STRATEGY_INFO).map(([key, info]) => (
            <button key={key} onClick={() => { setEditStrategy(key); if (key === "fixed") setEditParams({}); markDirty(); }}
              className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${editStrategy === key ? "border-iris bg-iris/5 ring-1 ring-iris/30" : "border-line bg-surface-2 hover:border-muted"}`}>
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
          <div className="bg-surface-2 rounded-lg px-4 py-3 text-[13px] text-muted">
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

/* ── Pricing Params Editor ──────────────────────────────────────── */

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
        <Input placeholder={placeholder ?? "Giá trị moi"} className="flex-1" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={addItem}>Thêm</Button>
      </div>
    </div>
  );
}

function PricingParamsEditor({ strategy, params, onChange }: {
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
