"use client";

/** In-row editor for a made-to-order package's "units accepted" (the number
 *  buyers see as "còn N"): blank = no limit. Saves through the variant PATCH
 *  the product editor uses, then refreshes every inventory view. */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { Edit2 } from "@/components/Icons";
import { MANUAL_STOCK_CEILING, parseManualStock } from "@/lib/stock";
import { useInvalidateInventory } from "../useInventory";

export function ManualStockEdit({ variantId, value, disabled = false }: {
  variantId: number;
  value: number | null;
  disabled?: boolean;
}) {
  const t = useTranslations("sellerInventory.table");
  const tc = useTranslations("common");
  const invalidate = useInvalidateInventory();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const start = () => { setDraft(value == null ? "" : String(value)); setError(false); setOpen(true); };
  const save = async () => {
    setSaving(true);
    setError(false);
    try {
      await api.updateVariant(variantId, { manual_stock: parseManualStock(draft) });
      await invalidate(variantId);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button" onClick={() => (open ? setOpen(false) : start())} disabled={disabled}
        title={t("manualStockLabel")} aria-expanded={open}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-line-2 bg-raised px-2 text-[11.5px] font-medium text-fg hover:border-faint disabled:pointer-events-none disabled:opacity-50"
      >
        <Edit2 size={12} /> {t("editManualStock")}
      </button>
      {open && (
        <form
          className="absolute right-0 top-full z-20 mt-1 flex w-max items-center gap-1 rounded-lg border border-line bg-surface p-2 shadow-card-lg"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        >
          <Input
            autoFocus type="number" min={0} max={MANUAL_STOCK_CEILING} value={draft}
            placeholder={t("manualUnlimited")} aria-label={t("manualStockLabel")}
            aria-invalid={error || undefined}
            onChange={(e) => setDraft(e.target.value)}
            className="h-7 w-24 text-[12px]"
          />
          <Button type="submit" size="sm" className="h-7 px-2 text-[11.5px]" disabled={saving}>{saving ? t("saving") : t("save")}</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-[11.5px]" onClick={() => setOpen(false)} disabled={saving}>{tc("cancel")}</Button>
          {error && <span role="alert" className="text-[11px] text-bad">{t("manualStockFailed")}</span>}
        </form>
      )}
    </span>
  );
}
