"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import type { Category, ProductDetail, Variant } from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag } from "@/components/ui";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import {
  type Archetype,
  type WorkModelB,
  type WorkbenchVariant,
  type B1ConfigState,
  type B2CreditState,
  type B3TaskState,
  type BackendState,
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  SellerSellableChecklist,
  SellerOrderPanelSimulation,
  SellerDynamicOrderSimulation,
  SellerVariantManager,
  SellerCoverPicker,
  SellerPriceInput,
  useSellerPriceCurrency,
} from "@/features/seller-workbench";
import { type CoverId, parseCoverId } from "@/lib/product-covers";

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (l: Category[]) =>
    l.forEach((c) => {
      out.push(c);
      walk(c.children ?? []);
    });
  walk(cats);
  return out;
}

export default function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const productId = Number(id);
  const { currency: priceCurrency } = useSellerPriceCurrency();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [cats, setCats] = useState<Category[]>([]);

  // Form State
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [coverId, setCoverId] = useState<CoverId>("account");
  const [escrowDays, setEscrowDays] = useState(30);
  const [description, setDescription] = useState("");

  // Route A Variants
  const [variants, setVariants] = useState<WorkbenchVariant[]>([]);

  // Route B State
  const [workModel, setWorkModel] = useState<WorkModelB | null>("B1");
  const [b1, setB1] = useState<B1ConfigState>({
    basePrice: 50000,
    types: [
      { key: "residential", label: "Residential (Dân cư sạch)", mult: 1.4 },
      { key: "datacenter", label: "Datacenter (Tốc độ cao)", mult: 1.0 },
    ],
    networks: [
      { key: "fpt", label: "FPT Telecom", mult: 1.0 },
      { key: "viettel", label: "Viettel", mult: 1.1 },
    ],
    durations: [
      { days: 7, label: "7 Ngày" },
      { days: 30, label: "30 Ngày" },
    ],
    selectedType: "residential",
    selectedNetwork: "fpt",
    selectedDays: 30,
    qty: 1,
    isSingleUnit: false,
  });

  const [b2, setB2] = useState<B2CreditState>({
    creditPrice: 200,
    packages: [
      { size: 500, label: "Gói 500 Lượt", discountPct: 0 },
      { size: 1000, label: "Gói 1.000 Lượt", discountPct: 10 },
      { size: 5000, label: "Gói 5.000 Lượt", discountPct: 20 },
    ],
    selectedPackageSize: 1000,
  });

  const [b3, setB3] = useState<B3TaskState>({
    basePrice: 30000,
    platforms: [
      { key: "tiktok", label: "TikTok", mult: 1.2 },
      { key: "facebook", label: "Facebook", mult: 1.0 },
    ],
    selectedPlatform: "tiktok",
    urls: "https://tiktok.com/@channel1\nhttps://tiktok.com/@channel2",
  });

  const [backend, setBackend] = useState<BackendState>({
    status: "none",
    name: "",
  });

  const loadData = async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const [prodData, catData] = await Promise.all([
        api.sellerProduct(productId),
        api.categories(),
      ]);
      setProduct(prodData);
      setCats(catData);

      setTitle(prodData.title || "");
      setCategoryId(prodData.category_id || (catData[0]?.id ?? 0));
      setCoverId(parseCoverId(prodData) || (prodData.service_type === "proxy" ? "proxy" : "account"));
      setEscrowDays(prodData.escrow_days || 30);
      setDescription(prodData.description || "");

      // Map variants
      if (prodData.variants) {
        setVariants(
          prodData.variants.map((v: Variant) => ({
            id: v.id,
            name: v.name,
            price: v.price,
            delivery_mode: (v.delivery_mode as "instant" | "manual") || "instant",
            stock_count: v.stock_count || 0,
            sla_hours: v.sla_hours || 24,
            is_active: v.is_active !== false,
          })),
        );
      }

      // Check if backend provider attached
      if (prodData.pricing_strategy && prodData.pricing_strategy !== "fixed") {
        if (prodData.pricing_strategy === "credit") setWorkModel("B2");
        else if (prodData.pricing_strategy === "task") setWorkModel("B3");
        else setWorkModel("B1");

        setBackend({
          status: "approved",
          name: "Máy chủ tự động Shop",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải thông tin sản phẩm");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [productId]);

  const archetype: Archetype =
    !product?.pricing_strategy || product.pricing_strategy === "fixed" ? "A" : "B";

  // Evaluate Checklist
  const evalA = evaluateRouteAChecklist({
    title,
    description,
    variants,
    escrowDays,
  });

  const evalB = evaluateRouteBChecklist({
    title,
    description,
    workModel,
    priceValid:
      (workModel === "B1" && b1.basePrice > 0) ||
      (workModel === "B2" && b2.creditPrice > 0) ||
      (workModel === "B3" && b3.basePrice > 0),
    backend,
    escrowDays,
  });

  const currentEval = archetype === "A" ? evalA : evalB;
  const flatCats = flatten(cats);
  const selectedCat = flatCats.find((c) => c.id === categoryId);

  // Actions
  const handleSaveInfo = async () => {
    if (!title.trim() || !categoryId) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.updateProduct(productId, {
        title: title.trim(),
        category_id: categoryId,
        cover_id: coverId,
        escrow_days: escrowDays,
        description: description.trim() || null,
      });
      setSuccessMsg("Đã lưu thông tin sản phẩm thành công!");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể cập nhật thông tin");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (targetStatus: "active" | "paused") => {
    setSaving(true);
    setError(null);
    try {
      await api.updateSellerProductStatus(productId, targetStatus);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể đổi trạng thái");
    } finally {
      setSaving(false);
    }
  };

  const handleAddVariant = async (data: {
    name: string;
    price: number;
    delivery_mode: "instant" | "manual";
    sla_hours: number;
  }) => {
    const created = await api.createVariant(productId, data);
    setVariants((prev) => [
      ...prev,
      {
        id: created.id,
        name: created.name,
        price: created.price,
        delivery_mode: created.delivery_mode as "instant" | "manual",
        stock_count: 0,
        sla_hours: created.sla_hours || 24,
        is_active: true,
      },
    ]);
  };

  const handleUpdateVariant = async (id: number, data: Partial<WorkbenchVariant>) => {
    await api.updateVariant(id, data as Record<string, unknown>);
    setVariants((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...data } : v)),
    );
  };

  const handleDeleteVariant = async (id: number) => {
    await api.deleteVariant(id);
    setVariants((prev) => prev.filter((v) => v.id !== id));
  };

  const handleRestockVariant = async (id: number, items: string[]) => {
    await api.addResources(id, items);
    setVariants((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, stock_count: v.stock_count + items.length } : v,
      ),
    );
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center items-center">
        <Spinner label="Đang tải thông tin sản phẩm..." />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-[14px] text-bad">Không tìm thấy thông tin sản phẩm.</p>
        <Link href="/seller/products" className="text-iris text-[13px] underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  const isSuspended = product.status === "suspended";
  const isActive = product.status === "active";
  const isPaused = product.status === "paused";
  const isDraft = product.status === "draft";

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-line">
        <div className="space-y-1">
          <Link
            href="/seller/products"
            className="text-[12px] text-muted hover:text-fg inline-flex items-center gap-1 font-medium transition"
          >
            ← Danh sách sản phẩm
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[18px] font-bold text-fg font-serif">{product.title}</h2>
            {isSuspended ? (
              <Tag tone="bad">🔴 Bị đình chỉ bởi Admin</Tag>
            ) : isActive ? (
              <Tag tone="good">🟢 Đang mở bán trên chợ</Tag>
            ) : isPaused ? (
              <Tag tone="warn">🟡 Tạm dừng bán</Tag>
            ) : currentEval.isSellable ? (
              <Tag tone="good">🟢 Sẵn sàng mở bán (Bản nháp đủ điều kiện)</Tag>
            ) : (
              <Tag tone="neutral">⚪ Bản nháp (Chưa đủ điều kiện)</Tag>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isSuspended && (
            <>
              {isActive ? (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => handleToggleStatus("paused")}
                >
                  Tạm dừng mở bán
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={saving || !currentEval.isSellable}
                  onClick={() => handleToggleStatus("active")}
                >
                  {isPaused ? "▶ Tiếp tục mở bán" : "🚀 Mở bán sản phẩm"}
                </Button>
              )}
            </>
          )}
          <Button
            variant="secondary"
            disabled={saving}
            onClick={handleSaveInfo}
          >
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-bad-soft border border-bad/25 text-bad rounded-lg text-[13px]">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-good-soft border border-good/25 text-good rounded-lg text-[13px]">
          {successMsg}
        </div>
      )}

      {/* Main Split Grid (60% Workbench / 40% Live Simulation) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px] items-start">
        {/* Left Form Controls */}
        <div className="space-y-6 min-w-0">
          {/* Thông tin chung */}
          <Card className="p-5 space-y-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
              Thông tin sản phẩm
            </span>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên sản phẩm *">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="VD: Netflix Premium 4K Ultra HD"
                />
              </Field>

              <Field label="Danh mục *">
                <Select
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                >
                  {flatCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Thời gian bảo hành Escrow (ngày)">
              <Input
                type="number"
                min={1}
                value={escrowDays}
                onChange={(e) => setEscrowDays(Number(e.target.value) || 1)}
              />
            </Field>

            <SellerCoverPicker
              selectedCoverId={coverId}
              onChange={setCoverId}
            />

            <Field label="Mô tả sản phẩm *">
              <MarkdownEditor
                value={description}
                onChange={setDescription}
                placeholder="Nhập mô tả sản phẩm..."
              />
            </Field>
          </Card>

          {/* Đường A: Quản lý gói bán & kho hàng */}
          {archetype === "A" && (
            <SellerVariantManager
              variants={variants}
              onAddVariant={handleAddVariant}
              onUpdateVariant={handleUpdateVariant}
              onDeleteVariant={handleDeleteVariant}
              onRestockVariant={handleRestockVariant}
            />
          )}

          {/* Đường B: Quản lý nguồn & cấu hình */}
          {archetype === "B" && (
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                    Cấu hình mô hình dịch vụ
                  </span>
                  <h3 className="text-[14px] font-bold text-fg">Đơn giá & Nguồn thực hiện</h3>
                </div>
                <Tag tone="iris">Dịch vụ số</Tag>
              </div>

              {workModel === "B1" && (
                <Field label={`Giá cơ bản (${priceCurrency})`}>
                  <SellerPriceInput amountVnd={b1.basePrice} onAmountVndChange={(basePrice) => setB1({ ...b1, basePrice })} />
                </Field>
              )}

              {workModel === "B2" && (
                <Field label={`Đơn giá mỗi lượt (${priceCurrency})`}>
                  <SellerPriceInput amountVnd={b2.creditPrice} onAmountVndChange={(creditPrice) => setB2({ ...b2, creditPrice })} />
                </Field>
              )}

              {workModel === "B3" && (
                <Field label={`Đơn giá mỗi link/tác vụ (${priceCurrency})`}>
                  <SellerPriceInput amountVnd={b3.basePrice} onAmountVndChange={(basePrice) => setB3({ ...b3, basePrice })} />
                </Field>
              )}

              <div className="p-4 rounded-xl border border-line bg-surface space-y-2">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-bold text-fg flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-good" /> Nguồn máy chủ: <strong>{backend.name || "Máy chủ shop"}</strong>
                  </span>
                  <Tag tone="good">Tương thích 100%</Tag>
                </div>
                <p className="text-[11.5px] text-muted">
                  Kết nối API an toàn • Tự động hoàn tiền nếu máy chủ gặp sự cố cấp phát.
                </p>
              </div>
            </Card>
          )}
        </div>

        {/* Right Sticky Live Preview & Checklist */}
        <div className="space-y-4 lg:sticky lg:top-4">
          {archetype === "A" ? (
            <SellerOrderPanelSimulation
              title={title}
              categoryName={selectedCat?.name}
              coverId={coverId}
              escrowDays={escrowDays}
              variants={variants}
            />
          ) : (
            <SellerDynamicOrderSimulation
              title={title}
              categoryName={selectedCat?.name}
              coverId={coverId}
              escrowDays={escrowDays}
              workModel={workModel}
              b1={b1}
              b2={b2}
              b3={b3}
              backend={backend}
              onB1Change={setB1}
              onB2Change={setB2}
              onB3Change={setB3}
            />
          )}

          <SellerSellableChecklist
            checks={currentEval.checks}
            isSellable={currentEval.isSellable}
            passCount={currentEval.passCount}
            totalCount={currentEval.totalCount}
          />
        </div>
      </div>
    </div>
  );
}
