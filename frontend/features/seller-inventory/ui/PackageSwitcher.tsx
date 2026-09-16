"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { sellerInventoryPath } from "@/lib/routes";
import { useMoney } from "@/lib/money";
import type { InventoryPackageDetail } from "@/lib/types";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search } from "@/components/Icons";
import { useAllInventoryPackages } from "../useInventory";

const RECENT_KEY = "seller-inventory-recent-packages";
const RECENT_MAX = 5;

function readRecent(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function rememberRecentPackage(variantId: number) {
  try {
    const next = [variantId, ...readRecent().filter((id) => id !== variantId)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // per-viewer convenience only
  }
}

/** Package name as a combobox: siblings of the same product, search across
 *  every package, recently opened — plus ‹ › to step through siblings. */
export function PackageSwitcher({ pkg }: { pkg: InventoryPackageDetail }) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const router = useRouter();
  const { formatBrowseMoney } = useMoney();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // The header card clips overflow, so the list is portalled to <body> and
  // pinned under the trigger; it follows scroll/resize while open.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) { setAnchor(null); return; }
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);
  const all = useAllInventoryPackages(open);

  useEffect(() => { setRecent(readRecent().filter((id) => id !== pkg.variant_id)); }, [pkg.variant_id]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); cancelAnimationFrame(frame); };
  }, [open]);

  const siblings = pkg.siblings;
  const index = siblings.findIndex((s) => s.variant_id === pkg.variant_id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const go = (target: { variant_id: number; variant_key?: string | null }) => { setOpen(false); setQuery(""); router.push(sellerInventoryPath(target)); };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !all.data) return [];
    return all.data.items
      .filter((p) => p.variant_id !== pkg.variant_id)
      .filter((p) => p.variant_name.toLowerCase().includes(q) || p.product_title.toLowerCase().includes(q) || (p.variant_key ?? "") === q.replace(/^#/, ""))
      .slice(0, 8);
  }, [query, all.data, pkg.variant_id]);
  const recentRows = useMemo(() => {
    if (!all.data) return [];
    return recent.map((id) => all.data!.items.find((p) => p.variant_id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [recent, all.data]);

  const Row = ({ target, name, sub, available, active, current }: { target: { variant_id: number; variant_key?: string | null }; name: string; sub?: string; available: number; active: boolean; current?: boolean }) => (
    <button
      type="button"
      onClick={() => go(target)}
      className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-raised", current && "bg-iris-soft/50", !active && "opacity-60")}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(current && "font-semibold")}>{name}</span>
        {sub && <span className="ml-1 text-[11px] text-faint">· {sub}</span>}
        {!active && <span className="ml-1 text-[11px] text-faint">· {t("state.inactive")}</span>}
      </span>
      <span className={cn("font-mono text-[12px] tabular", available === 0 ? "text-bad" : "text-fg")}>{available.toLocaleString(locale)}</span>
      {current && <Check size={13} className="text-iris" />}
    </button>
  );

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-9 max-w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left transition-colors hover:border-faint", open ? "border-iris ring-2 ring-iris/20" : "border-line-2")}
      >
        <span className="truncate text-[15px] font-bold text-fg" title={pkg.variant_name}>{pkg.variant_name}</span>
        <span className="font-mono text-[12.5px] text-muted">{formatBrowseMoney(pkg.price, { locale })}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      <span className="inline-flex overflow-hidden rounded-lg border border-line-2">
        <button type="button" disabled={!prev} onClick={() => prev && go(prev)} title={prev?.variant_name} aria-label={t("switcher.prev")} className="inline-flex h-7 w-7 items-center justify-center border-r border-line-2 text-muted hover:bg-raised hover:text-fg disabled:opacity-40"><ChevronLeft size={13} /></button>
        <button type="button" disabled={!next} onClick={() => next && go(next)} title={next?.variant_name} aria-label={t("switcher.next")} className="inline-flex h-7 w-7 items-center justify-center text-muted hover:bg-raised hover:text-fg disabled:opacity-40"><ChevronRight size={13} /></button>
      </span>
      {siblings.length > 0 && <span className="text-[11.5px] text-faint">{t("switcher.position", { index: index + 1, total: siblings.length })}</span>}

      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          role="listbox"
          style={{ position: "fixed", top: anchor.top, left: anchor.left }}
          className="z-[80] w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-card-lg"
        >
          <div className="relative mb-1.5">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("switcher.searchPlaceholder")}
              className="h-8 w-full rounded-lg border border-line-2 bg-raised/40 pl-8 pr-2 text-[12.5px] text-fg outline-none focus:border-iris"
            />
          </div>
          {query.trim() ? (
            <div className="max-h-72 overflow-y-auto">
              {all.isPending ? <p className="px-2.5 py-2 text-[12px] text-muted">{t("switcher.loading")}</p>
                : matches.length === 0 ? <p className="px-2.5 py-2 text-[12px] text-muted">{t("switcher.noMatch")}</p>
                : matches.map((p) => <Row key={p.variant_id} target={p} name={p.variant_name} sub={p.product_title} available={p.available} active={p.is_active} />)}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{t("switcher.sameProduct", { product: pkg.product_title })}</p>
              {siblings.map((s) => <Row key={s.variant_id} target={s} name={s.variant_name} available={s.available} active={s.is_active} current={s.variant_id === pkg.variant_id} />)}
              {recentRows.length > 0 && (
                <>
                  <div className="my-1.5 border-t border-line" />
                  <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{t("switcher.recent")}</p>
                  {recentRows.map((p) => <Row key={p.variant_id} target={p} name={p.variant_name} sub={p.product_title} available={p.available} active={p.is_active} />)}
                </>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
