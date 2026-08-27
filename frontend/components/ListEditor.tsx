"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { Plus, X } from "@/components/Icons";

/* Danh sách có thể thêm/xoá từng dòng — thay cho textarea gõ tay theo cú
   pháp (mỗi dòng 1 tính năng, hoặc "key: value"). Trước đây 1 dòng gõ sai cú
   pháp (thiếu dấu ":") bị ÂM THẦM bỏ qua lúc lưu, seller không biết.
   Dùng chung giữa trang sửa sản phẩm của seller và admin. */
export function ListEditor<T>({
  label, hint, items, onAdd, onRemove, addLabel, emptyText, renderRow,
}: {
  label: string; hint?: string; items: T[];
  onAdd: () => void; onRemove: (index: number) => void;
  addLabel: string; emptyText: string;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {hint && <span className="text-[12px] text-faint">{hint}</span>}
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-[12.5px] text-faint italic py-1">{emptyText}</p>}
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">{renderRow(item, i)}</div>
            <button type="button" aria-label={t("delete")} onClick={() => onRemove(i)}
              className="shrink-0 grid place-items-center h-9 w-9 rounded-lg text-faint hover:text-bad hover:bg-bad-soft transition-colors cursor-pointer">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" className="self-start" onClick={onAdd}>
        <Plus size={13} /> {addLabel}
      </Button>
    </div>
  );
}
