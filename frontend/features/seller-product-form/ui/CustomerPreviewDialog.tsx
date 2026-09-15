"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Eye, X } from "@/components/Icons";
import { ChevronRight } from "@/components/Icons";
import { DescriptionCard, ProductIdentity, SpecsPlate, WarrantyCard } from "@/app/[locale]/products/[id]/sections";

type Device = "desktop" | "mobile";

/** Full-page "view as a customer" — the real storefront sections fed with
 *  unsaved form state, under a banner that says so. Links inside are
 *  neutralised so a stray click never leaves the editor. */
export function CustomerPreviewDialog({
  open, onClose, product, orderPanel, unsaved,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductDetail;
  orderPanel: ReactNode;
  unsaved: boolean;
}) {
  const t = useTranslations("sellerProductForm.preview");
  const tc = useTranslations("common");
  const [device, setDevice] = useState<Device>("desktop");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="left-0 top-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-base p-0 text-fg data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 [&>button:last-child]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 bg-ink-panel px-4 py-2.5 text-white sm:px-6">
            <Eye size={15} />
            <DialogTitle className="text-[13px] font-semibold text-white">{t("title")}</DialogTitle>
            <span className="text-[12px] text-white/70">· {unsaved ? t("unsavedNote") : t("savedNote")}</span>
            <div role="tablist" aria-label={t("deviceLabel")} className="ml-auto inline-flex rounded-md border border-white/20 p-0.5">
              {(["desktop", "mobile"] as Device[]).map((d) => (
                <button key={d} type="button" role="tab" aria-selected={device === d} onClick={() => setDevice(d)} className={cn("rounded px-2.5 py-0.5 text-[11.5px] font-medium", device === d ? "bg-white text-ink-panel" : "text-white/80 hover:text-white")}>
                  {t(`device.${d}`)}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} aria-label={tc("close")} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-6">
            <div
              onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) e.preventDefault(); }}
              className={cn("mx-auto w-full px-4 sm:px-6", device === "desktop" ? "max-w-[1200px]" : "max-w-[420px] rounded-[28px] border-[6px] border-line-2 bg-base py-4 shadow-card-lg")}
            >
              <nav className="mb-4 flex items-center gap-1.5 text-[12.5px] text-muted">
                <span className="shrink-0">{tc("marketplace")}</span>
                <ChevronRight size={12} className="shrink-0 text-faint" />
                {product.category_name && (<><span className="shrink-0">{product.category_name}</span><ChevronRight size={12} className="shrink-0 text-faint" /></>)}
                <span className="truncate text-faint">{product.title || t("untitled")}</span>
              </nav>
              <div className={cn(device === "desktop" && "lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-7")}>
                <section className="min-w-0 pointer-events-none">
                  <ProductIdentity product={{ ...product, title: product.title || t("untitled") }} />
                </section>
                <aside className={cn("mt-5 min-w-0", device === "desktop" && "lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:mt-0")}>
                  <div className={cn(device === "desktop" && "lg:sticky lg:top-0")}>{orderPanel}</div>
                </aside>
                <div className={cn("mt-7 min-w-0 space-y-5", device === "desktop" && "lg:col-start-1 lg:row-start-2 lg:mt-0")}>
                  {product.specs && <SpecsPlate specs={product.specs} />}
                  <DescriptionCard product={product} />
                  <WarrantyCard product={product} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
