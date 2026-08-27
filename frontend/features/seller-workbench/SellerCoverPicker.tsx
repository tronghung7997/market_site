"use client";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { COVER_IDS, type CoverId, coverSrc } from "@/lib/product-covers";
import { useTranslations } from "next-intl";

const COVER_LABELS: Partial<Record<CoverId, string>> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  telegram: "Telegram",
  youtube: "YouTube",
  x: "X / Twitter",
  proxy: "Proxy",
  token: "Token",
  endpoint: "Endpoint",
  cloud: "Cloud",
  takedown: "Takedown",
};

export function SellerCoverPicker({
  selectedCoverId,
  onChange,
}: {
  selectedCoverId: string | null | undefined;
  onChange: (id: CoverId) => void;
}) {
  const t = useTranslations("seller.workbench");

  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-bold uppercase tracking-wider text-muted">
        {t("coverTitle")}
      </label>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
        {COVER_IDS.map((id) => {
          const on = (selectedCoverId || "other") === id;
          const src = coverSrc(id);
          const label = COVER_LABELS[id] || t(`cover_${id}`);

          return (
            <Button
              type="button"
              variant="ghost"
              key={id}
              aria-pressed={on}
              onClick={() => onChange(id)}
              className={cn(
                "!h-auto !whitespace-normal p-2 rounded-xl border flex flex-col items-center gap-1.5 select-none",
                on
                  ? "border-iris bg-iris-soft/40 ring-1 ring-iris text-fg shadow-xs"
                  : "border-line bg-surface hover:border-line-2 hover:bg-raised text-muted",
              )}
            >
              <div className="w-10 h-10 rounded-lg overflow-hidden border border-line bg-surface flex items-center justify-center p-1">
                {src ? (
                  <img
                    src={src}
                    alt={label}
                    width={40}
                    height={40}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[12px] font-bold">SP</span>
                )}
              </div>
              <span className="text-[11px] font-medium text-center truncate w-full">
                {label}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
