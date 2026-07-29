"use client";

/* Hallmark · genre: modern-minimal · macrostructure: Workbench (commerce two-column:
 * document left, order-slip right) · theme: preserved project system (Proxora light —
 * Newsreader / Be Vietnam Pro / JetBrains Mono, iris accent) · enrichment: none —
 * function carries the page · pre-emit critique: P4 H5 E4 S4 R5 V4
 */

/** Trang chi tiết sản phẩm — file này chỉ là MỤC LỤC: gọi 2 hook rồi xếp chỗ.
 *
 *  - Data:        useProductDetail (fetch) · usePurchase (state machine mua)
 *  - Luật mua:    purchase.ts (hàm thuần — gói mặc định, trần qty, trạng thái nút)
 *  - Phiếu đặt:   OrderPanel (variant cố định) / DynamicOrderForm (pricing động)
 *  - Hậu-mua:     OrderResult (poll + timeline + bàn giao)
 *  - Tài liệu:    sections.tsx + ReviewsCard
 *  - Mobile:      MobileBuyBar (hiện khi phiếu cuộn khuất, theo IntersectionObserver)
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import { ChevronRight } from "@/components/Icons";
import DynamicOrderForm from "@/components/DynamicOrderForm";
import { useProductDetail } from "./useProductDetail";
import { usePurchase } from "./usePurchase";
import { panelMode } from "./purchase";
import OrderPanel, { PanelShell } from "./OrderPanel";
import OrderResult from "./OrderResult";
import MobileBuyBar from "./MobileBuyBar";
import ReviewsCard from "./ReviewsCard";
import { DescriptionCard, ProductIdentity, RelatedProducts, SpecsPlate, WarrantyCard } from "./sections";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { product, related, pricingStrategy, loading, error } = useProductDetail(Number(id));
  const purchase = usePurchase(product);
  const useDynamicForm = pricingStrategy != null && pricingStrategy !== "fixed";

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
  }, [loading, pricingStrategy, purchase.order]);

  if (loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-20"><Spinner /></div>;
  if (error || !product) return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
      <Card className="p-6 text-sm">
        <p className="text-bad">{error ?? "Không tìm thấy"}</p>
        <Link href="/" className="inline-block mt-3 text-iris-hi hover:underline text-[13px]">← Về chợ</Link>
      </Card>
    </div>
  );

  const barTotal = !useDynamicForm && purchase.selected && panelMode(purchase.selected) === "buy"
    ? purchase.total
    : null;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">Chợ</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        {product.category_name && (
          <>
            <Link href={`/categories/${product.category_id}`} className="hover:text-fg transition-colors shrink-0">{product.category_name}</Link>
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

        <section className="min-w-0">
          <ProductIdentity product={product} />
        </section>

        {/* Phiếu đặt hàng — toàn bộ luồng mua ở một chỗ, sticky theo scroll */}
        <aside className="mt-5 lg:mt-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 min-w-0">
          <div ref={panelRef} className="lg:sticky lg:top-20 scroll-mt-20">
            {useDynamicForm ? (
              purchase.order ? (
                <PanelShell title="Đặt hàng">
                  <OrderResult order={purchase.order} onRebuy={purchase.rebuy} />
                </PanelShell>
              ) : (
                <DynamicOrderForm productId={product.id} product={product} onOrderCreated={purchase.onOrderCreated} />
              )
            ) : (
              <OrderPanel product={product} purchase={purchase} />
            )}
          </div>
        </aside>

        {/* Cột tài liệu: thông số → mô tả → bảo hành → đánh giá → liên quan */}
        <div className="min-w-0 mt-7 lg:mt-0 lg:col-start-1 lg:row-start-2 space-y-5">
          {product.specs && <SpecsPlate specs={product.specs} />}
          <DescriptionCard product={product} />
          <WarrantyCard product={product} />
          <ReviewsCard product={product} />
          <RelatedProducts items={related} />
        </div>
      </div>

      {!purchase.order && (
        <MobileBuyBar
          visible={!panelInView}
          total={barTotal}
          fallbackText={product.title}
          onGoToPanel={() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      )}
    </div>
  );
}
