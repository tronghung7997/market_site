"use client";

import { vnd } from "@/lib/api";
import { useTranslations } from "next-intl";
import { formatSpecKey } from "@/lib/utils";
import { serviceLabel } from "@/lib/labels";
import { parseCoverId } from "@/lib/product-covers";
import type { Variant } from "@/lib/types";
import { Banner, Card, Tag } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Bolt, Check, Eye, Info, Shield } from "@/components/Icons";

export const STATUS_TAG: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  active: { label: "Đang bán", tone: "good" },
  draft: { label: "Nháp", tone: "neutral" },
  paused: { label: "Tạm dừng", tone: "warn" },
  suspended: { label: "Bị khoá", tone: "bad" },
};
const STATUS_LABEL_KEYS: Record<string, string> = {
  active: "activeStatus",
  draft: "draftStatus",
  paused: "pausedStatus",
  suspended: "suspendedStatus",
};

/* Xem trước — render lại đúng khuôn trang mua (app/products/[id]/page.tsx:
   header + highlight + specs + mô tả + tính năng + bảo hành) để seller hình
   dung ngay khách sẽ thấy gì, không phải rời trang bấm "Xem trang mua".
   Dùng chung formatSpecKey với trang mua — sai khác 1 ly là preview nói dối.
   Dùng ở cả trang tạo mới lẫn trang sửa sản phẩm. */
export function ProductPreviewCard({
  title, categoryName, serviceType, status, escrowDays,
  highlightText, description, features, specs, warrantyText, variants, coverId,
}: {
  title: string; categoryName?: string; serviceType: string; status: string; escrowDays: number;
  highlightText: string; description: string; features: string[];
  specs: { key: string; value: string }[]; warrantyText: string; variants: Variant[];
  coverId?: string | null;
}) {
  const t = useTranslations("seller");
  const cleanFeatures = features.filter((f) => f.trim());
  const cleanSpecs = specs.filter((s) => s.key.trim());
  const minPrice = variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : null;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line bg-raised/40 flex items-center gap-2">
        <Eye size={13} className="text-faint" />
        <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">{t("previewTitle")}</span>
      </div>

      {status !== "active" && (
        <div className="px-4 pt-3">
          <Banner tone="warn" icon={<Info size={14} />}>
            {t("previewStatusWarning", { status: t(STATUS_LABEL_KEYS[status] ?? "status"), active: t("activeStatus") })}
          </Banner>
        </div>
      )}

      <div className="p-4 space-y-3.5">
        <div className="flex items-start gap-2.5">
          <ProductCover coverId={parseCoverId(coverId)} title={title.trim() || "SP"} />
          <div className="min-w-0 flex-1">
            <h4 className="font-serif text-[15px] leading-tight tracking-tight font-semibold break-words">
              {title.trim() || <span className="text-faint italic font-sans font-normal text-[13px]">{t("previewUnnamed")}</span>}
            </h4>
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {categoryName && <Tag tone="iris">{categoryName}</Tag>}
              <Tag tone="neutral">{serviceLabel(serviceType)}</Tag>
            </div>
          </div>
        </div>

        {minPrice != null && (
          <div className="pt-3 border-t border-line">
            <span className="font-mono text-[18px] font-bold tabular text-iris-hi">
              {variants.length > 1 ? `${t("previewFrom")} ` : ""}{vnd(minPrice)}
            </span>
          </div>
        )}

        {highlightText.trim() && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-iris/4 border border-iris/10 text-[12.5px]">
            <Bolt size={12} className="text-iris-hi shrink-0" />
            <span>{highlightText}</span>
          </div>
        )}

        {description.trim() && <MarkdownContent>{description}</MarkdownContent>}

        {cleanFeatures.length > 0 && (
          <ul className="space-y-1">
            {cleanFeatures.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-muted">
                <Check size={12} className="text-good mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}

        {cleanSpecs.length > 0 && (
          <div className="rounded-lg border border-line overflow-hidden">
            <div className="divide-y divide-line">
              {cleanSpecs.map((s, i) => (
                <div key={i} className="flex text-[12px]">
                  <span className="w-[92px] shrink-0 px-2.5 py-1.5 text-muted bg-raised/40">{formatSpecKey(s.key.trim())}</span>
                  <span className="px-2.5 py-1.5 flex-1 break-words">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {warrantyText.trim() && (
          <div className="pt-3 border-t border-line">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">{t("warrantyLabel")}</div>
            <p className="text-[12px] text-muted leading-relaxed whitespace-pre-line">{warrantyText}</p>
          </div>
        )}

        <div className="pt-3 border-t border-line flex items-center gap-1.5 text-[11.5px] text-faint">
          <Shield size={11} /> {t("previewEscrow", { days: escrowDays })}
        </div>
      </div>
    </Card>
  );
}
