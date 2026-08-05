"use client";

import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { InventoryVariant, Resource } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { Check, ChevronRight, Plus, Trash } from "@/components/Icons";

/* Còn hàng nhưng dưới ngưỡng này thì seller cần biết trước khi khách phát hiện.
   Hết sạch (0) tính riêng — đó là mất doanh thu ngay, không phải cảnh báo sớm. */
const LOW_STOCK = 5;

type Filter = "all" | "out" | "low" | "error";

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  available: "good",
  assigned: "neutral",
  expired: "warn",
  error: "bad",
};

/* Viền trái mã trạng thái: đọc được cả khi lướt nhanh hàng trăm dòng. */
const STATUS_EDGE: Record<string, string> = {
  available: "border-l-good",
  assigned: "border-l-line-2",
  expired: "border-l-warn",
  error: "border-l-bad",
};

export default function InventoryPage() {
  const t = useTranslations("seller");
  // useSearchParams cần Suspense, nếu không Next bắt cả trang render động.
  return (
    <Suspense fallback={<Spinner label={t("inventoryLoading")} />}>
      <Inventory />
    </Suspense>
  );
}

function Inventory() {
  const t = useTranslations("seller");
  const searchParams = useSearchParams();
  const targetVariant = Number(searchParams.get("variant")) || null;

  const [rows, setRows] = useState<InventoryVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [openVariant, setOpenVariant] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.inventorySummary());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Đến từ nút "quản lý" của một gói cụ thể: mở sẵn đúng gói đó. Bộ lọc phải về
     "tất cả", nếu không gói được trỏ tới có thể không khớp bộ lọc và không hiện. */
  useEffect(() => {
    if (targetVariant) {
      setOpenVariant(targetVariant);
      setFilter("all");
    }
  }, [targetVariant]);

  if (loading) return <Spinner label={t("inventoryLoading")} />;

  const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
  const outCount = rows.filter((r) => r.available === 0).length;
  const lowCount = rows.filter((r) => r.available > 0 && r.available <= LOW_STOCK).length;
  const errorCount = rows.filter((r) => r.error > 0).length;

  const shown = rows.filter((r) => {
    if (filter === "out") return r.available === 0;
    if (filter === "low") return r.available > 0 && r.available <= LOW_STOCK;
    if (filter === "error") return r.error > 0;
    return true;
  });

  /* Gom theo product_id qua Map, không dựa vào việc các dòng cùng sản phẩm nằm
     liền nhau: tên sản phẩm không duy nhất, nên thứ tự có thể xen kẽ. */
  const groups = new Map<number, { id: number; title: string; variants: InventoryVariant[] }>();
  for (const r of shown) {
    const g = groups.get(r.product_id)
      ?? { id: r.product_id, title: r.product_title, variants: [] };
    g.variants.push(r);
    groups.set(r.product_id, g);
  }
  const byProduct = [...groups.values()];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-[24px] font-semibold tracking-tight">{t("inventoryTitle")}</h1>
          <p className="text-[12.5px] text-muted mt-0.5">
            {t("inventorySummary", { count: totalAvailable })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            {t("inventoryAll", { count: rows.length })}
          </FilterChip>
          {outCount > 0 && (
            <FilterChip active={filter === "out"} onClick={() => setFilter("out")} tone="bad">
              {t("inventoryOut", { count: outCount })}
            </FilterChip>
          )}
          {lowCount > 0 && (
            <FilterChip active={filter === "low"} onClick={() => setFilter("low")} tone="warn">
              {t("inventoryLow", { count: lowCount })}
            </FilterChip>
          )}
          {errorCount > 0 && (
            <FilterChip active={filter === "error"} onClick={() => setFilter("error")} tone="bad">
              {t("inventoryErrors", { count: errorCount })}
            </FilterChip>
          )}
        </div>
      </div>

      {byProduct.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13px] text-muted">
            {rows.length === 0
              ? t("inventoryEmpty")
              : t("inventoryNoFilterResults")}
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {byProduct.map((p) => (
            <div key={p.id}>
              {/* Kèm mã sản phẩm vì tên không duy nhất — seller có thể có hai sản
                  phẩm trùng tên, và hai tiêu đề giống hệt nhau trông như lỗi. */}
              <h2 className="mb-2">
                <Link
                  href={`/seller/products/${p.id}`}
                  className="inline-flex items-baseline gap-1.5 text-[12px] uppercase tracking-wider text-faint hover:text-iris-hi transition-colors"
                >
                  {p.title}
                  <span className="font-mono normal-case tracking-normal text-[11px]">#{p.id}</span>
                </Link>
              </h2>
              <Card className="overflow-hidden">
                <div className="divide-y divide-line">
                  {p.variants.map((v) => (
                    <VariantRow
                      key={v.variant_id}
                      row={v}
                      open={openVariant === v.variant_id}
                      highlight={targetVariant === v.variant_id}
                      onToggle={() =>
                        setOpenVariant(openVariant === v.variant_id ? null : v.variant_id)
                      }
                      onChanged={load}
                    />
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active, onClick, children, tone,
}: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: "warn" | "bad" }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors cursor-pointer",
        active
          ? "bg-ink-panel text-white border-ink-panel"
          : tone === "warn"
          ? "bg-warn-soft text-warn border-warn/20 hover:border-warn/40"
          : tone === "bad"
          ? "bg-bad-soft text-bad border-bad/20 hover:border-bad/40"
          : "bg-raised text-muted border-line hover:border-line-2",
      )}
    >
      {children}
    </button>
  );
}

/* Thanh tồn kho: tỉ lệ sẵn/đã bán/lỗi của chính gói này, không phải thanh tiến độ. */
function StockBar({ row }: { row: InventoryVariant }) {
  const total = row.available + row.assigned + row.expired + row.error;
  if (total === 0) return <div className="h-1.5 w-full rounded-full bg-line" />;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="h-1.5 w-full rounded-full bg-line overflow-hidden flex">
      <div className="bg-good h-full" style={{ width: seg(row.available) }} />
      <div className="bg-line-2 h-full" style={{ width: seg(row.assigned) }} />
      <div className="bg-warn h-full" style={{ width: seg(row.expired) }} />
      <div className="bg-bad h-full" style={{ width: seg(row.error) }} />
    </div>
  );
}

function VariantRow({
  row, open, highlight, onToggle, onChanged,
}: { row: InventoryVariant; open: boolean; highlight: boolean; onToggle: () => void; onChanged: () => void }) {
  const t = useTranslations("seller");
  const out = row.available === 0;
  const low = !out && row.available <= LOW_STOCK;
  const ref = useRef<HTMLDivElement>(null);
  /* Được trỏ tới từ trang khác: cuộn tới rồi tắt viền nổi. Nó chỉ để trả lời
     "mình vừa đáp xuống đâu", nên hết nhiệm vụ là biến mất chứ không đứng mãi. */
  const [lit, setLit] = useState(highlight);

  useEffect(() => {
    if (!highlight) return;
    setLit(true);
    ref.current?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    const t = setTimeout(() => setLit(false), 2200);
    return () => clearTimeout(t);
  }, [highlight]);

  return (
    <div
      ref={ref}
      className={cn(
        "scroll-mt-24 transition-colors duration-700",
        lit && "bg-iris-soft ring-1 ring-inset ring-iris/40",
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-raised/50 transition-colors cursor-pointer"
      >
        <ChevronRight
          size={14}
          className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium truncate">{row.variant_name}</span>
            {out && <Tag tone="bad">{t("inventoryOutTag")}</Tag>}
            {low && <Tag tone="warn">{t("inventoryLowTag")}</Tag>}
            {!row.is_active && <Tag tone="neutral">{t("inventoryInactiveTag")}</Tag>}
          </div>
          <div className="mt-1.5 max-w-[280px]"><StockBar row={row} /></div>
        </div>
        <div className="shrink-0 text-right font-mono text-[12px] tabular">
          <div className={cn("font-semibold", out ? "text-bad" : low ? "text-warn" : "text-good")}>
            {t("inventoryAvailable", { count: row.available })}
          </div>
          <div className="text-faint">{t("inventoryAssigned", { count: row.assigned })}</div>
        </div>
      </button>
      {open && <VariantLines variantId={row.variant_id} onChanged={onChanged} />}
    </div>
  );
}

function VariantLines({ variantId, onChanged }: { variantId: number; onChanged: () => void }) {
  const t = useTranslations("seller");
  const [items, setItems] = useState<Resource[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setItems(await api.sellerVariantResources(variantId));
  }, [variantId]);

  useEffect(() => { load(); }, [load]);

  const addLines = async () => {
    const lines = paste.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      await api.addResources(variantId, lines);
      setPaste("");
      setAdding(false);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("inventoryAddFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (items === null) {
    return <div className="px-5 pb-4 pl-12 text-[12px] text-faint">{t("inventoryLoadLines")}</div>;
  }

  return (
    <div className="pl-12 pr-5 pb-4 space-y-1.5 bg-raised/30">
      {items.length === 0 && !adding && (
        <p className="py-2 text-[12.5px] text-muted">
          {t("inventoryNoLines")}
        </p>
      )}

      {items.map((r) => (
        <ResourceLine key={r.id} resource={r} onChanged={() => { load(); onChanged(); }} />
      ))}

      {adding ? (
        <div className="pt-1.5 space-y-2">
          <textarea
            autoFocus
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            placeholder={t("inventoryPastePlaceholder")}
            className="w-full font-mono text-[12px] rounded-lg border border-line bg-panel px-3 py-2 focus:border-iris focus:outline-none"
          />
          {err && <p className="text-[12px] text-bad">{err}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={addLines} disabled={busy || !paste.trim()}>
              {busy ? t("inventoryAdding") : t("inventoryAddLines", { count: paste.split("\n").filter((l) => l.trim()).length })}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setPaste(""); setErr(""); }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 pt-1.5 text-[12px] text-iris-hi hover:underline cursor-pointer"
        >
          <Plus size={12} /> {t("inventoryPasteMore")}
        </button>
      )}
    </div>
  );
}

function ResourceLine({ resource, onChanged }: { resource: Resource; onChanged: () => void }) {
  const t = useTranslations("seller");
  const editable = resource.status === "available";
  const statusLabels: Record<string, string> = {
    available: t("inventoryResourceAvailable"),
    assigned: t("inventoryResourceAssigned"),
    expired: t("inventoryResourceExpired"),
    error: t("inventoryResourceError"),
  };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(resource.data);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(resource.data), [resource.data]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const save = async () => {
    const next = value.trim();
    if (!next || next === resource.data) {
      setValue(resource.data);
      setEditing(false);
      setErr("");
      return;
    }
    setBusy(true);
    try {
      await api.updateResource(resource.id, next);
      setEditing(false);
      setErr("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("inventorySaveFailed"));
      setValue(resource.data);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteResource(resource.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("inventoryDeleteFailed"));
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-3 rounded-r-md border-l-2 bg-panel pl-3 pr-2 py-1.5",
          STATUS_EDGE[resource.status] ?? "border-l-line",
        )}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") { setValue(resource.data); setEditing(false); setErr(""); }
            }}
            className="min-w-0 flex-1 font-mono text-[12px] bg-transparent border-0 p-0 focus:outline-none"
          />
        ) : (
          <button
            onClick={() => editable && setEditing(true)}
            disabled={!editable}
            title={editable ? t("inventoryEditHint") : undefined}
            className={cn(
              "min-w-0 flex-1 text-left font-mono text-[12px] truncate",
              editable ? "cursor-text hover:text-iris-hi" : "cursor-default text-muted",
            )}
          >
            {resource.data}
          </button>
        )}

        <Tag tone={STATUS_TONE[resource.status] ?? "neutral"} className="shrink-0">
          {resource.status === "assigned" && resource.order_id
            ? t("inventoryAssignedOrder", { id: resource.order_id })
            : statusLabels[resource.status] ?? resource.status}
        </Tag>

        {editable && !editing && (
          <button
            onClick={remove}
            disabled={busy}
            aria-label={t("inventoryDeleteLine")}
            className="shrink-0 p-1 rounded text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-bad transition-opacity cursor-pointer"
          >
            <Trash size={12} />
          </button>
        )}
        {editing && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] text-faint">
            <Check size={11} /> {t("inventoryEnterToSave")}
          </span>
        )}
      </div>
      {err && <p className="pl-3 pt-1 text-[11.5px] text-bad">{err}</p>}
    </div>
  );
}
