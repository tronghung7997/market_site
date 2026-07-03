"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, vnd, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CalculateResult, Order, PricingField, PricingOptions, ProductDetail } from "@/lib/types";
import { Button, Card, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { Shield } from "@/components/Icons";

interface Props {
  productId: number;
  product: ProductDetail;
  onOrderCreated: (order: Order) => void;
}

export default function DynamicOrderForm({ productId, product, onOrderCreated }: Props) {
  const router = useRouter();
  const { account } = useAuth();

  const [options, setOptions] = useState<PricingOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [qty, setQty] = useState(1);

  const [calc, setCalc] = useState<CalculateResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch pricing options on mount
  useEffect(() => {
    (async () => {
      try {
        const opts = await api.pricingOptions(productId);
        setOptions(opts);
        // Set default values
        const defaults: Record<string, unknown> = {};
        for (const f of opts.fields) {
          if (f.default != null) {
            defaults[f.field] = f.default;
          } else if (f.type === "select" && f.choices?.length) {
            defaults[f.field] = f.choices[0].value;
          } else if (f.type === "radio" && f.choices?.length) {
            defaults[f.field] = f.choices[0].value;
          } else if (f.type === "number" || f.type === "slider") {
            defaults[f.field] = f.min ?? 1;
          }
        }
        setConfig(defaults);
      } catch (e) {
        setOptionsError(e instanceof Error ? e.message : "Không tải được tùy chọn giá");
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, [productId]);

  // Debounced calculate on config/qty change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doCalculate = useCallback(async (cfg: Record<string, unknown>, q: number) => {
    if (!options || options.fields.length === 0) return;
    setCalculating(true);
    try {
      const merged = { ...cfg, quantity: q };
      const result = await api.calculatePrice(productId, merged);
      setCalc(result);
    } catch {
      // Silently ignore calculate errors — user is still typing
    } finally {
      setCalculating(false);
    }
  }, [productId, options]);

  useEffect(() => {
    if (!options) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doCalculate(config, qty), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [config, qty, doCalculate, options]);

  const updateField = (field: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!account) { router.push("/login"); return; }
    setShowConfirm(true);
  };

  const confirmBuy = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await api.createOrderWithConfig(productId, { ...config, quantity: qty }, qty);
      setShowConfirm(false);
      onOrderCreated(order);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setPlaceError("Số dư không đủ — vui lòng nạp tiền vào ví.");
      } else {
        setPlaceError(e instanceof Error ? e.message : "Đặt hàng thất bại");
      }
    } finally {
      setPlacing(false);
    }
  };

  if (loadingOptions) return <Spinner label="Đang tải tùy chọn..." />;
  if (optionsError) return <p className="text-bad text-[13px] py-4">{optionsError}</p>;
  if (!options) return null;

  const hasDiscount = calc && calc.discount_pct != null && calc.discount_pct > 0;
  const displayAmount = calc?.amount ?? 0;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between bg-raised/30">
          <span className="text-[13px] font-semibold">Cấu hình đơn hàng</span>
          <Tag tone="iris">{options.strategy}</Tag>
        </div>

        <div className="p-5 space-y-4">
          {/* Dynamic fields */}
          {options.fields.map((f) => (
            <DynamicField key={f.field} field={f} value={config[f.field]} onChange={(v) => updateField(f.field, v)} />
          ))}

          {/* Quantity — ẩn với strategy "task": số lượng tự đếm theo URL */}
          {options.strategy !== "task" && (
          <div>
            <div className="text-[11px] text-faint uppercase tracking-wider mb-1.5">Số lượng</div>
            <div className="flex items-center border border-line rounded-lg overflow-hidden w-fit">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-12 text-center font-mono text-[13px] font-medium border-x border-line bg-surface"
              />
              <button
                onClick={() => setQty(qty + 1)}
                className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
              >
                +
              </button>
            </div>
          </div>
          )}

          {/* Price display */}
          <div className="border-t border-line pt-4 flex items-end justify-between">
            <span className="text-[12px] text-muted">Tổng cộng</span>
            <div className="text-right">
              {calculating ? (
                <span className="text-[13px] text-muted">Đang tính...</span>
              ) : calc ? (
                <div>
                  {hasDiscount && calc.original_amount != null && (
                    <div className="flex items-center gap-2 justify-end mb-0.5">
                      <span className="text-[13px] text-faint line-through">{vnd(calc.original_amount)}</span>
                      <Tag tone="good">-{calc.discount_pct}%</Tag>
                    </div>
                  )}
                  <span className="font-mono text-[22px] font-bold tabular text-iris-hi">{vnd(displayAmount)}</span>
                </div>
              ) : (
                <span className="text-[13px] text-faint">—</span>
              )}
            </div>
          </div>

          {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}

          <Button size="lg" block disabled={placing || !calc || calculating} onClick={handleSubmit}>
            {placing ? "Đang xử lý…" : !account ? "Đăng nhập để mua" : "Đặt hàng"}
          </Button>

          <p className="text-[11.5px] text-faint leading-relaxed text-center">
            <Shield size={11} className="inline -mt-0.5 mr-0.5 text-good" />
            Ký quỹ {product.escrow_days} ngày · Tiền chỉ chuyển khi bạn xác nhận
          </p>
        </div>
      </Card>

      {/* Confirmation modal */}
      {showConfirm && calc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-[400px] mx-4 bg-surface border border-line rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-line">
              <span className="text-[14px] font-semibold">Xác nhận đơn hàng</span>
            </div>
            <div className="p-5 space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted">Sản phẩm</span>
                <span className="font-medium text-right max-w-[220px] truncate">{product.title}</span>
              </div>
              {/* Show user config summary */}
              {options.fields.map((f) => {
                const val = config[f.field];
                let display = String(val ?? "—");
                if (f.choices) {
                  const choice = f.choices.find((c) => c.value === String(val));
                  if (choice) display = choice.label;
                }
                return (
                  <div key={f.field} className="flex justify-between">
                    <span className="text-muted">{f.label}</span>
                    <span className="font-medium">{display}</span>
                  </div>
                );
              })}
              {options.strategy !== "task" && (
                <div className="flex justify-between">
                  <span className="text-muted">Số lượng</span>
                  <span className="font-medium">{qty}</span>
                </div>
              )}
              {hasDiscount && calc.original_amount != null && (
                <div className="flex justify-between">
                  <span className="text-muted">Giá gốc</span>
                  <span className="text-faint line-through">{vnd(calc.original_amount)}</span>
                </div>
              )}
              {hasDiscount && (
                <div className="flex justify-between">
                  <span className="text-muted">Giảm giá</span>
                  <Tag tone="good">-{calc.discount_pct}%</Tag>
                </div>
              )}
              <div className="border-t border-line pt-3 flex justify-between items-end">
                <span className="text-muted">Tổng cộng</span>
                <span className="font-mono text-[18px] font-bold tabular text-iris-hi">{vnd(displayAmount)}</span>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-good/5 border border-good/15 text-[12px] text-muted">
                <Shield size={13} className="text-good mt-0.5 shrink-0" />
                <span>Ký quỹ {product.escrow_days} ngày — tiền chỉ chuyển cho người bán khi bạn xác nhận hài lòng.</span>
              </div>
              {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-line">
              <Button variant="secondary" block onClick={() => { setShowConfirm(false); setPlaceError(null); }} disabled={placing}>
                Huỷ
              </Button>
              <Button block disabled={placing} onClick={confirmBuy}>
                {placing ? "Đang xử lý…" : "Xác nhận mua"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================
   Dynamic field renderer
   ================================================================ */

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: PricingField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <div className="text-[11px] text-faint uppercase tracking-wider mb-1.5">
      {field.label}
      {field.required && <span className="text-bad ml-0.5">*</span>}
    </div>
  );

  switch (field.type) {
    case "select":
      return (
        <div>
          {label}
          <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {field.choices?.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      );

    case "radio":
      return (
        <div>
          {label}
          <div className="space-y-1.5">
            {field.choices?.map((c) => {
              const active = String(value) === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onChange(c.value)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left text-[13px] transition-all ${
                    active
                      ? "border-iris bg-iris/4 shadow-[inset_3px_0_0_var(--color-iris)]"
                      : "border-line bg-surface hover:border-line-2"
                  }`}
                >
                  <span
                    className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      active ? "border-iris" : "border-line-2"
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-iris" />}
                  </span>
                  <span className="font-medium">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      );

    case "number":
    case "slider":
      return (
        <div>
          {label}
          <Input
            type="number"
            min={field.min}
            max={field.max}
            value={String(value ?? "")}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {field.min != null && field.max != null && (
            <span className="text-[11px] text-faint mt-1 block">
              {field.min} — {field.max}
            </span>
          )}
        </div>
      );

    case "textarea":
      return (
        <div>
          {label}
          <Textarea
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
          />
        </div>
      );

    default:
      return null;
  }
}
