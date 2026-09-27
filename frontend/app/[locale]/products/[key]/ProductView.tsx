"use client";

/** Product detail — catalog. */

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, Spinner } from "@/components/ui";
import { ChevronRight, Eye } from "@/components/Icons";
import DynamicOrderForm from "@/components/DynamicOrderForm";
import { useProductDetail } from "./useProductDetail";
import { usePurchase } from "./usePurchase";
import { panelMode } from "./purchase";
import OrderPanel, { PanelShell } from "./OrderPanel";
import OrderResult from "./OrderResult";
import MobileBuyBar from "./MobileBuyBar";
import ReviewsCard from "./ReviewsCard";
import { DescriptionCard, ProductIdentity, RelatedProducts, SpecsPlate, WarrantyCard } from "./sections";
import { DeliveryCard, FaqCard, KeyFacts, PayInsideNotice, SectionNav, SellerCard, type ProductSection } from "./trust";
import { ProductQuestions } from "@/features/product-questions";
import type { ProductPageCatalog } from "@/features/catalog";
import { categoryPath, sellerProductPath } from "@/lib/routes";

const STATUS_KEYS = { draft: 1, paused: 1, suspended: 1, active: 1 };

export default function ProductView({ initial, productRef }: { initial: ProductPageCatalog; productRef: string }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const { product, related, seller, sameShop, pricingStrategy, loading, error, preview, refresh } = useProductDetail(productRef, initial);
  const purchase = usePurchase(product, refresh);
  const useDynamicForm = pricingStrategy != null && pricingStrategy !== "fixed";

  const panelRef = useRef<HTMLDivElement>(null);
  const [panelInView, setPanelInView] = useState(true);
  useEffect(() => {
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
        <p className="text-bad">{error ?? t("notFound")}</p>
        <Link href="/" className="inline-block mt-3 text-iris-hi hover:underline text-[13px]">{t("backHome")}</Link>
      </Card>
    </div>
  );

  const hasDescription = !!product.description || !!(product.features && product.features.length > 0);
  const hasSpecs = !!product.specs && Object.keys(product.specs).length > 0;
  const sections: ProductSection[] = [
    ...(hasDescription ? [{ id: "description", label: t("navDescription") }] : []),
    ...(hasSpecs ? [{ id: "specs", label: t("navSpecs") }] : []),
    { id: "delivery", label: t("navDelivery") },
    { id: "reviews", label: t("navReviews") },
    ...(!preview ? [{ id: "qa", label: t("navQa") }] : []),
    ...(product.faq && product.faq.length > 0 ? [{ id: "faq", label: t("navFaq") }] : []),
  ];

  const barTotal = !useDynamicForm && purchase.selected && panelMode(purchase.selected) === "buy"
    ? purchase.total
    : null;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      {preview && (
        <Banner
          tone="warn"
          icon={<Eye size={15} />}
          title={t("preview.title")}
          className="mb-4"
          action={
            <Link
              href={preview === "admin" ? `/admin/products/${product.id}` : sellerProductPath(product)}
              className="text-[12.5px] font-medium underline underline-offset-2"
            >
              {t("preview.manage")}
            </Link>
          }
        >
          {t("preview.body", { status: t(`preview.status.${product.status in STATUS_KEYS ? product.status : "draft"}`) })}
        </Banner>
      )}
      <nav aria-label={tc("breadcrumb")} className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">{tc("marketplace")}</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        {product.category_name && (
          <>
            <Link href={categoryPath({ id: product.category_id, slug: product.category_slug })} className="hover:text-fg transition-colors shrink-0">{product.category_name}</Link>
            <ChevronRight size={12} className="text-faint shrink-0" />
          </>
        )}
        <span className="text-faint min-w-0 truncate">{product.title}</span>
      </nav>

      {!preview && <PayInsideNotice days={product.escrow_days} />}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-7">
        <section className="min-w-0 space-y-4">
          <ProductIdentity product={product} />
          <KeyFacts product={product} />
        </section>

        <aside className="mt-5 lg:mt-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 min-w-0">
          {/* Xem trước: khung đặt hàng chỉ để nhìn — backend cũng từ chối đơn
              cho sản phẩm chưa mở bán. */}
          <div ref={panelRef} inert={preview != null} aria-disabled={preview != null || undefined}
            className={`lg:sticky lg:top-20 scroll-mt-20${preview ? " opacity-60 select-none" : ""}`}>
            {useDynamicForm ? (
              purchase.order ? (
                <PanelShell title={t("orderPanel")}>
                  <OrderResult order={purchase.order} onRebuy={purchase.rebuy} fulfillment={product.pricing_strategy} inspectionSteps={product.inspection_steps} />
                </PanelShell>
              ) : (
                <DynamicOrderForm productId={product.id} product={product} onOrderCreated={purchase.onOrderCreated} />
              )
            ) : (
              <OrderPanel product={product} purchase={purchase} fulfillment={product.pricing_strategy} />
            )}
          </div>
        </aside>

        <div className="min-w-0 mt-7 lg:mt-0 lg:col-start-1 lg:row-start-2 space-y-5">
          <SectionNav sections={sections} />
          {hasDescription && <div id="description" className="scroll-mt-28"><DescriptionCard product={product} /></div>}
          {hasSpecs && <div id="specs" className="scroll-mt-28"><SpecsPlate specs={product.specs!} /></div>}
          <DeliveryCard product={product} />
          <WarrantyCard product={product} />
          <ReviewsCard product={product} />
          {!preview && <ProductQuestions productId={product.id} />}
          <FaqCard product={product} />
          {seller && <SellerCard seller={seller} />}
          <RelatedProducts items={sameShop} title={t("sameShop")} />
          <RelatedProducts items={related} />
        </div>
      </div>

      {!purchase.order && !preview && (
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
