"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { ProductLocale } from "@/lib/types";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ChevronDown, FileText } from "@/components/Icons";
import { ConfirmDialog } from "@/features/seller-inventory/ui/ConfirmDialog";
import { applyMarkdownAction, DESCRIPTION_TEMPLATES, type MarkdownAction } from "../model";

type Mode = "write" | "preview" | "split";

const TOOLBAR: { action: MarkdownAction; label: string; className?: string }[] = [
  { action: "bold", label: "B", className: "font-bold" },
  { action: "italic", label: "I", className: "italic" },
  { action: "h2", label: "H2" },
  { action: "h3", label: "H3" },
  { action: "ul", label: "•" },
  { action: "ol", label: "1." },
  { action: "quote", label: "❝" },
  { action: "link", label: "🔗" },
  { action: "code", label: "`code`", className: "font-mono" },
  { action: "codeblock", label: "```", className: "font-mono" },
  { action: "table", label: "▦" },
  { action: "hr", label: "—" },
];

/** Markdown editor with Write / Preview / Split modes. The preview renders
 *  through the storefront `MarkdownContent` at the storefront column width so
 *  tables and code blocks look exactly as buyers will see them. Toolbar
 *  buttons insert syntax so nobody has to memorise it. */
export function DescriptionField({
  id, value, onChange, locale, placeholder, className,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  locale: ProductLocale;
  placeholder?: string;
  className?: string;
}) {
  const t = useTranslations("sellerProductForm.description");
  const [mode, setMode] = useState<Mode>("write");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templatesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingSelection || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pendingSelection.start, pendingSelection.end);
    setPendingSelection(null);
  }, [pendingSelection, value]);

  useEffect(() => {
    if (!templatesOpen) return;
    const onDown = (e: MouseEvent) => { if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) setTemplatesOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [templatesOpen]);

  const run = (action: MarkdownAction) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = applyMarkdownAction({ value, start, end }, action, locale);
    onChange(next.value);
    if (mode === "preview") setMode("split");
    setPendingSelection({ start: next.start, end: next.end });
  };

  const applyTemplate = (body: string) => {
    onChange(body);
    setTemplatesOpen(false);
    setConfirmTemplate(null);
    if (mode === "write") setMode("split");
    setPendingSelection({ start: 0, end: 0 });
  };
  const useTemplate = (body: string) => {
    if (value.trim()) { setTemplatesOpen(false); setConfirmTemplate(body); return; }
    applyTemplate(body);
  };

  const editor = (
    <textarea
      id={id}
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="min-h-[360px] w-full resize-y rounded-b-lg bg-surface px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-fg outline-none placeholder:text-faint"
    />
  );
  const preview = (
    <div className="min-h-[360px] overflow-auto rounded-b-lg bg-base p-4">
      <div className="mx-auto w-full max-w-[720px] rounded-card border border-line bg-card p-5 text-[13.5px] shadow-card">
        {value.trim()
          ? <MarkdownContent>{value}</MarkdownContent>
          : <p className="text-[12.5px] text-faint">{t("previewEmpty")}</p>}
      </div>
    </div>
  );

  return (
    <div className={cn("rounded-lg border border-line-2 bg-surface focus-within:border-iris focus-within:ring-2 focus-within:ring-iris/20", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-raised/50 px-2 py-1.5">
        <div role="tablist" aria-label={t("modeLabel")} className="mr-1 inline-flex rounded-md border border-line bg-surface p-0.5">
          {(["write", "preview", "split"] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded px-2 py-0.5 text-[11.5px] font-medium", mode === m ? "bg-iris text-white" : "text-muted hover:text-fg")}>
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
        {mode !== "preview" && TOOLBAR.map((item) => (
          <button
            key={item.action}
            type="button"
            title={t(`tool.${item.action}`)}
            aria-label={t(`tool.${item.action}`)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(item.action)}
            className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-[12px] text-muted hover:bg-surface hover:text-fg", item.className)}
          >
            {item.label}
          </button>
        ))}
        <div ref={templatesRef} className="relative ml-auto">
          <button type="button" onClick={() => setTemplatesOpen((o) => !o)} aria-haspopup="menu" aria-expanded={templatesOpen} className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11.5px] font-medium text-iris hover:bg-surface">
            <FileText size={12} /> {t("useTemplate")} <ChevronDown size={11} />
          </button>
          {templatesOpen && (
            <div role="menu" className="absolute right-0 top-8 z-30 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-card-lg">
              {DESCRIPTION_TEMPLATES[locale].map((template) => (
                <button key={template.key} type="button" role="menuitem" onClick={() => useTemplate(template.body)} className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-raised/60">
                  <span className="block text-[12.5px] font-semibold text-fg">{t(`template.${template.key}`)}</span>
                  <span className="block text-[11.5px] text-muted">{t(`templateHint.${template.key}`)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {mode === "write" && editor}
      {mode === "preview" && preview}
      {mode === "split" && (
        <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div>{editor}</div>
          <div className="min-w-0">{preview}</div>
        </div>
      )}
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-faint">{t("hint")}</div>
      <ConfirmDialog
        open={confirmTemplate != null}
        title={t("templateReplaceTitle")}
        description={t("templateReplaceConfirm")}
        confirmLabel={t("templateReplaceAction")}
        cancelLabel={t("templateReplaceCancel")}
        onConfirm={() => { if (confirmTemplate != null) applyTemplate(confirmTemplate); }}
        onCancel={() => setConfirmTemplate(null)}
      />
    </div>
  );
}
