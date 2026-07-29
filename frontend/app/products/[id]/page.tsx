"use client";

/* Hallmark · genre: modern-minimal · macrostructure: Workbench (commerce two-column:
 * document left, order-slip right) · theme: preserved project system (Proxora light —
 * Newsreader / Be Vietnam Pro / JetBrains Mono, iris accent) · enrichment: none —
 * function carries the page · pre-emit critique: P4 H5 E4 S4 R5 V4
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, vnd, ApiError } from "@/lib/api";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatDate, formatSpecKey as fmtKey } from "@/lib/utils";
import type { Order, Product, ProductDetail, Review, Variant } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import {
  Bolt, Check, ChevronRight, Clock, Copy, MessageCircle, Shield, Star, Verified, X,
} from "@/components/Icons";
import DynamicOrderForm from "@/components/DynamicOrderForm";
import { MarkdownContent } from "@/components/MarkdownContent";

const SERVICE_LABELS: Record<string, string> = {
  proxy: "Proxy", account: "Tài khoản", token: "Token",
  endpoint: "Endpoint", takedown: "Takedown", cloud: "Cloud",
  payment: "Thanh toán", other: "Khác",
};

/** Gói mua được ngay: có giá thật và (giao tay hoặc còn kho). */
const purchasable = (v: Variant) => v.price > 0 && (v.delivery_mode !== "instant" || v.stock_count > 0);

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
  const [related, setRelated] = useState<Product[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pricingStrategy, setPricingStrategy] = useState<string | null>(null);

  // Thanh CTA dính đáy trên mobile: chỉ hiện khi phiếu đặt hàng đã cuộn khuất.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelInView, setPanelInView] = useState(true);
  useEffect(() => {
    // panelRef chỉ tồn tại sau khi loading chuyển false — thiếu `loading`
    // trong deps thì effect chạy một lần lúc ref còn null rồi thôi.
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPanelInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [loading, pricingStrategy, order]);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.product(Number(id));
        setProduct(p);
        // Mặc định chọn gói mua được ngay — không bao giờ mở trang bằng một
        // CTA chết (gói "Liên hệ" 0đ hoặc gói hết hàng chỉ được chọn khi
        // không còn lựa chọn nào khác).
        setSelected(
          p.variants.find(purchasable)
            ?? p.variants.find((v) => v.price > 0)
            ?? p.variants[0]
            ?? null,
        );
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
              // Trùng tên với sản phẩm đang xem → buyer tưởng trang tự lặp lại chính nó.
              if (r.title === p.title) return false;
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
  const selectedOutOfStock = !!selected && instant && selected.stock_count <= 0;
  const useDynamicForm = pricingStrategy != null && pricingStrategy !== "fixed";
  const totalStock = product.variants.reduce((s, v) => s + v.stock_count, 0);
  const sellerName = product.seller_email?.split("@")[0] ?? "seller";
  const contactOnly = !!selected && selected.price === 0;

  const maxQty = selected && instant ? Math.max(1, selected.stock_count) : 999;
  const setQtyClamped = (n: number) => setQty(Math.min(Math.max(1, n), maxQty));
  const pickVariant = (v: Variant) => {
    setSelected(v);
    setPlaceError(null);
    setQty((q) => Math.min(q, v.delivery_mode === "instant" ? Math.max(1, v.stock_count) : 999));
  };

  const specEntries = product.specs ? Object.entries(product.specs) : [];

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">Chợ</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        {product.category_name && (
          <>
            <Link href="/categories" className="hover:text-fg transition-colors shrink-0">{product.category_name}</Link>
            <ChevronRight size={12} className="text-faint shrink-0" />
          </>
        )}
        <span className="text-faint truncate">{product.title}</span>
      </nav>

      {/* Workbench: tài liệu sản phẩm bên trái, phiếu đặt hàng bên phải.
          Hàng 1 (auto) = khối định danh, hàng 2 (1fr) = phần đọc thêm; panel
          span cả hai hàng nên phần cao dư của nó rơi vào track 1fr — không còn
          khoảng trắng chen giữa header và nội dung, không cần đo đạc JS.
          Mobile giữ nguyên thứ tự DOM: định danh → phiếu đặt → đọc thêm. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-7">

        {/* ---- Định danh sản phẩm ---- */}
        <section className="min-w-0">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag tone="iris">{SERVICE_LABELS[product.service_type ?? "other"] ?? "Khác"}</Tag>
              <Tag tone="good">Đang bán</Tag>
              <Tag tone="neutral"><Shield size={11} /> Ký quỹ {product.escrow_days} ngày</Tag>
            </div>

            <h1 className="mt-3 font-serif text-[24px] sm:text-[28px] leading-[1.18] tracking-tight font-semibold">
              {product.title}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[13px] text-muted">
              {product.rating_avg != null && product.rating_count > 0 && (
                <a href="#reviews" className="flex items-center gap-1 hover:text-fg transition-colors">
                  <Star size={13} className="text-warn fill-warn" />
                  <span className="font-semibold text-fg">{product.rating_avg.toFixed(1)}</span>
                  <span className="underline decoration-line-2 underline-offset-2">{product.rating_count} đánh giá</span>
                </a>
              )}
              {product.sold_count > 0 && <span>Đã bán {product.sold_count.toLocaleString("vi-VN")}</span>}
              {totalStock > 0 && <span className="text-good font-medium">{totalStock} sẵn hàng</span>}
            </div>

            {/* Seller */}
            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-line">
              <span className="grid place-items-center h-8 w-8 shrink-0 rounded-full bg-raised border border-line text-[10px] font-bold text-muted">
                {sellerName.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link href={`/sellers/${product.seller_id}`} className="text-[13px] font-medium hover:underline truncate">
                    {sellerName}
                  </Link>
                  <Tag tone="good"><Verified size={10} /> Xác minh</Tag>
                </div>
                <div className="text-[11.5px] text-faint mt-0.5">Gian hàng trên Proxora</div>
              </div>
              <Link
                href={`/sellers/${product.seller_id}`}
                className="shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-iris-hi hover:underline"
              >
                <MessageCircle size={12} /> Nhắn tin
              </Link>
            </div>

            {product.highlight_text && (
              <div className="flex items-start gap-2 mt-4 px-3.5 py-2.5 rounded-lg bg-iris/4 border border-iris/12 text-[12.5px] leading-relaxed">
                <Bolt size={13} className="text-iris-hi shrink-0 mt-0.5" />
                <span>{product.highlight_text}</span>
              </div>
            )}
          </Card>
        </section>

        {/* ---- Phiếu đặt hàng — toàn bộ luồng mua nằm ở một chỗ ---- */}
        <aside className="mt-5 lg:mt-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 min-w-0">
          <div ref={panelRef} className="lg:sticky lg:top-20 scroll-mt-20">
            {useDynamicForm ? (
              order ? (
                <Card className="overflow-hidden shadow-card-lg">
                  <div className="flex items-center justify-between px-5 h-11 bg-ink-panel dotgrid-dark">
                    <span className="text-[12.5px] font-semibold tracking-wide text-white/95">Đặt hàng</span>
                  </div>
                  <div className="p-5">
                    <OrderResult order={order} onRebuy={() => { setOrder(null); setQty(1); }} />
                  </div>
                </Card>
              ) : (
                <DynamicOrderForm productId={Number(id)} product={product} onOrderCreated={setOrder} />
              )
            ) : (
              <Card className="overflow-hidden shadow-card-lg">
                <div className="flex items-center justify-between px-5 h-11 bg-ink-panel dotgrid-dark">
                  <span className="text-[12.5px] font-semibold tracking-wide text-white/95">Đặt hàng</span>
                  {selected && !order && (
                    <Tag tone={instant ? "good" : "warn"}>
                      {instant ? <><Bolt size={10} /> Giao ngay</> : <><Clock size={10} /> Giao trong {selected.sla_hours}h</>}
                    </Tag>
                  )}
                </div>

                <div className="p-5">
                  {order ? <OrderResult order={order} onRebuy={() => { setOrder(null); setQty(1); }} /> : (
                    <div className="space-y-4">
                      {/* Chọn gói — ngay trong phiếu, giá và tổng cùng một cột nhìn */}
                      <fieldset>
                        <legend className="text-[11px] font-semibold text-faint uppercase tracking-wider mb-2">
                          Chọn gói · {product.variants.length}
                        </legend>
                        <div role="radiogroup" className="space-y-1.5 max-h-[304px] overflow-y-auto overscroll-contain pr-0.5">
                          {product.variants.map((v) => {
                            const on = selected?.id === v.id;
                            const oos = v.delivery_mode === "instant" && v.stock_count <= 0;
                            return (
                              <button
                                key={v.id}
                                role="radio"
                                aria-checked={on}
                                disabled={oos}
                                onClick={() => pickVariant(v)}
                                className={cn(
                                  "w-full flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                                  on
                                    ? "border-iris ring-1 ring-iris bg-iris/4"
                                    : "border-line bg-surface hover:border-line-2",
                                  oos && "opacity-55",
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block text-[13px] font-medium leading-snug">{v.name}</span>
                                  <span className="mt-1 flex items-center gap-2 text-[11px] leading-none">
                                    {v.delivery_mode === "instant" ? (
                                      oos
                                        ? <span className="text-bad font-medium">Hết hàng</span>
                                        : <span className="flex items-center gap-1 text-good"><Bolt size={10} /> Giao ngay · Kho {v.stock_count}</span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-warn"><Clock size={10} /> Giao trong {v.sla_hours}h</span>
                                    )}
                                  </span>
                                </span>
                                <span className="font-mono text-[13px] font-semibold tabular shrink-0">
                                  {v.price > 0 ? vnd(v.price) : "Liên hệ"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>

                      {contactOnly ? (
                        <>
                          <p className="border-t border-line pt-3.5 text-[12.5px] text-muted leading-relaxed">
                            Gói theo yêu cầu — thoả thuận cấu hình và giá trực tiếp với người bán trước khi đặt.
                          </p>
                          <Link href={`/sellers/${product.seller_id}`} className="block">
                            <Button size="lg" block>
                              <MessageCircle size={14} /> Liên hệ người bán
                            </Button>
                          </Link>
                        </>
                      ) : (
                        <>
                          {/* Số lượng */}
                          <div className="flex items-center justify-between border-t border-line pt-3.5">
                            <span className="text-[12.5px] text-muted">Số lượng</span>
                            <div className="flex items-center border border-line rounded-lg overflow-hidden">
                              <button
                                aria-label="Giảm số lượng"
                                onClick={() => setQtyClamped(qty - 1)}
                                className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
                              >−</button>
                              <input
                                type="number" min={1} max={maxQty} value={qty} aria-label="Số lượng"
                                onChange={(e) => setQtyClamped(Number(e.target.value) || 1)}
                                className="h-9 w-12 text-center font-mono text-[13px] font-medium border-x border-line bg-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                              <button
                                aria-label="Tăng số lượng"
                                onClick={() => setQtyClamped(qty + 1)}
                                className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
                              >+</button>
                            </div>
                          </div>

                          {/* Tổng — vùng giá duy nhất của trang */}
                          <div className="flex items-end justify-between border-t border-line pt-3.5">
                            <div>
                              <div className="text-[12.5px] text-muted">Tổng cộng</div>
                              {qty > 1 && selected && (
                                <div className="font-mono tabular text-[11px] text-faint mt-1">{qty} × {vnd(selected.price)}</div>
                              )}
                            </div>
                            <span className="font-mono text-[24px] leading-none font-bold tabular text-iris-hi">{vnd(total)}</span>
                          </div>

                          {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}

                          <Button
                            size="lg" block
                            disabled={!selected || placing || (!!account && selectedOutOfStock)}
                            onClick={() => {
                              if (!account) { router.push(`/login?next=/products/${id}`); return; }
                              setShowConfirm(true);
                            }}
                          >
                            {placing ? "Đang xử lý…"
                              : !account ? "Đăng nhập để mua"
                              : selectedOutOfStock ? "Hết hàng"
                              : instant ? "Mua ngay" : "Đặt hàng"}
                          </Button>
                          {!!account && selectedOutOfStock && (
                            <p className="text-[11.5px] text-faint text-center -mt-1.5">
                              Gói này tạm hết hàng — chọn gói khác hoặc liên hệ người bán.
                            </p>
                          )}
                        </>
                      )}

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
        </aside>

        {/* ---- Đọc thêm: thông số → mô tả → bảo hành → đánh giá → liên quan ---- */}
        <div className="min-w-0 mt-7 lg:mt-0 lg:col-start-1 lg:row-start-2 space-y-5">

          {specEntries.length > 0 && (
            <Card className="overflow-hidden">
              <SectionHead title="Thông số kỹ thuật" />
              <dl className="grid sm:grid-cols-2 gap-px bg-line">
                {specEntries.map(([key, val]) => (
                  <div key={key} className="bg-surface px-5 py-3">
                    <dt className="text-[10.5px] uppercase tracking-wider text-faint font-semibold">{fmtKey(key)}</dt>
                    <dd className="mt-1 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">{val}</dd>
                  </div>
                ))}
                {specEntries.length % 2 === 1 && <div className="bg-surface hidden sm:block" aria-hidden />}
              </dl>
            </Card>
          )}

          {(product.description || (product.features && product.features.length > 0)) && (
            <Card className="overflow-hidden">
              <SectionHead title="Mô tả sản phẩm" />
              <div className="p-5 space-y-4 text-[13.5px]">
                {product.description && <MarkdownContent>{product.description}</MarkdownContent>}
                {product.features && product.features.length > 0 && (
                  <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                    {product.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-muted">
                        <Check size={14} className="text-good mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <SectionHead
              title="Bảo hành & ký quỹ"
              aside={<Tag tone="neutral"><Shield size={11} /> {product.escrow_days} ngày</Tag>}
            />
            <div className="p-5 space-y-4 text-[13px]">
              {product.warranty_text ? (
                <div className="text-muted leading-relaxed whitespace-pre-line">{product.warranty_text}</div>
              ) : (
                <p className="text-muted">Áp dụng chính sách ký quỹ {product.escrow_days} ngày theo quy định Proxora.</p>
              )}
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-4 text-muted">
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
          </Card>

          <Card id="reviews" className="overflow-hidden scroll-mt-24">
            <SectionHead
              title="Đánh giá"
              aside={product.rating_count > 0
                ? <span className="text-[12px] text-faint">{product.rating_count} lượt</span>
                : undefined}
            />
            <div className="p-5">
              <ReviewsSection product={product} />
            </div>
          </Card>

          {related.length > 0 && (
            <section>
              <h2 className="font-serif text-[16px] font-semibold tracking-tight mb-3">Sản phẩm liên quan</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {related.map((r) => {
                  const rPrice = effectiveMinPrice(r);
                  return (
                    <Link key={r.id} href={`/products/${r.id}`} className="h-full">
                      <Card interactive className="p-4 h-full flex flex-col">
                        <div className="text-[13.5px] font-medium leading-snug line-clamp-2">{r.title}</div>
                        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-faint">
                          {r.rating_avg != null && r.rating_count > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] text-muted">
                              <Star size={11} className="text-warn fill-warn" />
                              {r.rating_avg.toFixed(1)}
                            </span>
                          )}
                          {r.sold_count > 0 && <span>Đã bán {r.sold_count}</span>}
                          <Tag tone="iris">{SERVICE_LABELS[r.service_type ?? "other"] ?? "Khác"}</Tag>
                        </div>
                        <div className="mt-auto pt-3 flex items-baseline justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-faint font-medium">Chỉ từ</span>
                          <span className="font-mono text-[14px] font-semibold tabular text-iris-hi">
                            {rPrice > 0 ? vnd(rPrice) : "Báo giá"}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Thanh CTA dính đáy — mobile, khi phiếu đặt hàng đã cuộn khuất */}
      {!order && (
        <div
          aria-hidden={panelInView}
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 lg:hidden flex items-center gap-3",
            "border-t border-line bg-surface/95 backdrop-blur-md",
            "px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]",
            "transition-transform duration-200",
            panelInView ? "translate-y-full pointer-events-none" : "translate-y-0",
          )}
        >
          <div className="min-w-0 flex-1">
            {!useDynamicForm && selected && selected.price > 0 ? (
              <>
                <div className="text-[10.5px] uppercase tracking-wider text-faint">Tổng cộng</div>
                <div className="font-mono text-[16px] font-bold tabular leading-tight">{vnd(total)}</div>
              </>
            ) : (
              <div className="text-[12.5px] text-muted truncate">{product.title}</div>
            )}
          </div>
          <Button
            tabIndex={panelInView ? -1 : 0}
            onClick={() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Đặt hàng
          </Button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            role="dialog" aria-modal="true" aria-label="Xác nhận đơn hàng"
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
   Section chrome
   ================================================================ */

function SectionHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
      <h2 className="font-serif text-[16px] font-semibold tracking-tight">{title}</h2>
      {aside}
    </div>
  );
}

/* ================================================================
   Reviews
   ================================================================ */

function ReviewsSection({ product }: { product: ProductDetail }) {
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

/* ================================================================
   Post-purchase
   ================================================================ */

const ORDER_POLL_MS = 3000;
// Backend refunds and cancels an order it cannot provision within 15 minutes,
// so there is nothing left to watch for after that.
const ORDER_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const STATUS_LABEL: Record<string, string> = {
  pending: "Đang xử lý",
  processing: "Đang xử lý",
  delivered: "Đã giao",
  completed: "Hoàn tất",
  disputed: "Đang khiếu nại",
  refunded: "Đã hoàn tiền",
  cancelled: "Đã huỷ",
};

const STATUS_TONE: Record<string, "good" | "warn" | "bad"> = {
  pending: "warn",
  processing: "warn",
  delivered: "good",
  completed: "good",
  disputed: "bad",
  refunded: "bad",
  cancelled: "bad",
};

/** Orders provisioned through an external provider come back `pending` — the
 *  provider call runs after the request returns — so watch until it settles.
 *  Only those: a manual variant order is also `pending`, but it waits on the
 *  seller for up to their SLA in hours, so polling it would spin for nothing. */
function useOrderPolling(initial: Order, enabled: boolean) {
  const [order, setOrder] = useState(initial);

  useEffect(() => setOrder(initial), [initial]);

  const settled = order.status !== "pending";
  useEffect(() => {
    if (settled || !enabled) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > ORDER_POLL_TIMEOUT_MS) {
        clearInterval(timer);
        return;
      }
      try {
        const fresh = await api.getOrder(order.id);
        if (fresh.status !== "pending") clearInterval(timer);
        setOrder(fresh);
      } catch {
        // A failed poll is not worth surfacing — the next tick retries, and the
        // sweeper settles the order server-side regardless.
      }
    }, ORDER_POLL_MS);
    return () => clearInterval(timer);
  }, [order.id, settled, enabled]);

  return order;
}

/** Đồng hồ "đang xử lý · m:ss" — tín hiệu tác vụ còn sống, đếm từ lúc đặt đơn. */
function useElapsed(since: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Tiến trình provision 3 bước: tiền đã trừ (xong ngay khi đơn tồn tại) →
 *  gọi nhà cung cấp (đang chạy) → bàn giao dữ liệu (chờ). */
function ProvisionSteps({ elapsed }: { elapsed: string }) {
  return (
    <div role="status" aria-live="polite" className="relative pl-7">
      <div className="absolute left-[8px] top-2.5 bottom-2.5 w-px bg-line" />

      <div className="relative pb-3">
        <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
          <Check size={10} />
        </span>
        <p className="text-[12.5px] text-muted">Đã thanh toán từ ví</p>
      </div>

      <div className="relative pb-3">
        <span className="absolute -left-7 top-[1px] h-[17px] w-[17px] rounded-full border-2 border-warn/25 border-t-warn bg-surface animate-spin-ring" />
        <p className="text-[12.5px] font-medium text-fg">
          Đang lấy hàng từ nhà cung cấp
          <span className="ml-1.5 font-mono text-[11px] font-normal text-faint tabular-nums">{elapsed}</span>
        </p>
      </div>

      <div className="relative">
        <span className="absolute -left-7 top-[1px] h-[17px] w-[17px] rounded-full border border-line-2 bg-surface" />
        <p className="text-[12.5px] text-faint">Bàn giao thông tin sản phẩm</p>
      </div>
    </div>
  );
}

function OrderResult({ order: initial, onRebuy }: { order: Order; onRebuy: () => void }) {
  // product_id (rather than variant_id) means a provider adapter fulfils this one.
  const viaProvider = initial.product_id != null;
  const order = useOrderPolling(initial, viaProvider);
  const [copied, setCopied] = useState(false);
  const copyData = () => {
    if (order.delivered_data) {
      navigator.clipboard.writeText(order.delivered_data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const pending = order.status === "pending";
  const failed = order.status === "cancelled" || order.status === "refunded";
  const working = pending && viaProvider;
  const elapsed = useElapsed(order.created_at, working);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* key theo status để icon chạy lại hiệu ứng khi đơn chuyển trạng thái */}
        <span key={order.status} className={`relative ${!pending ? "animate-seal" : ""}`}>
          {working && (
            <span
              aria-hidden
              className="absolute -inset-1 rounded-full border-2 border-warn/20 border-t-warn animate-spin-ring"
            />
          )}
          <span
            className={`grid place-items-center h-9 w-9 rounded-full border ${
              pending
                ? "bg-warn-soft text-warn border-warn/25"
                : failed
                ? "bg-bad-soft text-bad border-bad/25"
                : "bg-good-soft text-good border-good/25"
            }`}
          >
            {pending ? <Clock size={16} /> : failed ? <X size={16} /> : <Check size={16} />}
          </span>
        </span>
        <div>
          <div className="text-[13.5px] font-medium">Đơn #{order.id}</div>
          <Tag tone={STATUS_TONE[order.status] ?? "warn"}>{STATUS_LABEL[order.status] ?? order.status}</Tag>
        </div>
      </div>

      {pending ? (
        viaProvider ? (
          <div className="space-y-3.5">
            <ProvisionSteps elapsed={elapsed} />

            {/* Chỗ dữ liệu bàn giao sẽ hiện ra — shimmer để hứa trước vị trí */}
            <div className="rounded-lg border border-line bg-raised/60 p-3">
              <p className="text-[11px] text-faint uppercase tracking-wider mb-2">Thông tin bàn giao</p>
              <div className="space-y-1.5" aria-hidden>
                <div className="h-3 w-3/4 rounded bg-line/70 animate-shimmer" />
                <div className="h-3 w-1/2 rounded bg-line/70 animate-shimmer" />
              </div>
            </div>

            <p className="text-[11.5px] text-faint">
              Trang tự cập nhật khi xong — bạn không cần tải lại. Nếu quá 15 phút không lấy được hàng,
              tiền sẽ tự hoàn về ví.
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Người bán sẽ giao trong thời hạn SLA.</p>
        )
      ) : failed ? (
        <div className="space-y-3.5">
          {viaProvider ? (
            /* Cùng bố cục timeline với trạng thái chờ — kể nốt câu chuyện:
               tiền đã trừ → lấy hàng thất bại → tiền đã về ví */
            <div className="relative pl-7">
              <div className="absolute left-[8px] top-2.5 bottom-2.5 w-px bg-line" />

              <div className="relative pb-3">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
                  <Check size={10} />
                </span>
                <p className="text-[12.5px] text-muted">Đã thanh toán từ ví</p>
              </div>

              <div className="relative pb-3">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-bad/30 bg-bad-soft text-bad">
                  <X size={10} />
                </span>
                <p className="text-[12.5px] font-medium text-fg">Nhà cung cấp không cấp được hàng</p>
                {order.cancel_reason && (
                  <p className="mt-0.5 text-[11.5px] text-faint">{order.cancel_reason}</p>
                )}
              </div>

              <div className="relative">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
                  <Check size={10} />
                </span>
                <p className="text-[12.5px] text-muted">Đã hoàn tiền về ví</p>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">
              Đơn đã {order.status === "refunded" ? "được hoàn tiền" : "bị huỷ"}.
            </p>
          )}

          {/* Điều người dùng lo nhất: tiền đâu — trả lời to, rõ, kèm số tiền */}
          <div className="flex items-start gap-2.5 rounded-lg border border-good/25 bg-good-soft p-3 animate-rise">
            <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good/15 text-good">
              <Check size={13} />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-good">
                Đã hoàn {vnd(order.total_amount)} về ví của bạn
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Tiền về thẳng số dư khả dụng — bạn có thể đặt lại ngay.
              </p>
            </div>
          </div>
        </div>
      ) : order.delivered_data ? (
        <div className="animate-rise">
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
        {failed ? (
          /* Tiền đã về ví — hành động tự nhiên nhất là đặt lại; nút phụ để tự kiểm chứng tiền hoàn */
          <>
            <Button size="sm" block onClick={onRebuy} className="flex-1">Thử đặt lại</Button>
            <Link href="/wallet" className="flex-1"><Button variant="secondary" block size="sm">Kiểm tra ví</Button></Link>
          </>
        ) : (
          <>
            <Link href="/orders" className="flex-1"><Button variant="secondary" block size="sm">Xem đơn hàng</Button></Link>
            <Button variant="secondary" size="sm" onClick={onRebuy} className="flex-1">Mua thêm</Button>
          </>
        )}
      </div>
    </div>
  );
}
