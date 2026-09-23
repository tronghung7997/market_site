"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SourceCatalogItem, SourceListing, SourceRepriceResult, SupplierSource } from "@/lib/types";
import { Banner, Button, Input, Switch, Tag } from "@/components/ui";
import {
  AlertTriangle, ArrowRight, Edit2, ExternalLink, Package, Percent, Plus, RefreshCw, Search, Sparkles, Unlink, X,
} from "@/components/Icons";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { sellerProductPath } from "@/lib/routes";
import {
  blockReason, countListings, fixPrice, groupListings, listingState, marginOf, needsAction, sourceRef,
  type ListingState,
} from "../logic";
import { RepriceDialog } from "./RepriceDialog";
import { FilterChip, RowMenu } from "./shared";
import type { WorkspaceTab } from "./SourceWorkspace";

type Filter = "all" | ListingState;

export function SellingTab({ area, source, rows, reload, setRows, goTab }: {
  area: SourceArea; source: SupplierSource; rows: SourceListing[];
  reload: () => Promise<void>;
  setRows: React.Dispatch<React.SetStateAction<SourceListing[] | null>>;
  goTab: (tab: WorkspaceTab, extra?: Record<string, string>) => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const money = (n: number) => formatLedgerMoney(n, locale);
  // Trang admin đọc id số; khu seller dùng public_key (không lộ row id).
  const productHref = (g: { product_id: number; public_key: string }) =>
    area === "admin" ? `/admin/products/${g.product_id}` : sellerProductPath({ id: g.product_id, public_key: g.public_key });

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [changeSku, setChangeSku] = useState<SourceListing | null>(null);
  const [moveRow, setMoveRow] = useState<SourceListing | null>(null);
  const [detachRow, setDetachRow] = useState<SourceListing | null>(null);
  const [preview, setPreview] = useState<SourceRepriceResult | null>(null);
  const [repricing, setRepricing] = useState(false);

  const rule = { markup_pct: source.markup_pct, round_to: source.round_to };
  const counts = countListings(rows);
  const todo = rows.filter(needsAction);
  const allGroups = useMemo(() => groupListings(rows), [rows]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const keep = (r: SourceListing) => {
      if (filter !== "all" && listingState(r) !== filter) return false;
      if (needle && !`${r.product_title} ${r.variant_name} ${r.external_id} ${r.external_name ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    };
    return groupListings(rows.filter(keep));
  }, [rows, q, filter]);

  const patch = async (row: SourceListing, body: Parameters<typeof api.sources.updateListing>[2], okText?: string) => {
    setBusyRow(row.listing_id);
    setError("");
    try {
      const updated = await api.sources.updateListing(area, row.listing_id, body);
      setRows((rs) => rs?.map((r) => (r.listing_id === updated.listing_id ? updated : r)) ?? null);
      if (okText) setNotice(okText);
      return true;
    } catch (e) {
      setError(apiErrorMessage(e));
      return false;
    } finally {
      setBusyRow(null);
    }
  };

  const savePrice = async (row: SourceListing) => {
    if (!editing) return;
    const price = Number(editing.value);
    if (!Number.isFinite(price) || price < 0) { setError(t("selling.priceInvalid")); return; }
    if (price === row.price) { setEditing(null); return; }
    if (await patch(row, { price }, t("selling.priceSaved"))) setEditing(null);
  };

  /** Lãi thấp: về luật giá nếu luật đủ cao, không thì đặt tay giá tối thiểu. */
  const raisePrice = (row: SourceListing) => {
    const target = fixPrice(row, source.min_margin_pct, rule);
    const byRule = row.rule_price ?? 0;
    return byRule >= target
      ? patch(row, { price_manual: false }, t("selling.priceSaved"))
      : patch(row, { price: target }, t("selling.priceSaved"));
  };

  const previewRule = async () => {
    setRepricing(true);
    setError("");
    try {
      setPreview(await api.sources.reprice(area, sourceRef(area, source), { dry_run: true }));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRepricing(false);
    }
  };
  const applyRule = async () => {
    setRepricing(true);
    try {
      const r = await api.sources.reprice(area, sourceRef(area, source), {});
      setPreview(null);
      setNotice(t("selling.repriced", { n: r.changed.length }));
      await reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRepricing(false);
    }
  };

  const detach = async () => {
    if (!detachRow) return;
    setBusyRow(detachRow.listing_id);
    try {
      await api.sources.detach(area, detachRow.listing_id);
      setDetachRow(null);
      setNotice(t("selling.detached"));
      await reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusyRow(null);
    }
  };

  const reasonText = (r: SourceListing): string => {
    switch (blockReason(r)) {
      case "delisted": return t("reason.delisted", { id: r.external_id });
      case "autoPaused": return t("reason.autoPaused", { n: r.fail_streak, reason: r.last_fail_reason ?? "—" });
      case "lowMargin": return t("reason.lowMargin", { pct: Math.round(r.margin_pct ?? 0), min: source.min_margin_pct });
      case "outOfStock": return t("reason.outOfStock");
      default: return "";
    }
  };

  return (
    <div className="space-y-5 pt-4">
      {/* Luật giá của nguồn — một câu, sửa ở Cài đặt */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-iris/20 bg-iris-soft px-4 py-3">
        <p className="flex min-w-0 items-start gap-2.5 text-[13.5px] leading-relaxed text-fg">
          <Percent size={16} className="mt-0.5 shrink-0 text-iris" />
          <span>
            <b>{t("rule.label")}</b>{" "}
            {t("rule.sentence", { pct: source.markup_pct, round: money(source.round_to) })}{" "}
            {source.follow_cost ? t("rule.follow") : t("rule.keep")}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={previewRule} disabled={repricing || rows.length === 0}>{t("rule.applyAll")}</Button>
          <Button size="sm" variant="secondary" onClick={() => goTab("settings")}>{t("rule.edit")}</Button>
        </div>
      </div>

      {notice && <p role="status" className="text-[13px] text-good">{notice}</p>}
      {error && <Banner tone="bad" icon={<AlertTriangle size={15} />}>{error}</Banner>}

      {/* Việc cần làm: mỗi phân loại bị chặn một dòng, một nút sửa */}
      {todo.length > 0 && (
        <section aria-labelledby="sell-todo" className="overflow-hidden rounded-card border border-warn/30 bg-card">
          <h2 id="sell-todo" className="flex items-center gap-2 bg-warn-soft px-4 py-2.5 text-[14px] font-semibold text-fg">
            <AlertTriangle size={16} className="text-warn" />{t("selling.todoTitle", { n: todo.length })}
          </h2>
          <ul className="divide-y divide-line">
            {todo.map((r) => {
              const reason = blockReason(r);
              const busy = busyRow === r.listing_id;
              return (
                <li key={r.listing_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-fg">{r.product_title} · {r.variant_name}</p>
                    <p className="text-[12.5px] text-muted">
                      {reasonText(r)}
                      {reason === "lowMargin" && r.price_manual && ` ${t("selling.manualNote", { price: money(r.price) })}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {reason === "lowMargin" && (
                      <>
                        <Button size="sm" onClick={() => raisePrice(r)} disabled={busy}>
                          {t("selling.raiseTo", { price: money(fixPrice(r, source.min_margin_pct, rule)) })}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => patch(r, { is_active: false })} disabled={busy}>{t("selling.turnOff")}</Button>
                      </>
                    )}
                    {reason === "autoPaused" && (
                      <>
                        <Button size="sm" onClick={() => patch(r, { is_active: true }, t("selling.resumed"))} disabled={busy}><RefreshCw size={14} />{t("selling.resume")}</Button>
                        <Button size="sm" variant="secondary" onClick={() => goTab("orders", { result: "failed" })}>{t("selling.seeFailed")}</Button>
                      </>
                    )}
                    {reason === "delisted" && (
                      <>
                        <Button size="sm" onClick={() => setChangeSku(r)} disabled={busy}>{t("selling.pickReplacement")}</Button>
                        <Button size="sm" variant="secondary" onClick={() => setDetachRow(r)} disabled={busy}>{t("selling.detach")}</Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input id="sell-q" aria-label={t("selling.search")} className="h-9 pl-8" placeholder={t("selling.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "selling", "blocked", "off"] as Filter[]).map((f) => (
            <FilterChip key={f} on={filter === f} onClick={() => setFilter(f)} count={counts[f]} tone={f === "blocked" ? "warn" : undefined}>
              {t(`state.${f}`)}
            </FilterChip>
          ))}
        </div>
        <Button className="sm:ml-auto" onClick={() => goTab("catalog")}><Plus size={15} />{t("selling.addFrom", { source: source.name })}</Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-card p-8 text-center">
          <Package size={22} className="mx-auto text-faint" />
          <p className="mt-2 text-[14px] font-medium text-fg">{t("selling.empty")}</p>
          <p className="mt-1 text-[13px] text-muted">{t("selling.emptyHint")}</p>
          <Button className="mt-4" onClick={() => goTab("catalog")}><Plus size={15} />{t("selling.addFrom", { source: source.name })}</Button>
        </div>
      ) : (
        <div role="region" aria-label={t("selling.tableLabel")} tabIndex={0} className="relative overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead className="bg-raised text-left text-[12px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">{t("col.variant")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("col.costPrice")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("col.profit")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("col.stock")}</th>
                <th scope="col" className="px-3 py-2.5 font-medium">{t("col.state")}</th>
                <th scope="col" className="px-3 py-2.5 font-medium">{t("col.sell")}</th>
                <th scope="col" className="px-3 py-2.5"><span className="sr-only">{t("col.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">{t("noMatch")}</td></tr>
              )}
              {groups.map((g) => (
                <Fragment key={g.product_id}>
                  <tr className="border-t border-line bg-surface/60">
                    <td colSpan={7} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-fg">{g.product_title}</span>
                        <span className="text-[12px] text-muted">
                          {t("selling.groupMeta", { n: g.rows.length })}{g.group_name ? ` · ${t("selling.groupOf", { group: g.group_name })}` : ""}
                        </span>
                        {g.product_status !== "active" && <Tag tone="neutral">{t(`productStatus.${g.product_status}`)}</Tag>}
                        <Link href={productHref(g)} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:text-iris">
                          {g.product_status === "draft" ? t("selling.finishDraft") : t("selling.editProduct")}<ExternalLink size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                  {g.rows.map((r) => {
                    const state = listingState(r);
                    const reason = blockReason(r);
                    const isEditing = editing?.id === r.listing_id;
                    const editPrice = isEditing ? Number(editing.value) : r.price;
                    const editMargin = marginOf(editPrice, r.cost_price);
                    const busy = busyRow === r.listing_id;
                    const profit = r.price - r.cost_price;
                    const others = allGroups.filter((o) => o.product_id !== r.product_id);
                    return (
                      <tr key={r.listing_id} className={cn("border-t border-line align-top", state === "blocked" && "bg-warn-soft/50", state === "off" && "text-muted")}>
                        <td className="px-4 py-3 pl-8">
                          <p className={cn("font-medium", state === "off" ? "text-muted" : "text-fg")}>
                            {r.variant_name} <span className="ml-1 font-mono text-[11.5px] font-normal text-faint">#{r.external_id}</span>
                          </p>
                          {reason && <p className="mt-0.5 max-w-md text-[12.5px] leading-snug text-warn">{reasonText(r)}</p>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {isEditing ? (
                            <form
                              className="flex flex-col items-end gap-1.5"
                              onSubmit={(e) => { e.preventDefault(); void savePrice(r); }}
                              onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="font-mono text-[12.5px] text-muted">{money(r.cost_price)}</span>
                                <ArrowRight size={13} className="text-faint" />
                                <Input
                                  id={`price-${r.listing_id}`} type="number" min={0} step={1} autoFocus aria-label={t("selling.priceFor", { name: r.variant_name })}
                                  className="h-8 w-28 text-right font-mono" value={editing.value}
                                  onChange={(e) => setEditing({ id: r.listing_id, value: e.target.value })}
                                />
                              </span>
                              <span className={cn("font-mono text-[11.5px]", editMargin !== null && editMargin < source.min_margin_pct ? "text-bad" : "text-muted")}>
                                {editMargin === null ? "—" : t("selling.profitPreview", { profit: money(editPrice - r.cost_price), pct: Math.round(editMargin) })}
                              </span>
                              <span className="flex gap-1.5">
                                <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}><X size={14} />{t("cancel")}</Button>
                                <Button size="sm" type="submit" disabled={busy}>{t("save")}</Button>
                              </span>
                            </form>
                          ) : (
                            <button
                              type="button" onClick={() => setEditing({ id: r.listing_id, value: String(r.price) })}
                              aria-label={t("selling.editPriceFor", { name: r.variant_name })}
                              className="group inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
                            >
                              <span className="font-mono text-[12.5px] text-muted">{reason === "delisted" ? "—" : money(r.cost_price)}</span>
                              <ArrowRight size={13} className="text-faint" />
                              <span className="font-mono text-[13.5px] font-semibold text-fg">{money(r.price)}</span>
                              <Edit2 size={13} className="text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                            </button>
                          )}
                          {r.price_manual && !isEditing && <div className="mt-0.5"><Tag tone="neutral">{t("selling.manual")}</Tag></div>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {reason === "delisted" || r.margin_pct === null ? <span className="text-faint">—</span> : (
                            <>
                              <span className={cn("block text-[13.5px] font-semibold", r.margin_ok ? "text-good" : "text-bad")}>{money(profit)}</span>
                              <span className="block text-[11.5px] text-muted">{Math.round(r.margin_pct)}%</span>
                            </>
                          )}
                        </td>
                        <td className={cn("px-3 py-3 text-right font-mono tabular-nums", r.sellable === 0 ? "text-bad" : "text-fg")}>
                          {reason === "delisted" ? "—" : r.sellable.toLocaleString(locale)}
                        </td>
                        <td className="px-3 py-3">
                          {state === "selling" && <Tag tone="good">{t("state.selling")}</Tag>}
                          {state === "blocked" && <Tag tone="warn"><AlertTriangle size={12} />{t(`reasonShort.${reason}`)}</Tag>}
                          {state === "off" && <Tag tone="neutral">{r.variant_active ? t("state.notPublished") : t("state.turnedOff")}</Tag>}
                        </td>
                        <td className="px-3 py-3">
                          <Switch
                            checked={r.variant_active} disabled={busy}
                            label={t("selling.sellToggle", { name: r.variant_name })}
                            onChange={(next) => void patch(r, { is_active: next })}
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <RowMenu
                            label={`${r.product_title} · ${r.variant_name}`}
                            items={[
                              ...(r.price_manual
                                ? [{ key: "rule", label: t("menu.followRule", { price: r.rule_price ? money(r.rule_price) : "—" }), icon: <Sparkles size={15} />, onSelect: () => void patch(r, { price_manual: false }, t("selling.priceSaved")) }]
                                : []),
                              { key: "sku", label: t("menu.changeSku"), icon: <RefreshCw size={15} />, onSelect: () => setChangeSku(r) },
                              ...(others.length > 0 ? [{ key: "move", label: t("menu.move"), icon: <Package size={15} />, onSelect: () => setMoveRow(r) }] : []),
                              { key: "detach", label: t("menu.detach"), icon: <Unlink size={15} />, danger: true, onSelect: () => setDetachRow(r) },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <p className="text-[12.5px] text-muted">{t("selling.hint")}</p>}

      {changeSku && (
        <ChangeSkuDialog
          area={area} sourceRef={sourceRef(area, source)} row={changeSku} onClose={() => setChangeSku(null)}
          onPick={async (item) => {
            if (await patch(changeSku, { external_id: item.external_id }, t("selling.skuChanged"))) setChangeSku(null);
          }}
        />
      )}

      {moveRow && (
        <MoveDialog
          row={moveRow}
          targets={allGroups.filter((g) => g.product_id !== moveRow.product_id).map((g) => ({ id: g.product_id, title: g.product_title }))}
          onClose={() => setMoveRow(null)}
          onMove={async (productId) => {
            setBusyRow(moveRow.listing_id);
            try {
              await api.sources.updateListing(area, moveRow.listing_id, { product_id: productId });
              setMoveRow(null);
              setNotice(t("selling.moved"));
              await reload();
            } catch (e) {
              setError(apiErrorMessage(e));
            } finally {
              setBusyRow(null);
            }
          }}
        />
      )}

      <Dialog open={detachRow !== null} onOpenChange={(o) => { if (!o && busyRow === null) setDetachRow(null); }}>
        <DialogContent className="max-w-sm border-line bg-panel p-5 text-fg">
          <DialogHeader><DialogTitle className="text-[15px] font-semibold">{t("detach.title")}</DialogTitle></DialogHeader>
          <p className="text-[13px] leading-relaxed text-muted">
            {t("detach.body", { name: detachRow ? `${detachRow.product_title} · ${detachRow.variant_name}` : "" })}
          </p>
          <DialogFooter className="mt-2 flex-row justify-end gap-2">
            <Button variant="ghost" onClick={() => setDetachRow(null)} disabled={busyRow !== null}>{t("cancel")}</Button>
            <Button variant="danger" onClick={detach} disabled={busyRow !== null}>{t("detach.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {preview && (
        <RepriceDialog
          preview={preview} title={t("reprice.applyTitle", { pct: preview.margin_pct })}
          busy={repricing} onCancel={() => setPreview(null)} onConfirm={applyRule}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MoveDialog({ row, targets, onClose, onMove }: {
  row: SourceListing; targets: { id: number; title: string }[]; onClose: () => void; onMove: (productId: number) => void;
}) {
  const t = useTranslations("sellerSources");
  const [pick, setPick] = useState<number | null>(targets[0]?.id ?? null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md border-line bg-panel p-5 text-fg">
        <DialogHeader><DialogTitle className="text-[15px] font-semibold">{t("move.title", { name: row.variant_name })}</DialogTitle></DialogHeader>
        <div role="radiogroup" aria-label={t("move.title", { name: row.variant_name })} className="max-h-72 space-y-1.5 overflow-y-auto">
          {targets.map((p) => (
            <label key={p.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[13.5px]", pick === p.id ? "border-iris bg-iris-soft" : "border-line")}>
              <input type="radio" name="move-target" className="accent-iris" checked={pick === p.id} onChange={() => setPick(p.id)} />
              {p.title}
            </label>
          ))}
        </div>
        <DialogFooter className="mt-2 flex-row justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={() => pick !== null && onMove(pick)} disabled={pick === null}>{t("move.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeSkuDialog({ area, sourceRef: ref, row, onClose, onPick }: {
  area: SourceArea; sourceRef: string; row: SourceListing; onClose: () => void; onPick: (item: SourceCatalogItem) => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [q, setQ] = useState(row.external_name ? row.external_name.replace(/^[A-Z]{1,3}\d{1,4}\.\s*/i, "").split(/\s+/).slice(0, 3).join(" ") : "");
  const [items, setItems] = useState<SourceCatalogItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const h = setTimeout(async () => {
      try {
        setItems((await api.sources.catalog(area, ref, { q, in_stock: true, per_page: 12 })).items);
        setError("");
      } catch (e) {
        setError(apiErrorMessage(e));
      }
    }, 200);
    return () => clearTimeout(h);
  }, [area, ref, q, apiErrorMessage]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg border-line bg-panel p-5 text-fg">
        <DialogHeader><DialogTitle className="text-[15px] font-semibold">{t("changeSku.title", { name: row.variant_name })}</DialogTitle></DialogHeader>
        <p className="text-[12.5px] text-muted">{t("changeSku.hint")}</p>
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input id="sku-q" aria-label={t("catalog.search")} className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("catalog.search")} autoFocus />
        </div>
        {error && <p role="alert" className="text-[12.5px] text-bad">{error}</p>}
        <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {items === null && <p className="p-4 text-center text-[13px] text-muted">{t("loading")}</p>}
          {items?.map((it) => (
            <button key={it.external_id} type="button" onClick={() => onPick(it)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] hover:bg-surface focus-visible:bg-surface focus-visible:outline-none">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{it.name}</span>
                <span className="text-[11.5px] text-muted"><span className="font-mono">#{it.external_id}</span> · {it.group_name}</span>
              </span>
              <span className="font-mono text-[12.5px] tabular-nums text-muted">{formatLedgerMoney(it.cost_price, locale)}</span>
              <span className="font-mono text-[12.5px] tabular-nums text-good">{it.amount.toLocaleString(locale)}</span>
            </button>
          ))}
          {items && items.length === 0 && <p className="p-4 text-center text-[13px] text-muted">{t("noMatch")}</p>}
        </div>
        <DialogFooter className="mt-1 flex-row justify-end"><Button variant="ghost" onClick={onClose}>{t("cancel")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
