"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityBar, Banner, Button, Input } from "@/components/ui";
import { AlertTriangle, Info, Plus, X } from "@/components/Icons";
import { DproxyPackagePicker } from "@/components/DynamicOrderForm";
import { VolumeTiersEditor } from "@/components/PricingParamsEditor";
import { cn } from "@/lib/cn";
import type { PricingField } from "@/lib/types";
import { useGridCosts, type GridCosts } from "../data";
import {
  addAxisValue,
  addDays,
  adjustPrices,
  buyerChoices,
  cellKey,
  cellState,
  copyTypePrices,
  dayLabel,
  floorPrice,
  gridFromParams,
  isValidCode,
  marginPct,
  paramsFromGrid,
  priceToMargin,
  removeAxisValue,
  removeDays,
  renameAxisValue,
  renameDays,
  setPrice,
  summarize,
  type AxisKey,
  type AxisValue,
  type CellState,
  type PriceGrid,
} from "../model";

type View = "margin" | "cost" | "perday";

const VIEWS: { id: View; label: string }[] = [
  { id: "margin", label: "Lãi" },
  { id: "cost", label: "Giá vốn" },
  { id: "perday", label: "Giá mỗi ngày" },
];

function vnd(value: number): string {
  return Math.round(value).toLocaleString("vi-VN");
}

function digits(text: string): number {
  const n = Number(text.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Bảng giá theo trục — chiến lược `config` dạng proxy (`plan_prices`).
 *
 *  Giữ bản nháp riêng (ô vừa mở chưa có giá, thời hạn chưa có gói…) và đẩy
 *  `pricing_params` tương đương lên sau mỗi lần sửa; khi cha thay params từ
 *  ngoài (huỷ thay đổi, tải lại) thì dựng lại bảng từ params. */
export function PricingGridEditor({
  productId,
  adapter,
  params,
  onChange,
  labelOverlays,
  costSourceStale = false,
}: {
  productId: number;
  /** Adapter của nguồn ĐANG LƯU — giá vốn tra theo nguồn này. */
  adapter: string | null | undefined;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  /** `pricing_labels` của bản dịch theo thứ tự backend phủ cho buyer tiếng
   *  Việt ([en, vi]) — chỉ dùng khi sản phẩm còn tính theo công thức cũ. */
  labelOverlays?: (Record<string, unknown> | null | undefined)[];
  /** Admin vừa đổi nguồn trong form nhưng chưa lưu. */
  costSourceStale?: boolean;
}) {
  const [grid, setGrid] = useState<PriceGrid>(() => gridFromParams(params, labelOverlays));
  const emitted = useRef(params);
  const [view, setView] = useState<View>("margin");

  useEffect(() => {
    if (params === emitted.current) return;
    emitted.current = params;
    setGrid(gridFromParams(params, labelOverlays));
  }, [params, labelOverlays]);

  const emit = (next: Record<string, unknown>) => {
    emitted.current = next;
    onChange(next);
  };
  const update = (next: PriceGrid) => {
    setGrid(next);
    emit(paramsFromGrid(next, params));
  };

  const costs = useGridCosts(productId, adapter, grid);
  const summary = summarize(grid, costs.costs, costs.minMarginPct);
  const supported = (key: string) => costs.costs[key]?.supported !== false;
  const hasCells = grid.types.length > 0 && grid.networks.length > 0 && grid.days.length > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <SummaryStrip summary={summary} showMargin={costs.available} />

        {grid.fromFormula && (
          <Banner tone="iris" icon={<Info size={14} />} title="Giá đang tính theo công thức cũ">
            Bảng dưới là giá buyer đang trả (giá gốc × hệ số × số ngày/30). Sửa bất kỳ ô nào rồi lưu, sản phẩm chuyển hẳn sang bảng giá từng gói.
          </Banner>
        )}
        {(summary.unsupportedPriced > 0 || summary.belowFloor > 0) && (
          <Banner tone="bad" icon={<AlertTriangle size={14} />} title="Có gói không lưu được">
            {summary.unsupportedPriced > 0 && <p>{summary.unsupportedPriced} gói nguồn không mua được — xoá giá ở các ô viền đỏ ghi “Nguồn không mua được”.</p>}
            {summary.belowFloor > 0 && <p>{summary.belowFloor} gói dưới giá sàn (vốn + lãi tối thiểu {costs.minMarginPct}%) — backend sẽ chặn khi lưu.</p>}
          </Banner>
        )}
        {summary.selling === 0 && hasCells && (
          <Banner tone="warn" icon={<AlertTriangle size={14} />}>Chưa có gói nào được bán — buyer chưa mua được sản phẩm này.</Banner>
        )}
        <CostNotice costs={costs} stale={costSourceStale} />

        <section aria-labelledby="grid-axes" className="space-y-2">
          <div>
            <h3 id="grid-axes" className="text-[13.5px] font-semibold">Trục phân loại</h3>
            <p className="text-[12px] text-muted">Buyer chọn lần lượt theo thứ tự này. Tên hiển thị đổi thoải mái; mã là thứ gửi nguyên văn cho nhà cung cấp.</p>
          </div>
          <div className="divide-y divide-line rounded-lg border border-line">
            <AxisRow
              axis="type"
              name={grid.typeLabel}
              onName={(typeLabel) => update({ ...grid, typeLabel })}
              values={grid.types}
              onAdd={(v) => update(addAxisValue(grid, "type", v))}
              onRename={(code, label) => update(renameAxisValue(grid, "type", code, label))}
              onRemove={(code) => update(removeAxisValue(grid, "type", code))}
            />
            <AxisRow
              axis="network"
              name={grid.networkLabel}
              onName={(networkLabel) => update({ ...grid, networkLabel })}
              values={grid.networks}
              onAdd={(v) => update(addAxisValue(grid, "network", v))}
              onRename={(code, label) => update(renameAxisValue(grid, "network", code, label))}
              onRemove={(code) => update(removeAxisValue(grid, "network", code))}
            />
            <DaysRow
              grid={grid}
              onAdd={(d) => update(addDays(grid, d))}
              onRename={(d, label) => update(renameDays(grid, d, label))}
              onRemove={(d) => update(removeDays(grid, d))}
            />
          </div>
        </section>

        <section aria-labelledby="grid-prices" className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="grid-prices" className="text-[13.5px] font-semibold">Giá từng gói (VND)</h3>
              <p className="text-[12px] text-muted">Ô trống là không bán. Xoá số trong ô để ngừng bán gói đó.</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-raised p-0.5" role="group" aria-label="Dòng phụ trong ô">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => setView(v.id)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                    view === v.id ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <BulkTools
            grid={grid}
            hasCosts={costs.available && !costs.error}
            onAdjust={(pct) => update(adjustPrices(grid, pct))}
            onMargin={(pct) => update(priceToMargin(grid, pct, costs.costs))}
          />

          {hasCells ? (
            <div className="relative">
              <ActivityBar active={costs.loading} label="Đang tải giá vốn" />
              <div role="region" aria-label="Bảng giá từng gói" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-raised text-[12px] text-muted">
                      <th scope="col" className="px-3 py-2 text-left font-medium">{grid.typeLabel} · {grid.networkLabel}</th>
                      {grid.days.map((d) => (
                        <th key={d} scope="col" className="px-2 py-2 text-right font-medium">{dayLabel(grid, d)}</th>
                      ))}
                    </tr>
                  </thead>
                  {grid.types.map((t) => (
                    <TypeGroup
                      key={t.code}
                      grid={grid}
                      type={t}
                      view={view}
                      costs={costs}
                      onPrice={(key, price) => update(setPrice(grid, key, price))}
                      onCopy={() => update(copyTypePrices(grid, t.code, supported))}
                    />
                  ))}
                </table>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
              Chưa có gói nào. Thêm giá trị cho cả ba trục ở trên, bảng giá sẽ hiện ra để điền từng ô.
            </p>
          )}
        </section>

        <VolumeTiersEditor
          value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []}
          onChange={(volume_tiers) => emit({ ...paramsFromGrid(grid, params), volume_tiers })}
        />
      </div>

      <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <BuyerPreview grid={grid} />
      </aside>
    </div>
  );
}

function SummaryStrip({ summary, showMargin }: { summary: ReturnType<typeof summarize>; showMargin: boolean }) {
  const issues = summary.belowFloor + summary.unsupportedPriced + summary.unpriced;
  const items: { label: string; value: string; tone?: "bad" }[] = [
    { label: "Gói đang bán", value: String(summary.selling) },
    { label: "Ô không bán", value: String(summary.emptyCells) },
    { label: "Cần xử lý", value: String(issues), tone: issues > 0 ? "bad" : undefined },
    {
      label: "Giá buyer thấy",
      value: summary.minPrice == null ? "—" : summary.minPrice === summary.maxPrice ? `${vnd(summary.minPrice)}đ` : `${vnd(summary.minPrice)}–${vnd(summary.maxPrice ?? 0)}đ`,
    },
  ];
  if (showMargin) {
    items.push({
      label: "Lãi trên vốn",
      value: summary.minMargin == null ? "—" : summary.minMargin === summary.maxMargin ? `${summary.minMargin}%` : `${summary.minMargin}–${summary.maxMargin}%`,
    });
  }
  return (
    <dl className="grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line sm:flex sm:divide-x">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 flex-1 px-3 py-2">
          <dt className="text-[11.5px] text-muted">{item.label}</dt>
          <dd className={cn("font-mono text-[15px] font-semibold tabular", item.tone === "bad" ? "text-bad" : "text-fg")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CostNotice({ costs, stale }: { costs: GridCosts; stale: boolean }) {
  if (!costs.available) {
    return <p className="text-[12px] text-muted">Nguồn này không có bảng giá vốn theo gói — lãi và giá sàn không hiện.</p>;
  }
  if (costs.error) {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={14} />} action={<Button size="sm" variant="secondary" onClick={costs.retry}>Thử lại</Button>}>
        Không tải được giá vốn. Giá vẫn sửa và lưu được; backend vẫn chặn gói dưới giá sàn.
      </Banner>
    );
  }
  return (
    <>
      {stale && <Banner tone="warn" icon={<Info size={14} />}>Giá vốn đang theo nguồn đã lưu. Lưu nguồn mới rồi mở lại tab để xem vốn của nguồn đó.</Banner>}
      {costs.truncated && <p className="text-[12px] text-muted">Bảng quá lớn — chỉ 200 ô đầu có giá vốn.</p>}
    </>
  );
}

function AxisRow({
  axis,
  name,
  onName,
  values,
  onAdd,
  onRename,
  onRemove,
}: {
  axis: AxisKey;
  name: string;
  onName: (name: string) => void;
  values: AxisValue[];
  onAdd: (value: AxisValue) => void;
  onRename: (code: string, label: string) => void;
  onRemove: (code: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const duplicate = values.some((v) => v.code === code.trim());
  const codeError = code && (!isValidCode(code) ? "Mã tối đa 40 ký tự, không chứa “|”." : duplicate ? "Mã này đã có." : null);
  const example = axis === "type" ? "vd: HTTP" : "vd: FPT";

  const submit = () => {
    if (!code.trim() || codeError) return;
    onAdd({ code: code.trim(), label: label.trim() || code.trim() });
    setCode(""); setLabel(""); setAdding(false);
  };

  return (
    <div className="grid gap-3 p-3 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-muted">Tên trục buyer thấy</span>
        <Input className="h-8 text-[13px] font-semibold" value={name} onChange={(e) => onName(e.target.value)} />
        <span className="font-mono text-[11px] text-muted">gửi đi dưới tên: {axis}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {values.map((v) => (
          editing === v.code ? (
            <Input
              key={v.code}
              autoFocus
              aria-label={`Tên hiển thị của mã ${v.code}`}
              className="h-8 w-44 text-[13px]"
              defaultValue={v.label}
              onBlur={(e) => { onRename(v.code, e.target.value.trim() || v.code); setEditing(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <span key={v.code} className="inline-flex h-8 items-center rounded-lg border border-line bg-surface">
              <button
                type="button"
                className="flex h-full items-center gap-1.5 rounded-l-lg pl-2.5 pr-1.5 text-[13px] font-medium hover:bg-raised"
                title="Đổi tên hiển thị"
                onClick={() => setEditing(v.code)}
              >
                {v.label}
                {v.label !== v.code && <code className="rounded bg-raised px-1 font-mono text-[11px] text-muted">{v.code}</code>}
              </button>
              <button
                type="button"
                aria-label={`Bỏ ${v.label} và mọi giá của nó`}
                className="grid h-full w-7 place-items-center rounded-r-lg text-muted hover:bg-bad-soft hover:text-bad"
                onClick={() => onRemove(v.code)}
              >
                <X size={12} />
              </button>
            </span>
          )
        ))}
        {adding ? (
          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            <label className="flex flex-col gap-1">
              <span className="sr-only">Mã gửi nhà cung cấp</span>
              <Input autoFocus className="h-8 w-36 font-mono text-[12.5px]" placeholder={`Mã — ${example}`} value={code}
                aria-invalid={Boolean(codeError) || undefined}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setAdding(false); }} />
              {codeError && <span className="text-[11.5px] text-bad" role="alert">{codeError}</span>}
            </label>
            <label>
              <span className="sr-only">Tên buyer thấy</span>
              <Input className="h-8 w-40 text-[13px]" placeholder="Tên buyer thấy" value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setAdding(false); }} />
            </label>
            <Button size="sm" onClick={submit} disabled={!code.trim() || Boolean(codeError)}>Thêm</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setCode(""); setLabel(""); }}>Huỷ</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="border border-dashed border-line-2" onClick={() => setAdding(true)}>
            <Plus size={12} /> Thêm
          </Button>
        )}
      </div>
    </div>
  );
}

function DaysRow({ grid, onAdd, onRename, onRemove }: {
  grid: PriceGrid;
  onAdd: (days: number) => void;
  onRename: (days: number, label: string) => void;
  onRemove: (days: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const n = Number(value);
  const invalid = value !== "" && (!Number.isInteger(n) || n <= 0 || n > 3650);
  const exists = grid.days.includes(n);
  const sold = (d: number) => Object.entries(grid.prices).some(([key, price]) => price > 0 && key.endsWith(`|${d}`));

  const submit = () => {
    if (!value || invalid || exists) return;
    onAdd(n); setValue(""); setAdding(false);
  };

  return (
    <div className="grid gap-3 p-3 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Thời hạn <span className="ml-1 rounded-md bg-iris-soft px-1.5 py-0.5 text-[11px] font-medium text-iris-hi">cột</span></span>
        <span className="font-mono text-[11px] text-muted">gửi đi dưới tên: days</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {grid.days.map((d) => editing === d ? (
          <Input
            key={d}
            autoFocus
            aria-label={`Tên hiển thị của thời hạn ${d} ngày`}
            className="h-8 w-36 text-[13px]"
            defaultValue={dayLabel(grid, d)}
            onBlur={(e) => { onRename(d, e.target.value); setEditing(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <span key={d} className={cn("inline-flex h-8 items-center rounded-lg border bg-surface", sold(d) ? "border-line" : "border-dashed border-line-2")}
            title={sold(d) ? undefined : "Chưa bán gói nào ở thời hạn này — sẽ không được lưu"}>
            <button type="button" title="Đổi tên hiển thị" onClick={() => setEditing(d)}
              className="flex h-full items-center gap-1.5 rounded-l-lg pl-2.5 pr-1.5 text-[13px] font-medium hover:bg-raised">
              {dayLabel(grid, d)}
              {grid.dayLabels[String(d)] && <code className="rounded bg-raised px-1 font-mono text-[11px] text-muted">{d}</code>}
            </button>
            <button type="button" aria-label={`Bỏ thời hạn ${d} ngày và mọi giá của nó`}
              className="grid h-full w-7 place-items-center rounded-r-lg text-muted hover:bg-bad-soft hover:text-bad"
              onClick={() => onRemove(d)}>
              <X size={12} />
            </button>
          </span>
        ))}
        {adding ? (
          <div className="flex flex-wrap items-start gap-2">
            <label className="flex flex-col gap-1">
              <span className="sr-only">Số ngày</span>
              <Input autoFocus type="number" min={1} max={3650} className="h-8 w-24 font-mono text-[13px]" placeholder="Số ngày" value={value}
                aria-invalid={invalid || exists || undefined}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setAdding(false); }} />
              {(invalid || exists) && <span className="text-[11.5px] text-bad" role="alert">{exists ? "Đã có thời hạn này." : "Từ 1 đến 3650 ngày."}</span>}
            </label>
            <Button size="sm" onClick={submit} disabled={!value || invalid || exists}>Thêm</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setValue(""); }}>Huỷ</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="border border-dashed border-line-2" onClick={() => setAdding(true)}>
            <Plus size={12} /> Thêm
          </Button>
        )}
      </div>
    </div>
  );
}

function BulkTools({ grid, hasCosts, onAdjust, onMargin }: {
  grid: PriceGrid;
  hasCosts: boolean;
  onAdjust: (pct: number) => void;
  onMargin: (pct: number) => void;
}) {
  const [adjust, setAdjust] = useState("");
  const [margin, setMargin] = useState("");
  const anyPrice = Object.values(grid.prices).some((p) => p > 0);
  const adjustN = Number(adjust);
  const marginN = Number(margin);
  if (!anyPrice) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (adjust && adjustN > -100) { onAdjust(adjustN); setAdjust(""); } }}>
        <label htmlFor="grid-adjust" className="text-muted">Tăng/giảm mọi gói</label>
        <Input id="grid-adjust" type="number" step="1" className="h-8 w-20 font-mono text-[13px]" placeholder="±%" value={adjust} onChange={(e) => setAdjust(e.target.value)} />
        <span className="text-muted">%</span>
        <Button size="sm" variant="secondary" type="submit" disabled={!adjust || !(adjustN > -100)}>Áp dụng</Button>
      </form>
      {hasCosts && (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (margin && marginN >= 0) { onMargin(marginN); setMargin(""); } }}>
          <label htmlFor="grid-margin" className="text-muted">Đặt giá = vốn + lãi</label>
          <Input id="grid-margin" type="number" min={0} step="1" className="h-8 w-20 font-mono text-[13px]" placeholder="%" value={margin} onChange={(e) => setMargin(e.target.value)} />
          <span className="text-muted">%</span>
          <Button size="sm" variant="secondary" type="submit" disabled={!margin || !(marginN >= 0)}>Áp dụng</Button>
        </form>
      )}
    </div>
  );
}

function TypeGroup({ grid, type, view, costs, onPrice, onCopy }: {
  grid: PriceGrid;
  type: AxisValue;
  view: View;
  costs: GridCosts;
  onPrice: (key: string, price: number | null) => void;
  onCopy: () => void;
}) {
  const count = grid.networks.reduce((sum, n) => sum + grid.days.filter((d) => (grid.prices[cellKey(type.code, n.code, d)] ?? 0) > 0).length, 0);
  const others = grid.types.filter((t) => t.code !== type.code);
  return (
    <tbody>
      <tr className="border-t border-line bg-surface">
        <th scope="rowgroup" colSpan={grid.days.length + 1} className="px-3 py-2 text-left">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">
              {type.label}
              <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">{count} gói</span>
            </span>
            {others.length > 0 && count > 0 && (
              <button type="button" onClick={onCopy} className="rounded-md px-2 py-1 text-[12px] font-medium text-iris hover:bg-iris-soft">
                Chép giá sang {others.map((t) => t.label).join(", ")}
              </button>
            )}
          </div>
        </th>
      </tr>
      {grid.networks.map((n) => (
        <tr key={n.code} className="border-t border-line/70">
          <th scope="row" className="px-3 py-1.5 pl-6 text-left text-[13px] font-medium">
            {n.label}
            {n.label !== n.code && <code className="ml-1.5 rounded bg-raised px-1 font-mono text-[11px] font-normal text-muted">{n.code}</code>}
          </th>
          {grid.days.map((d) => {
            const key = cellKey(type.code, n.code, d);
            return (
              <td key={d} className="px-1.5 py-1.5 align-top">
                <PriceCell
                  label={`${type.label} · ${n.label} · ${dayLabel(grid, d)}`}
                  days={d}
                  price={grid.prices[key]}
                  state={cellState(grid, key, costs.costs, costs.minMarginPct)}
                  cost={costs.costs[key]?.cost ?? null}
                  minMarginPct={costs.minMarginPct}
                  showCost={costs.available}
                  view={view}
                  onChange={(price) => onPrice(key, price)}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  );
}

function PriceCell({ label, days, price, state, cost, minMarginPct, showCost, view, onChange }: {
  label: string;
  days: number;
  price: number | undefined;
  state: CellState;
  cost: number | null;
  minMarginPct: number;
  showCost: boolean;
  view: View;
  onChange: (price: number | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focusNext, setFocusNext] = useState(false);
  useEffect(() => {
    if (focusNext && input.current) { input.current.focus(); setFocusNext(false); }
  }, [focusNext, price]);

  if (price == null) {
    if (state === "unsupported") {
      return <div className="grid h-12 place-items-center text-[11.5px] text-muted" title="Nhà cung cấp không bán gói này">Nguồn không có</div>;
    }
    const floor = floorPrice(cost, minMarginPct);
    return (
      <button
        type="button"
        aria-label={`Mở bán ${label}`}
        onClick={() => { onChange(floor ?? 0); setFocusNext(true); }}
        className="h-12 w-full rounded-lg border border-dashed border-line-2 text-[12px] text-muted transition-colors hover:border-iris hover:text-iris"
      >
        + Mở bán
      </button>
    );
  }

  const floor = floorPrice(cost, minMarginPct);
  const m = marginPct(price, cost);
  let sub: string | null = null;
  let subTone = "text-muted";
  if (state === "unsupported") { sub = "Nguồn không mua được"; subTone = "text-bad"; }
  else if (state === "empty") { sub = "Nhập giá"; subTone = "text-warn"; }
  else if (state === "below_floor") { sub = `dưới sàn ${vnd(floor ?? 0)}`; subTone = "text-bad"; }
  else if (view === "perday") sub = `${vnd(price / days)}đ/ngày`;
  else if (view === "cost") sub = showCost ? (cost ? `vốn ${vnd(cost)}` : "chưa có vốn") : null;
  else if (showCost) sub = cost && m != null ? `lãi ${vnd(price - cost)} · ${m}%` : "chưa có vốn";

  return (
    <div className={cn(
      "rounded-lg border px-2 py-1 transition-colors focus-within:border-iris",
      state === "unsupported" || state === "below_floor" ? "border-bad bg-bad-soft" : state === "empty" ? "border-warn" : "border-line bg-surface",
    )}>
      <input
        ref={input}
        aria-label={`Giá ${label}`}
        aria-invalid={state === "unsupported" || state === "below_floor" || undefined}
        inputMode="numeric"
        className="h-6 w-full bg-transparent text-right font-mono text-[14px] font-semibold tabular text-fg outline-none"
        value={price > 0 ? vnd(price) : ""}
        onChange={(e) => onChange(digits(e.target.value))}
        onBlur={() => { if (!price) onChange(null); }}
      />
      {sub && <div className={cn("truncate text-right font-mono text-[11px] leading-4", subTone)}>{sub}</div>}
    </div>
  );
}

function BuyerPreview({ grid }: { grid: PriceGrid }) {
  const choices = useMemo(() => buyerChoices(grid), [grid]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = choices.find((c) => c.value === selected) ?? choices[0];
  const field: PricingField = {
    field: "plan_key",
    type: "radio",
    label: "Gói proxy",
    required: true,
    choices: choices.map(({ value, label }) => ({ value, label })),
  };
  const days = current ? Number(current.value.split("|")[2]) : 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">Buyer sẽ thấy</h3>
        <span className="rounded-md bg-iris-soft px-2 py-0.5 text-[11px] font-medium text-iris-hi">xem trước</span>
      </div>
      {current ? (
        <div className="space-y-3">
          <DproxyPackagePicker
            field={field}
            value={current.value}
            locale="vi"
            fieldLabels={{ type: grid.typeLabel, network: grid.networkLabel }}
            onChange={setSelected}
          />
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="font-mono text-[20px] font-semibold tabular">{vnd(current.price)}đ</span>
            {days > 0 && <span className="font-mono text-[12px] text-muted">{vnd(current.price / days)}đ/ngày</span>}
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">Chưa có gói nào có giá — buyer chưa chọn được gì.</p>
      )}
    </div>
  );
}
