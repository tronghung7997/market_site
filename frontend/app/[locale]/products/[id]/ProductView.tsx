"use client";

/** Product detail — catalog. */

import { Link } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
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
import type { ProductPageCatalog } from "@/features/catalog";

export default function ProductView({ initial }: { initial: ProductPageCatalog }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { product, related, pricingStrategy, loading, error } = useProductDetail(Number(id), initial);
  const purchase = usePurchase(product);
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

  const barTotal = !useDynamicForm && purchase.selected && panelMode(purchase.selected) === "buy"
    ? purchase.total
    : null;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      <nav aria-label={tc("breadcrumb")} className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">{tc("marketplace")}</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        {product.category_name && (
          <>
            <Link href={`/categories/${product.category_id}`} className="hover:text-fg transition-colors shrink-0">{product.category_name}</Link>
            <ChevronRight size={12} className="text-faint shrink-0" />
          </>
        )}
        <span className="text-faint truncate">{product.title}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-7">
        <section className="min-w-0">
          <ProductIdentity product={product} />
        </section>

        <aside className="mt-5 lg:mt-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 min-w-0">
          <div ref={panelRef} className="lg:sticky lg:top-20 scroll-mt-20">
            {useDynamicForm ? (
              purchase.order ? (
                <PanelShell title={t("orderPanel")}>
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
