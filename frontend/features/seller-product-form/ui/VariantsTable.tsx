"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { ProductLocale } from "@/lib/types";
import { Button, Input, Select, Tag } from "@/components/ui";
import { Edit2, Eye, EyeOff, Plus, Rows } from "@/components/Icons";
import { Switch } from "@/features/seller-inventory/ui/InventoryConsole";
import type { WorkbenchVariant } from "@/features/seller-workbench/logic";
import { SellerPriceInput, useSellerPriceCurrency } from "@/features/seller-workbench/SellerPriceInput";
import { moveVariant } from "../model";
import { LocaleTag } from "./BasicsFields";

export interface VariantDraft { name: string; price: number; delivery_mode: "instant" | "manual"; sla_hours: number }
export interface VariantStats { sold: number; error: number }

function Editor({ initial, contentLocale, primaryLocale, pending, onSave, onCancel }: {
  initial: VariantDraft; contentLocale: ProductLocale; primaryLocale: ProductLocale; pending: boolean;
  onSave: (draft: VariantDraft) => void; onCancel: () => void;
}) {
  const t = useTranslations("sellerProductForm.variants");
  const tc = useTranslations("common");
  const { currency } = useSellerPriceCurrency();
  const [draft, setDraft] = useState(initial);
  const valid = draft.name.trim().length > 0 && draft.price >= 0;
  return (
    <div className="space-y-3 bg-iris-soft/20 p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_170px_110px]">
        <div>
          <label className="mb-1 flex items-center justify-between text-[11.5px] font-medium text-muted">{t("nameCol")}{contentLocale !== primaryLocale && <LocaleTag locale={contentLocale} />}</label>
          <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("namePlaceholder")} maxLength={255} />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-muted">{t("priceCol", { currency })}</label>
          <SellerPriceInput amountVnd={draft.price} onAmountVndChange={(price) => setDraft({ ...draft, price })} />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-muted">{t("deliveryCol")}</label>
          <Select value={draft.delivery_mode} onChange={(e) => setDraft({ ...draft, delivery_mode: e.target.value as "instant" | "manual" })}>
            <option value="instant">{t("deliveryInstant")}</option>
            <option value="manual">{t("deliveryManual")}</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-muted">{t("slaCol")}</label>
          <Input type="number" min={1} max={720} disabled={draft.delivery_mode !== "manual"} value={draft.sla_hours} onChange={(e) => setDraft({ ...draft, sla_hours: Math.min(720, Math.max(1, Number(e.target.value) || 24)) })} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>{tc("cancel")}</Button>
        <Button size="sm" onClick={() => onSave({ ...draft, name: draft.name.trim() })} disabled={!valid || pending}>{pending ? t("saving") : t("save")}</Button>
      </div>
    </div>
  );
}

/** Edit-page variations table: drag ⋮⋮ to reorder what buyers see, edit a
 *  row in place, stop/start selling (never delete), and hop to the inventory
 *  console for stock. */
export function VariantsTable({
  variants, stats, lowStockThreshold, contentLocale, primaryLocale, pending,
  onAdd, onUpdate, onSetActive, onReorder,
}: {
  variants: (WorkbenchVariant & { id: number })[];
  stats?: Record<number, VariantStats>;
  lowStockThreshold: number;
  contentLocale: ProductLocale;
  primaryLocale: ProductLocale;
  pending: boolean;
  onAdd: (draft: VariantDraft) => Promise<void>;
  onUpdate: (id: number, draft: VariantDraft) => Promise<void>;
  onSetActive: (id: number, active: boolean) => Promise<void>;
  onReorder: (ids: number[]) => Promise<void>;
}) {
  const t = useTranslations("sellerProductForm.variants");
  const locale = useLocale();
  const { formatCheckoutMoney } = useMoney();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const visible = variants.filter((v) => showInactive || v.is_active !== false);
  const inactiveCount = variants.filter((v) => v.is_active === false).length;

  const drop = async (targetId: number) => {
    if (dragId == null || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = variants.map((v) => v.id);
    const next = moveVariant(ids, ids.indexOf(dragId), ids.indexOf(targetId));
    setDragId(null); setOverId(null);
    await onReorder(next);
  };

  const submit = async (id: number | "new", draft: VariantDraft) => {
    if (id === "new") await onAdd(draft); else await onUpdate(id, draft);
    setEditing(null);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-[13.5px] font-bold text-fg">{t("count", { count: variants.length })}</div>
          <div className="text-[12px] text-muted">{t("tableHint")}</div>
        </div>
        <div className="flex items-center gap-3">
          {inactiveCount > 0 && <Switch checked={showInactive} onChange={setShowInactive} label={t("showInactive", { count: inactiveCount })} />}
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")} disabled={editing === "new"}><Plus size={13} /> {t("add")}</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-raised/40 text-left text-[11px] font-semibold uppercase tracking-wider text-faint">
              <th className="w-7 px-2 py-2" />
              <th className="px-2 py-2">{t("nameCol")}</th>
              <th className="w-[96px] px-2 py-2 text-right">{t("priceShort")}</th>
              <th className="w-[112px] px-2 py-2">{t("stockCol")}</th>
              <th className="w-[80px] px-2 py-2 text-right">{t("sold30")}</th>
              <th className="w-[100px] px-2 py-2">{t("statusCol")}</th>
              <th className="w-[104px] px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => {
              const active = v.is_active !== false;
              const instant = v.delivery_mode === "instant";
              const stockTone = !instant ? "text-faint" : v.stock_count === 0 ? "text-bad" : v.stock_count <= lowStockThreshold ? "text-warn" : "text-good";
              const stat = stats ? (stats[v.id] ?? { sold: 0, error: 0 }) : undefined;
              if (editing === v.id) {
                return (
                  <tr key={v.id}><td colSpan={7} className="p-0">
                    <Editor initial={{ name: v.name, price: v.price, delivery_mode: v.delivery_mode, sla_hours: v.sla_hours ?? 24 }} contentLocale={contentLocale} primaryLocale={primaryLocale} pending={pending} onSave={(d) => submit(v.id, d)} onCancel={() => setEditing(null)} />
                  </td></tr>
                );
              }
              return (
                <tr
                  key={v.id}
                  draggable
                  onDragStart={(e) => { setDragId(v.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); if (overId !== v.id) setOverId(v.id); }}
                  onDrop={() => void drop(v.id)}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className={cn("border-b border-line last:border-b-0", !active && "opacity-60", overId === v.id && dragId !== v.id && "bg-iris-soft/40", dragId === v.id && "opacity-40")}
                >
                  <td className="cursor-grab px-2 py-2.5 text-center text-faint" title={t("dragHint")}>⋮⋮</td>
                  <td className="px-2 py-2.5">
                    <div className="truncate font-medium text-fg" title={v.name}>{v.name}</div>
                    <div className="text-[11px] text-faint">{instant ? t("deliveryInstant") : t("deliveryManualSla", { hours: v.sla_hours ?? 24 })} · <span className="font-mono">#{v.id}</span></div>
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap">{formatCheckoutMoney(v.price)}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    {instant ? (
                      <>
                        <span className={cn("font-mono font-semibold", stockTone)}>{v.stock_count.toLocaleString(locale)}</span>
                        <Link href={`/seller/inventory/${v.id}`} className="ml-2 text-[11.5px] text-iris hover:underline">{t("restock")}</Link>
                      </>
                    ) : <span className="text-[11.5px] text-faint">{t("slaTag", { hours: v.sla_hours ?? 24 })}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono">
                    {stat ? <>{stat.sold.toLocaleString(locale)}{stat.error > 0 && <span className="ml-1 text-[11px] text-warn" title={t("errors30")}>+{stat.error}!</span>}</> : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-2 py-2.5"><Tag tone={active ? "good" : "neutral"}>{active ? t("selling") : t("stopped")}</Tag></td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <button type="button" onClick={() => setEditing(v.id)} title={t("edit")} aria-label={t("edit")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"><Edit2 size={13} /></button>
                      <Link href={`/seller/inventory/${v.id}`} title={t("openInventory")} aria-label={t("openInventory")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"><Rows size={13} /></Link>
                      <button type="button" disabled={pending} onClick={() => void onSetActive(v.id, !active)} title={active ? t("stop") : t("resume")} aria-label={active ? t("stop") : t("resume")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg disabled:opacity-40">
                        {active ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && editing !== "new" && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[12.5px] text-muted">{t("empty")}</td></tr>
            )}
            {editing === "new" && (
              <tr><td colSpan={7} className="p-0">
                <Editor initial={{ name: "", price: 0, delivery_mode: "instant", sla_hours: 24 }} contentLocale={contentLocale} primaryLocale={primaryLocale} pending={pending} onSave={(d) => submit("new", d)} onCancel={() => setEditing(null)} />
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line bg-raised/40 px-4 py-2.5 text-[12px] text-muted">
        {t("footer")} <Link href="/seller/inventory" className="text-iris hover:underline">{t("inventoryLink")}</Link>.
      </div>
    </div>
  );
}
