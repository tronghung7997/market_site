"use client";

import * as React from "react";
import { Search } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { LedgerSuggestion } from "@/lib/types";
import { useLedgerSearch } from "../data";

const KIND_LABEL: Record<LedgerSuggestion["kind"], string> = {
  order: "Đơn hàng",
  deposit: "Lệnh nạp",
  account: "Tài khoản",
  amount: "Số tiền",
  entry: "Giao dịch",
};

/**
 * Ô tìm "dán gì cũng được": email, ORD-…, mã nạp NAP…, số tiền, mã giao dịch.
 * Backend nhận diện và trả về bộ lọc tương ứng; chọn một gợi ý là áp bộ lọc đó.
 * ⌘K / Ctrl K đưa con trỏ vào ô từ bất cứ đâu trên trang.
 */
export function SmartSearch({ onPick }: { onPick: (s: LedgerSuggestion) => void }) {
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const term = useDebounce(text.trim(), 250);
  const search = useLedgerSearch(term);
  const items = term.length >= 2 ? search.data ?? [] : [];
  const listId = React.useId();

  React.useEffect(() => { setActive(0); }, [term]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const pick = (s: LedgerSuggestion) => {
    onPick(s);
    setText("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const s = items[active]; if (s) pick(s); }
  };

  const showList = open && term.length >= 2;
  return (
    <div ref={rootRef} className="relative w-full sm:w-[420px]">
      <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
        aria-label="Tìm trong dòng tiền"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Dán email, ORD-…, mã nạp, số tiền…"
        className="h-10 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-14 text-[13px] text-fg placeholder:text-placeholder focus:border-iris focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-muted">⌘K</kbd>
      {showList && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-card-lg">
          {search.isLoading && !items.length ? (
            <li className="px-3 py-4 text-center text-[12.5px] text-muted">Đang tìm…</li>
          ) : search.isError ? (
            <li className="px-3 py-4 text-center text-[12.5px] text-bad">Không tìm được, thử lại sau</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-4 text-center text-[12.5px] text-muted">Không khớp email, mã đơn, mã nạp hay số tiền nào</li>
          ) : items.map((s, i) => (
            <li
              key={`${s.kind}-${s.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5", i === active && "bg-raised")}
            >
              <span className="w-[72px] shrink-0 text-[11px] font-medium text-muted">{KIND_LABEL[s.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[13px] text-fg", (s.kind === "order" || s.kind === "deposit" || s.kind === "amount") && "font-mono tabular-nums")}>{s.label}</span>
                {s.detail && <span className="block truncate text-[11.5px] text-muted">{s.detail}</span>}
              </span>
              {i === active && <span aria-hidden className="text-[11px] text-faint">↵</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
