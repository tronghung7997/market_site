"use client";

import { cn } from "@/lib/cn";
import {
  COVER_GROUPS,
  COVER_LABELS,
  type CoverId,
} from "@/lib/product-covers";
import { Button } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";

const GROUP_LABELS = {
  social: { vi: "Mạng xã hội", en: "Social" },
  infra: { vi: "Hạ tầng", en: "Infra" },
  service: { vi: "Dịch vụ", en: "Service" },
} as const;

export function CoverPicker({
  value,
  onChange,
  locale = "vi",
}: {
  value: string | null;
  onChange: (id: CoverId | null) => void;
  locale?: "vi" | "en";
}) {
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant={value == null ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onChange(null)}
        className={value == null ? "border-iris bg-iris-soft text-iris-hi" : undefined}
      >
        {locale === "vi" ? "Tự động theo tên" : "Infer from name"}
      </Button>
      {(Object.keys(COVER_GROUPS) as Array<keyof typeof COVER_GROUPS>).map((group) => (
        <div key={group}>
          <div className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {GROUP_LABELS[group][locale]}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {COVER_GROUPS[group].map((id) => {
              const selected = value === id;
              return (
                <Button
                  key={id}
                  type="button"
                  variant="secondary"
                  onClick={() => onChange(id)}
                  className={cn(
                    "h-auto flex-col whitespace-normal px-2 py-2",
                    selected && "border-iris bg-iris-soft",
                  )}
                >
                  <ProductCover coverId={id} title={COVER_LABELS[id][locale]} className="h-10 w-10" />
                  <span className="text-[11px] font-medium leading-tight text-muted">
                    {COVER_LABELS[id][locale]}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
