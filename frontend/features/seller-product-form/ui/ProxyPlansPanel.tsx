"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banner, Button, Card, Input, Select, Tag } from "@/components/ui";
import { DisplayCurrencyInput } from "@/components/DisplayCurrencyInput";
import { AlertTriangle, Info, Plus, RotateCcw, Trash } from "@/components/Icons";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { useApiErrorMessage } from "@/lib/use-api-error";
import {
  type PlanDraftRow,
  type ProxyPlanEditor,
  addRow,
  applyMargin,
  changeCount,
  draftRowsFromPlans,
  floorPrice,
  hasRow,
  isChanged,
  marginPct,
  perDay,
  resetEditor,
  rowIssue,
  suggestPrice,
  summarize,
} from "../proxy-plans";

/** Money in the page locale ("2.800 ₫" on /vi) and the seller's display currency. */
function useFormatMoney() {
  const { formatCheckoutMoney } = useMoney();
  const locale = useLocale();
  return (amountVnd: number) => formatCheckoutMoney(amountVnd, { locale });
}

/** "Gói & giá bán" — seller prices each proxy plan like a variant: upstream
 *  cost, sale price, margin and the per-day price side by side, with a quick
 *  "price everything at X% margin" and (TopProxy) new durations. Edits stay
 *  in the form draft until the page's "Save changes". */
export function ProxyPlansPanel({
  productId, editor, onChange, loadState, onRetry, dirty, saving, onSave,
}: {
  productId: number;
  editor: ProxyPlanEditor | null;
  onChange: (next: ProxyPlanEditor) => void;
  loadState: "loading" | "error" | "ready";
  onRetry: () => void;
  /** Page-level unsaved state + save, so the sticky bar saves the whole form. */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const t = useTranslations("sellerProductForm.proxyPlans");

  if (loadState === "loading" || (loadState === "ready" && !editor)) return <PlansSkeleton label={t("loading")} />;
  if (loadState === "error" || !editor) {
    return (
      <Card className="p-5">
        <Banner tone="bad" icon={<AlertTriangle size={15} />} title={t("loadFailed")} action={<Button size="sm" variant="secondary" onClick={onRetry}>{t("retry")}</Button>}>
          {t("loadFailedHint")}
        </Banner>
      </Card>
    );
  }
  return <PlansEditor productId={productId} editor={editor} onChange={onChange} dirty={dirty} saving={saving} onSave={onSave} />;
}

function PlansEditor({ productId, editor, onChange, dirty, saving, onSave }: {
  productId: number; editor: ProxyPlanEditor; onChange: (next: ProxyPlanEditor) => void; dirty: boolean; saving: boolean; onSave: () => void;
}) {
  const t = useTranslations("sellerProductForm.proxyPlans");
  const formatCheckoutMoney = useFormatMoney();
  const minMargin = editor.meta.min_margin_pct;
  const [marginInput, setMarginInput] = useState(String(Math.max(minMargin, 50)));
  const summary = summarize(editor.rows, minMargin);
  const marginValue = Number(marginInput);
  const marginTooLow = marginInput.trim() !== "" && (!Number.isFinite(marginValue) || marginValue < minMargin);
  const networkLabel = (editor.baseParams.field_labels as Record<string, string> | undefined)?.network;

  const groups = useMemo(() => {
    const out: { network: string; label: string; rows: PlanDraftRow[] }[] = [];
    for (const row of editor.rows) {
      const group = out.find((g) => g.network === row.network);
      if (group) group.rows.push(row);
      else out.push({ network: row.network, label: row.networkLabel, rows: [row] });
    }
    return out;
  }, [editor.rows]);

  const setRows = (rows: PlanDraftRow[]) => onChange({ ...editor, rows });
  const setPrice = (id: string, price: number) => setRows(editor.rows.map((row) => (row.id === id ? { ...row, price } : row)));
  const remove = (id: string) => setRows(editor.rows.filter((row) => row.id !== id));
  const undo = () => onChange(resetEditor(editor));
  const changes = changeCount(editor);
  const pricedCount = editor.rows.filter((row) => row.cost).length;

  return (
    <Card className="p-0">
      <div className="space-y-3 border-b border-line p-5">
        <div className="max-w-[680px] space-y-1">
          <h3 className="text-[15px] font-semibold text-fg">{t("title")}</h3>
          <p className="text-[13px] leading-relaxed text-muted">
            {t("intro")}{editor.meta.can_add && <> {t("introLadder")}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
          <Tag tone="neutral">{t("minMargin", { pct: minMargin })}</Tag>
          {editor.meta.protocols.length > 1 && (
            <span className="inline-flex items-start gap-1.5">
              <Info size={14} className="mt-0.5 shrink-0 text-faint" />
              {t("protocols", { list: editor.meta.protocols.join(" · ") })}
            </span>
          )}
        </div>
        {editor.meta.from_formula && (
          <Banner tone="warn" icon={<AlertTriangle size={15} />} title={t("formulaTitle")}>{t("formulaBody")}</Banner>
        )}
      </div>

      <dl className="grid grid-cols-2 divide-line border-b border-line md:grid-cols-4 md:divide-x">
        <SummaryCell label={t("summary.count")} value={String(summary.count)} />
        <SummaryCell label={t("summary.from")} value={summary.minPrice != null ? formatCheckoutMoney(summary.minPrice) : "—"} />
        <SummaryCell
          label={t("summary.margin")}
          value={summary.minMargin == null || summary.maxMargin == null ? "—"
            : summary.minMargin === summary.maxMargin ? t("summary.marginSingle", { pct: summary.minMargin })
              : t("summary.marginRange", { min: summary.minMargin, max: summary.maxMargin })}
        />
        <SummaryCell
          label={t("summary.issues")}
          value={summary.issues > 0 ? t("summary.issuesCount", { count: summary.issues }) : t("summary.issuesNone")}
          tone={summary.issues > 0 ? "bad" : "good"}
          plain={summary.issues === 0}
        />
      </dl>

      {pricedCount > 0 && (
        <div className="space-y-1.5 border-b border-line bg-raised/40 px-5 py-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-muted" htmlFor="plan-margin">
              {t("quick.label")}
              <span className="relative">
                <Input
                  id="plan-margin" inputMode="decimal" value={marginInput} aria-invalid={marginTooLow || undefined}
                  onChange={(event) => setMarginInput(event.target.value.replace(/[^\d.]/g, ""))}
                  className="h-9 w-24 pr-7 font-mono tabular-nums"
                />
                <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-faint">%</span>
              </span>
            </label>
            <Button variant="secondary" disabled={marginTooLow || marginInput.trim() === ""} onClick={() => setRows(applyMargin(editor.rows, marginValue))}>
              {t("quick.apply", { count: pricedCount })}
            </Button>
            {changes > 0 && (
              <Button variant="ghost" onClick={undo}><RotateCcw size={14} />{t("quick.undo", { count: changes })}</Button>
            )}
          </div>
          <p className={cn("text-[12px]", marginTooLow ? "text-bad" : "text-faint")}>
            {marginTooLow ? t("quick.tooLow", { pct: minMargin }) : t("quick.hint")}
          </p>
        </div>
      )}

      {editor.rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted">{editor.meta.can_add ? t("emptyCanAdd") : t("empty")}</p>
      ) : (
        <>
          <table className="hidden w-full text-[13px] md:table">
            <thead className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-faint">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-left">{t("col.duration")}</th>
                <th scope="col" className="px-3 py-2.5 text-right">{t("col.cost")}</th>
                <th scope="col" className="w-[200px] px-3 py-2.5 text-left">{t("col.price")}</th>
                <th scope="col" className="px-3 py-2.5 text-left">{t("col.margin")}</th>
                <th scope="col" className="px-3 py-2.5 text-right">{t("col.perDay")}</th>
                <th scope="col" className="w-12 px-3 py-2.5"><span className="sr-only">{t("col.actions")}</span></th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.network} className="border-b border-line last:border-b-0">
                {groups.length > 1 || networkLabel ? (
                  <tr className="bg-raised/50">
                    <th scope="colgroup" colSpan={6} className="px-5 py-2 text-left text-[12.5px] font-semibold text-fg">
                      {group.label}
                      <span className="ml-2 font-normal text-faint">{t("groupCount", { count: group.rows.length })}</span>
                    </th>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
                  <PlanTableRow
                    key={row.id} row={row} minMargin={minMargin} groupLabel={group.label}
                    canRemove={editor.rows.length > 1} onPrice={(price) => setPrice(row.id, price)} onRemove={() => remove(row.id)}
                  />
                ))}
              </tbody>
            ))}
          </table>

          <div className="divide-y divide-line md:hidden">
            {groups.map((group) => (
              <section key={group.network} aria-label={group.label}>
                <h4 className="bg-raised/50 px-4 py-2 text-[12.5px] font-semibold text-fg">
                  {group.label}<span className="ml-2 font-normal text-faint">{t("groupCount", { count: group.rows.length })}</span>
                </h4>
                <ul className="divide-y divide-line">
                  {group.rows.map((row) => (
                    <PlanCardRow
                      key={row.id} row={row} minMargin={minMargin} groupLabel={group.label}
                      canRemove={editor.rows.length > 1} onPrice={(price) => setPrice(row.id, price)} onRemove={() => remove(row.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {editor.meta.can_add ? (
        <AddPlanForm productId={productId} editor={editor} networkLabel={networkLabel} marginPct={marginTooLow || !marginInput.trim() ? Math.max(minMargin, 50) : marginValue} onAdd={(row) => onChange(addRow(editor, row))} />
      ) : (
        <p className="flex items-start gap-1.5 border-t border-line px-5 py-3.5 text-[12.5px] text-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-faint" />{t("mappedByAdmin")}
        </p>
      )}

      {dirty && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-card border-t border-line bg-card/95 px-5 py-3 shadow-card-lg backdrop-blur" role="region" aria-label={t("saveBar.label")}>
          <p className={cn("text-[13px]", summary.issues > 0 ? "text-bad" : "text-fg")}>
            {summary.issues > 0 ? t("saveBar.blocked", { count: summary.issues }) : changes > 0 ? t("saveBar.changes", { count: changes }) : t("saveBar.other")}
          </p>
          <div className="flex items-center gap-2">
            {changes > 0 && <Button variant="ghost" onClick={undo} disabled={saving}>{t("saveBar.undo")}</Button>}
            <Button onClick={onSave} disabled={saving || summary.issues > 0}>{saving ? t("saveBar.saving") : t("saveBar.save")}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SummaryCell({ label, value, tone, plain }: { label: string; value: string; tone?: "good" | "bad"; plain?: boolean }) {
  return (
    <div className="px-5 py-3">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] font-semibold", !plain && "font-mono tabular-nums", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-fg")}>{value}</dd>
    </div>
  );
}

type RowProps = { row: PlanDraftRow; minMargin: number; groupLabel: string; canRemove: boolean; onPrice: (price: number) => void; onRemove: () => void };

function useRowView(row: PlanDraftRow, minMargin: number) {
  const t = useTranslations("sellerProductForm.proxyPlans");
  const formatCheckoutMoney = useFormatMoney();
  const issue = rowIssue(row, minMargin);
  const margin = marginPct(row.price, row.cost);
  const floor = floorPrice(row.cost, minMargin);
  const issueText = issue === "below_floor" && floor != null
    ? t("issue.below_floor", { price: formatCheckoutMoney(floor) })
    : issue ? t(`issue.${issue}`) : null;
  const daysLabel = t("days", { count: row.days });
  const marginTag = margin == null
    ? <span className="text-[12px] text-faint">—</span>
    : <Tag tone={issue === "below_floor" ? "bad" : "good"}>{issue === "below_floor" ? t("margin.low", { pct: margin }) : t("margin.ok", { pct: margin })}</Tag>;
  const was = isChanged(row) && row.savedPrice != null
    ? <>{t("was")} <s className="decoration-faint/70">{formatCheckoutMoney(row.savedPrice)}</s></>
    : null;
  return { t, formatCheckoutMoney, issue, issueText, daysLabel, marginTag, was };
}

function PlanTableRow({ row, minMargin, groupLabel, canRemove, onPrice, onRemove }: RowProps) {
  const { t, formatCheckoutMoney, issue, issueText, daysLabel, marginTag, was } = useRowView(row, minMargin);
  const errorId = `plan-${row.id}-issue`;
  return (
    <tr className={cn("align-top", issue && "bg-bad-soft/40")}>
      <td className="px-5 py-3">
        <div className="flex flex-wrap items-center gap-1.5 font-medium text-fg">
          {daysLabel}
          {row.savedPrice == null && <Tag tone="iris">{t("tagNew")}</Tag>}
        </div>
        {was && <div className="mt-1 text-[12px] text-faint">{was}</div>}
      </td>
      <td className="px-3 py-3 text-right font-mono tabular-nums text-muted">
        {row.cost != null ? formatCheckoutMoney(row.cost) : <span className="text-[12px] text-faint">{t("costUnknown")}</span>}
      </td>
      <td className="px-3 py-2">
        <div aria-describedby={issueText ? errorId : undefined}>
          <DisplayCurrencyInput amountVnd={row.price} onAmountVndChange={onPrice} invalid={issue != null} groupDigits />
        </div>
        {issueText && <p id={errorId} className="mt-1 text-[12px] text-bad">{issueText}</p>}
      </td>
      <td className="px-3 py-3">{marginTag}</td>
      <td className="px-3 py-3 text-right font-mono text-[12.5px] tabular-nums text-muted">{row.price > 0 ? formatCheckoutMoney(perDay(row.price, row.days)) : "—"}</td>
      <td className="px-3 py-2 text-right">
        <RemoveButton canRemove={canRemove} label={t("remove", { label: `${groupLabel} · ${daysLabel}` })} lastLabel={t("removeLast")} onRemove={onRemove} />
      </td>
    </tr>
  );
}

function PlanCardRow({ row, minMargin, groupLabel, canRemove, onPrice, onRemove }: RowProps) {
  const { t, formatCheckoutMoney, issue, issueText, daysLabel, marginTag, was } = useRowView(row, minMargin);
  return (
    <li className={cn("space-y-2 px-4 py-3", issue && "bg-bad-soft/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium text-fg">
            {daysLabel}{row.savedPrice == null && <Tag tone="iris">{t("tagNew")}</Tag>}
          </div>
          <p className="mt-0.5 text-[12.5px] tabular-nums text-muted">
            {t("col.cost")} {row.cost != null ? formatCheckoutMoney(row.cost) : "—"}
            {row.price > 0 && <> · {t("perDayShort", { price: formatCheckoutMoney(perDay(row.price, row.days)) })}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">{marginTag}<RemoveButton canRemove={canRemove} label={t("remove", { label: `${groupLabel} · ${daysLabel}` })} lastLabel={t("removeLast")} onRemove={onRemove} /></div>
      </div>
      <label className="block text-[12px] font-medium text-muted">
        <span className="mb-1 block">{t("col.price")}</span>
        <DisplayCurrencyInput amountVnd={row.price} onAmountVndChange={onPrice} invalid={issue != null} groupDigits />
      </label>
      {issueText && <p className="text-[12px] text-bad">{issueText}</p>}
      {was && <p className="text-[12px] text-faint">{was}</p>}
    </li>
  );
}

function RemoveButton({ canRemove, label, lastLabel, onRemove }: { canRemove: boolean; label: string; lastLabel: string; onRemove: () => void }) {
  return (
    <button
      type="button" onClick={onRemove} disabled={!canRemove} aria-label={canRemove ? label : lastLabel} title={canRemove ? label : lastLabel}
      className="inline-grid h-10 w-10 place-items-center rounded-lg text-faint transition-colors hover:bg-bad-soft hover:text-bad focus-visible:outline-2 focus-visible:outline-iris disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint md:h-8 md:w-8"
    >
      <Trash size={15} />
    </button>
  );
}

function AddPlanForm({ productId, editor, networkLabel, marginPct: pct, onAdd }: {
  productId: number; editor: ProxyPlanEditor; networkLabel?: string; marginPct: number; onAdd: (row: PlanDraftRow) => void;
}) {
  const t = useTranslations("sellerProductForm.proxyPlans");
  const apiErrorMessage = useApiErrorMessage();
  const networks = editor.meta.networks;
  const [network, setNetwork] = useState(networks[0]?.code ?? "");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const types = editor.meta.protocols.length ? editor.meta.protocols : [...new Set(editor.rows.map((row) => row.types[0]))].slice(0, 1);
  const label = networks.find((n) => n.code === network)?.label ?? network;

  const submit = async () => {
    const n = Number(days);
    setError(null);
    if (!Number.isInteger(n) || n < 1) { setError(t("add.invalidDays")); return; }
    if (hasRow(editor, network, n)) { setError(t("add.duplicate", { label: `${label} · ${t("days", { count: n })}` })); return; }
    setBusy(true);
    try {
      const quotes = await api.quoteProductProxyPlans(productId, types.map((type) => ({ type, network, days: n })));
      const [row] = draftRowsFromPlans(quotes, editor.meta.protocols, networks.map((item) => item.code));
      if (!row) return;
      if (!row.supported || row.cost == null) { setError(t("add.unsupported", { label: `${label} · ${t("days", { count: n })}` })); return; }
      onAdd({ ...row, networkLabel: label, price: suggestPrice(row.cost, pct), savedPrice: null });
      setDays("");
    } catch (reason) {
      setError(apiErrorMessage(reason, t("add.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-2 border-t border-line px-5 py-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="text-[13px] font-semibold text-fg">{t("add.title")}</p>
      <div className="flex flex-wrap items-end gap-2">
        {networks.length > 1 && (
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[12px] font-medium text-muted sm:flex-none">
            {networkLabel || t("add.network")}
            <Select value={network} onChange={(event) => setNetwork(event.target.value)}>
              {networks.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </Select>
          </label>
        )}
        <label className="flex w-32 flex-col gap-1 text-[12px] font-medium text-muted">
          {t("add.days")}
          <Input inputMode="numeric" value={days} placeholder="14" aria-invalid={error ? true : undefined} onChange={(event) => setDays(event.target.value.replace(/\D/g, ""))} className="font-mono tabular-nums" />
        </label>
        <Button type="submit" variant="secondary" className="h-10" disabled={busy || !days}>
          <Plus size={14} />{busy ? t("add.adding") : t("add.submit")}
        </Button>
      </div>
      <p role={error ? "alert" : undefined} className={cn("text-[12px]", error ? "text-bad" : "text-faint")}>
        {error ?? t("add.hint", { pct })}
      </p>
    </form>
  );
}

function PlansSkeleton({ label }: { label: string }) {
  return (
    <Card className="space-y-3 p-5" aria-busy="true" aria-label={label}>
      <div className="h-4 w-40 animate-pulse rounded bg-raised" />
      <div className="h-3 w-full max-w-[520px] animate-pulse rounded bg-raised" />
      <div className="grid grid-cols-2 gap-3 pt-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-raised" />)}
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-raised" />)}
    </Card>
  );
}
