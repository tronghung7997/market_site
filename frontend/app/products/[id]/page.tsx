"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import type { Order, PricingOptions, Product, ProductDetail, Review, Variant } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import {
  ArrowRight, Bolt, Check, ChevronRight, Clock, Copy, Info,
  MessageCircle, Package, Shield, Star, Verified,
} from "@/components/Icons";
import DynamicOrderForm from "@/components/DynamicOrderForm";

const SERVICE_LABELS: Record<string, string> = {
  proxy: "Proxy", account: "Tài khoản", token: "Token",
  endpoint: "Endpoint", takedown: "Takedown", cloud: "Cloud",
  payment: "Thanh toán", other: "Khác",
};

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { account } = useAuth();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Variant | null>(null);
  const [qty, setQty] = useState(1);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [tab, setTab] = useState<"detail" | "review" | "policy">("detail");
  const [related, setRelated] = useState<Product[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pricingStrategy, setPricingStrategy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.product(Number(id));
        setProduct(p);
        setSelected(p.variants[0] ?? null);
        // Fetch pricing strategy to decide which order form to show
        try {
          const opts = await api.pricingOptions(Number(id));
          setPricingStrategy(opts.strategy);
        } catch {
          setPricingStrategy("fixed"); // fallback to fixed/variant flow
        }
        // Fetch related products by same category
        if (p.category_id) {
          try {
            const all = await api.products(p.category_id);
            const seen = new Set<string>();
            setRelated(all.filter((r) => {
              if (r.id === p.id) return false;
              if (r.title.length < 3) return false;
              if (seen.has(r.title)) return false;
              seen.add(r.title);
              return true;
            }).slice(0, 3));
          } catch { /* ignore */ }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tìm thấy");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const buy = async () => {
    if (!selected) return;
    setPlacing(true); setPlaceError(null);
    try {
      setOrder(await api.createOrder(selected.id, qty));
      setShowConfirm(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setPlaceError("Số dư không đủ — vui lòng nạp tiền vào ví.");
      else setPlaceError(e instanceof Error ? e.message : "Đặt hàng thất bại");
    } finally {
      setPlacing(false);
    }
  };

  if (loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-20"><Spinner /></div>;
  if (error || !product) return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
      <Card className="p-6 text-sm">
        <p className="text-bad">{error ?? "Không tìm thấy"}</p>
        <Link href="/" className="inline-block mt-3 text-iris-hi hover:underline text-[13px]">← Về chợ</Link>
      </Card>
    </div>
  );

  const total = selected ? selected.price * qty : 0;
  const instant = selected?.delivery_mode === "instant";
  const useDynamicForm = pricingStrategy != null && pricingStrategy !== "fixed";
  const pricedVariants = product.variants.filter((v) => v.price > 0);
  const variantMinPrice = pricedVariants.length ? Math.min(...pricedVariants.map((v) => v.price)) : 0;
  const basePrice = (product.pricing_params as Record<string, unknown> | null)?.base_price as number | undefined;
  const creditPrice = (product.pricing_params as Record<string, unknown> | null)?.credit_price as number | undefined;
  const minPrice = variantMinPrice || basePrice || creditPrice || 0;
  const pricePrefix = useDynamicForm ? "Từ " : "";
  const totalStock = product.variants.reduce((s, v) => s + v.stock_count, 0);
  const sellerName = product.seller_email?.split("@")[0] ?? "seller";

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[12.5px] text-muted mb-3">
        <Link href="/" className="hover:text-fg transition-colors">Chợ</Link>
        <ChevronRight size={12} className="text-faint" />
        {product.category_name && (
          <>
            <span className="text-fg">{product.category_name}</span>
            <ChevronRight size={12} className="text-faint" />
          </>
        )}
        <span className="text-faint truncate max-w-[600px]">{product.title}</span>
      </nav>

      {/* === MAIN 2-COL: content left, sticky order right === */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] items-start">

        {/* ---- LEFT COLUMN: all product info ---- */}
        <div className="min-w-0">

          {/* Product header card — contains title, seller, price, highlight */}
          <Card className="overflow-hidden">
            <div className="h-0.5 flex">
              <span className="flex-1 bg-good/60" />
              <span className="flex-1 bg-iris/60" />
              <span className="flex-1 bg-warn/60" />
            </div>

            <div className="p-5">
              {/* Title + badges */}
              <div className="flex items-start gap-3">
                <span className="grid place-items-center h-10 w-10 shrink-0 rounded-lg bg-iris/8 border border-iris/15 font-serif text-[15px] font-bold text-iris-hi">
                  {product.title.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="font-serif text-[20px] leading-tight tracking-tight font-semibold">{product.title}</h1>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <Tag tone="iris">{SERVICE_LABELS[product.service_type ?? "other"] ?? "Khác"}</Tag>
                    <Tag tone="good">Đang bán</Tag>
                    <Tag tone="neutral"><Shield size={11} /> Ký quỹ {product.escrow_days}d</Tag>
                  </div>
                </div>
              </div>

              {/* Price + stats */}
              <div className="flex flex-wrap items-end gap-x-5 gap-y-1 mt-4 pt-3 border-t border-line">
                <span className="font-mono text-[24px] font-bold tabular text-iris-hi">{minPrice > 0 ? `${pricePrefix}${vnd(minPrice)}` : "Tuỳ cấu hình"}</span>
                <div className="flex items-center gap-3 text-[12.5px] text-muted pb-0.5">
                  {product.rating_avg != null && product.rating_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Star size={12} className="text-warn fill-warn" />
                      <span className="font-medium text-fg">{product.rating_avg.toFixed(1)}</span>
                      <span>({product.rating_count})</span>
                    </span>
                  )}
                  {product.sold_count > 0 && <span>Đã bán {product.sold_count.toLocaleString("vi-VN")}</span>}
                  {totalStock > 0 && <span className="text-good font-medium">{totalStock} có sẵn</span>}
                </div>
              </div>

              {/* Seller row */}
              <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-line text-[12.5px]">
                <span className="grid place-items-center h-6 w-6 rounded-full bg-raised border border-line text-[9px] font-bold text-muted">
                  {sellerName.slice(0, 2).toUpperCase()}
                </span>
                <span className="font-medium">{sellerName}</span>
                <Tag tone="good"><Verified size={10} /> Xác minh</Tag>
                <button className="ml-auto flex items-center gap-1 text-iris-hi hover:underline">
                  <MessageCircle size={11} /> Nhắn tin
                </button>
              </div>

              {/* Highlight */}
              {product.highlight_text && (
                <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-md bg-iris/4 border border-iris/10 text-[12.5px]">
                  <Bolt size={13} className="text-iris-hi shrink-0" />
                  <span>{product.highlight_text}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Specs table */}
          {product.specs && Object.keys(product.specs).length > 0 && (
            <Card className="overflow-hidden mt-4">
              <div className="px-4 py-2 border-b border-line">
                <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">Thông số</span>
              </div>
              <div className="divide-y divide-line">
                {Object.entries(product.specs).map(([key, val]) => (
                  <div key={key} className="flex text-[13px]">
                    <span className="w-[120px] shrink-0 px-4 py-2 text-muted bg-raised/40">{fmtKey(key)}</span>
                    <span className="px-4 py-2 whitespace-pre-wrap flex-1">{val}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Variant selection — only for fixed pricing */}
          {!useDynamicForm && (
            <div className="mt-4">
              <div className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-2">Chọn gói ({product.variants.length})</div>
              <div className="space-y-1.5">
                {product.variants.map((v) => {
                  const on = selected?.id === v.id;
                  return (
                    <button key={v.id} onClick={() => setSelected(v)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all",
                        on ? "border-iris bg-iris/4 shadow-[inset_3px_0_0_var(--color-iris)]"
                          : "border-line bg-surface hover:border-line-2",
                      )}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium leading-snug">{v.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {v.delivery_mode === "instant"
                            ? <Tag tone="good"><Bolt size={10} /> Giao ngay</Tag>
                            : <Tag tone="warn"><Clock size={10} /> {v.sla_hours}h</Tag>}
                          {v.delivery_mode === "instant" && v.stock_count > 0 && (
                            <span className="text-[11px] text-faint">Kho: {v.stock_count}</span>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-[14px] font-semibold tabular shrink-0">
                        {v.price > 0 ? vnd(v.price) : "Liên hệ"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabs: detail / review / warranty */}
          <div className="mt-5">
            <div className="flex gap-0.5 border-b border-line">
              {([
                { key: "detail" as const, label: "Chi tiết" },
                { key: "review" as const, label: "Đánh giá", count: product.rating_count },
                { key: "policy" as const, label: "Bảo hành" },
              ]).map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={cn(
                    "px-4 py-2 text-[13px] font-medium -mb-px border-b-2 transition-colors",
                    tab === t.key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
                  )}>
                  {t.label}
                  {"count" in t && t.count != null && t.count > 0 && (
                    <span className="ml-1.5 text-[11px] text-faint">{t.count}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="py-4">
              {tab === "detail" && <DetailTab product={product} />}
              {tab === "review" && <ReviewTab product={product} />}
              {tab === "policy" && <PolicyTab product={product} />}
            </div>
          </div>

          {/* Related products */}
          {related.length > 0 && (
            <div className="mt-6">
              <div className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Sản phẩm liên quan</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {related.map((r) => (
                  <Link key={r.id} href={`/products/${r.id}`}>
                    <Card interactive className="p-4">
                      <div className="text-[13.5px] font-medium leading-snug line-clamp-2">{r.title}</div>
                      <div className="flex items-center gap-2 mt-2">
                        {r.rating_avg != null && r.rating_count > 0 && (
                          <span className="flex items-center gap-0.5 text-[11px] text-muted">
                            <Star size={11} className="text-warn fill-warn" />
                            {r.rating_avg.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-faint">
                        {r.sold_count > 0 && <span>Đã bán {r.sold_count}</span>}
                        <Tag tone="iris">{SERVICE_LABELS[r.service_type ?? "other"] ?? "Khác"}</Tag>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---- RIGHT COLUMN: sticky order panel ---- */}
        <div className="lg:sticky lg:top-20">
          {useDynamicForm ? (
            order ? (
              <Card className="overflow-hidden">
                <div className="px-5 py-3 border-b border-line bg-raised/30">
                  <span className="text-[13px] font-semibold">Đặt hàng</span>
                </div>
                <div className="p-5">
                  <Delivered order={order} instant={false} onRebuy={() => { setOrder(null); setQty(1); }} />
                </div>
              </Card>
            ) : (
              <DynamicOrderForm productId={Number(id)} product={product} onOrderCreated={setOrder} />
            )
          ) : (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between bg-raised/30">
                <span className="text-[13px] font-semibold">Đặt hàng</span>
                {selected && (
                  <Tag tone={instant ? "good" : "warn"}>{instant ? "Giao ngay" : "Thủ công"}</Tag>
                )}
              </div>

              <div className="p-5">
                {order ? <Delivered order={order} instant={instant} onRebuy={() => { setOrder(null); setQty(1); }} /> : (
                  <div className="space-y-4">
                    {/* Selected variant */}
                    <div>
                      <div className="text-[11px] text-faint uppercase tracking-wider mb-1">Gói đã chọn</div>
                      <div className="text-[13.5px] font-medium line-clamp-2">{selected?.name ?? "—"}</div>
                    </div>

                    {/* Quantity */}
                    <div>
                      <div className="text-[11px] text-faint uppercase tracking-wider mb-1.5">Số lượng</div>
                      <div className="flex items-center border border-line rounded-lg overflow-hidden w-fit">
                        <button onClick={() => setQty(Math.max(1, qty - 1))}
                          className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors">−</button>
                        <input type="number" min={1} value={qty}
                          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                          className="h-9 w-12 text-center font-mono text-[13px] font-medium border-x border-line bg-surface" />
                        <button onClick={() => setQty(qty + 1)}
                          className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors">+</button>
                      </div>
                    </div>

                    {/* Total */}
                    <div className="border-t border-line pt-4 flex items-end justify-between">
                      <span className="text-[12px] text-muted">Tổng cộng</span>
                      <span className="font-mono text-[22px] font-bold tabular">{vnd(total)}</span>
                    </div>

                    {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}

                    <Button size="lg" block disabled={!selected || placing || (selected?.price === 0)} onClick={() => {
                      if (!account) { router.push("/login"); return; }
                      setShowConfirm(true);
                    }}>
                      {placing ? "Đang xử lý…"
                        : !account ? "Đăng nhập để mua"
                        : selected?.price === 0 ? "Liên hệ báo giá"
                        : instant ? "Mua ngay" : "Đặt hàng"}
                    </Button>

                    <p className="text-[11.5px] text-faint leading-relaxed text-center">
                      <Shield size={11} className="inline -mt-0.5 mr-0.5 text-good" />
                      Ký quỹ {product.escrow_days} ngày · Tiền chỉ chuyển khi bạn xác nhận
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-[400px] mx-4 bg-surface border border-line rounded-xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-line">
              <span className="text-[14px] font-semibold">Xác nhận đơn hàng</span>
            </div>
            <div className="p-5 space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted">Sản phẩm</span>
                <span className="font-medium text-right max-w-[220px] truncate">{product.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Gói</span>
                <span className="font-medium">{selected.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Số lượng</span>
                <span className="font-medium">{qty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Đơn giá</span>
                <span className="font-medium">{vnd(selected.price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Giao hàng</span>
                <span className="font-medium">{instant ? "Giao ngay (tự động)" : `Thủ công (trong ${selected.sla_hours}h)`}</span>
              </div>
              <div className="border-t border-line pt-3 flex justify-between items-end">
                <span className="text-muted">Tổng cộng</span>
                <span className="font-mono text-[18px] font-bold tabular text-iris-hi">{vnd(total)}</span>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-good/5 border border-good/15 text-[12px] text-muted">
                <Shield size={13} className="text-good mt-0.5 shrink-0" />
                <span>Ký quỹ {product.escrow_days} ngày — tiền chỉ chuyển cho người bán khi bạn xác nhận hài lòng.</span>
              </div>
              {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-line">
              <Button variant="secondary" block onClick={() => { setShowConfirm(false); setPlaceError(null); }} disabled={placing}>Huỷ</Button>
              <Button block disabled={placing} onClick={buy}>{placing ? "Đang xử lý…" : "Xác nhận mua"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Tab content
   ================================================================ */

function DetailTab({ product }: { product: ProductDetail }) {
  return (
    <div className="space-y-5 text-[13.5px]">
      {product.description && (
        <p className="text-muted leading-relaxed whitespace-pre-line">{product.description}</p>
      )}

      {product.features && product.features.length > 0 && (
        <ul className="space-y-1.5">
          {product.features.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-muted">
              <Check size={14} className="text-good mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewTab({ product }: { product: ProductDetail }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);

  useEffect(() => {
    api.productReviews(product.id).then(setReviews).catch(() => {}).finally(() => setLoadingReviews(false));
  }, [product.id]);

  if (loadingReviews) return <div className="py-4"><Spinner /></div>;

  if (reviews.length === 0) {
    return (
      <div className="py-10 text-center">
        <span className="inline-grid place-items-center h-11 w-11 rounded-full bg-raised border border-line text-faint mb-3">
          <Star size={18} />
        </span>
        <p className="text-[13px] text-muted">Chưa có đánh giá nào — hãy là người mua đầu tiên chia sẻ trải nghiệm.</p>
      </div>
    );
  }

  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  return (
    <div className="space-y-6">
      {/* Rating summary */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-10 py-1">
        <div className="text-center shrink-0">
          <div className="font-serif text-[42px] leading-none font-semibold">{avg.toFixed(1)}</div>
          <div className="flex justify-center gap-0.5 mt-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star key={s} size={14} className={s <= Math.round(avg) ? "text-warn fill-warn" : "text-line-2"} />
            ))}
          </div>
          <div className="text-[12px] text-faint mt-1.5 whitespace-nowrap">{reviews.length} đánh giá</div>
        </div>
        <div className="flex-1 space-y-1.5 max-w-xs">
          {dist.map(({ star, count }) => {
            const pct = Math.round((count / reviews.length) * 100);
            return (
              <div key={star} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-3 text-faint tabular-nums">{star}</span>
                <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
                  <div className="h-full rounded-full bg-warn transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-5 text-right text-faint tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Individual reviews */}
      <div className="space-y-0 divide-y divide-line">
        {reviews.map((r) => (
          <div key={r.id} className="py-4 first:pt-0">
            <div className="flex items-start gap-3">
              <span className="grid place-items-center h-9 w-9 shrink-0 rounded-full bg-iris-soft text-iris text-[12px] font-semibold border border-iris/15">
                U{r.buyer_id}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">Người mua #{r.buyer_id}</span>
                    <Tag tone="good"><Verified size={10} /> Đã mua hàng</Tag>
                  </div>
                  <span className="text-[11px] text-faint">{formatDate(r.created_at)}</span>
                </div>
                <div className="flex gap-0.5 mt-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={11} className={s <= r.rating ? "text-warn fill-warn" : "text-line-2"} />
                  ))}
                </div>
                {r.comment && <p className="text-[13px] text-muted leading-relaxed mt-2">{r.comment}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PolicyTab({ product }: { product: ProductDetail }) {
  return (
    <div className="space-y-4 text-[13.5px]">
      {product.warranty_text ? (
        <div className="text-muted leading-relaxed whitespace-pre-line">{product.warranty_text}</div>
      ) : (
        <p className="text-muted">Áp dụng chính sách ký quỹ {product.escrow_days} ngày theo quy định Proxora.</p>
      )}
      <div className="border-t border-line pt-4 space-y-1.5 text-[13px] text-muted">
        <div className="text-[12px] font-semibold text-fg uppercase tracking-wider mb-2">Cơ chế ký quỹ</div>
        {[
          `Tiền giữ bởi Proxora trong ${product.escrow_days} ngày`,
          "Chỉ chuyển cho người bán khi bạn xác nhận",
          "Hoàn tiền 100% nếu không đúng mô tả",
          "Mở tranh chấp bất kỳ lúc nào trong thời hạn ký quỹ",
        ].map((t, i) => (
          <div key={i} className="flex items-start gap-2">
            <Check size={13} className="text-good mt-0.5 shrink-0" />{t}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   Post-purchase
   ================================================================ */

function Delivered({ order, instant, onRebuy }: { order: Order; instant: boolean; onRebuy: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyData = () => {
    if (order.delivered_data) {
      navigator.clipboard.writeText(order.delivered_data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center h-9 w-9 rounded-full bg-good-soft text-good border border-good/25">
          <Check size={16} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium">Đơn #{order.id}</div>
          <Tag tone={order.status === "delivered" ? "good" : "warn"}>
            {order.status === "delivered" ? "Đã giao" : order.status}
          </Tag>
        </div>
      </div>
      {instant && order.delivered_data ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-faint uppercase tracking-wider">Thông tin bàn giao</span>
            <button onClick={copyData} className="flex items-center gap-1 text-[11px] text-iris-hi hover:underline">
              <Copy size={11} /> {copied ? "Đã copy" : "Copy"}
            </button>
          </div>
          <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-3 whitespace-pre-wrap break-all">{order.delivered_data}</pre>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">Người bán sẽ giao trong thời hạn SLA.</p>
      )}
      <div className="flex gap-2">
        <Link href="/orders" className="flex-1"><Button variant="secondary" block size="sm">Xem đơn hàng</Button></Link>
        <Button variant="secondary" size="sm" onClick={onRebuy} className="flex-1">Mua thêm</Button>
      </div>
    </div>
  );
}

/* ================================================================
   Helpers
   ================================================================ */

function fmtKey(key: string): string {
  const map: Record<string, string> = {
    format: "Định dạng", platform: "Nền tảng", age: "Tuổi TK",
    verified: "Xác minh", country: "Quốc gia", type: "Loại",
    friends: "Bạn bè", posts: "Bài viết", compatibility: "Tương thích",
    protocol: "Giao thức", provider: "Nhà mạng", bandwidth: "Băng thông",
    countries: "Quốc gia", uptime: "Uptime", cpu: "CPU", ram: "RAM",
    storage: "Lưu trữ", location: "Vị trí", os: "Hệ điều hành",
    network: "Mạng", currency: "Tiền tệ", min_load: "Nạp min",
    max_load: "Nạp max", kyc: "KYC",
  };
  return map[key] ?? key.replace(/_/g, " ");
}
