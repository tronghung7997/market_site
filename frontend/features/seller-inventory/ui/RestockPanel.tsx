"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { InventoryPackageDetail, RestockPreview, RestockResult } from "@/lib/types";
import { Button, Input, Textarea } from "@/components/ui";
import { AlertTriangle, Check, CheckCircle2, Download, Upload, X } from "@/components/Icons";
import { downloadRestockTemplate, mergeRestockText, parseResourceItems, parseRestockFileContent } from "../logic";
import { useRestock, useRestockPreview } from "../useInventory";

const MAX_LINES = 5000;

function Stat({ label, value, tone = "neutral", hint }: { label: string; value: string; tone?: "neutral" | "warn" | "bad" | "good"; hint?: string }) {
  const color = { neutral: "text-fg", warn: "text-warn", bad: "text-bad", good: "text-good" }[tone];
  return (
    <div className={cn("rounded-lg border bg-surface px-3 py-2", tone === "bad" ? "border-bad/30" : "border-line")}>
      <div className="text-[11px] text-faint">{label}</div>
      <div className={cn("font-mono text-[15px] font-semibold tabular", color)}>
        {value}{hint && <span className="ml-1 text-[11px] font-medium text-faint">· {hint}</span>}
      </div>
    </div>
  );
}

export function RestockPanel({ pkg, onClose, onDone }: { pkg: InventoryPackageDetail; onClose: () => void; onDone: (result: RestockResult) => void }) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const restock = useRestock(pkg.variant_id);
  const preview = useRestockPreview(pkg.variant_id);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<RestockPreview | null>(null);
  // Raw lines (duplicates kept) so the server preview can report them; the
  // add endpoint de-duplicates on its own and echoes the skip counters back.
  const items = useMemo(() => parseResourceItems(text, false), [text]);
  const tooMany = items.length > MAX_LINES;

  // Live server preview: duplicates already in stock + field-count check.
  useEffect(() => {
    if (items.length === 0 || tooMany) { setPreviewData(null); return; }
    const handle = setTimeout(() => {
      preview.mutate(items, { onSuccess: setPreviewData, onError: () => setPreviewData(null) });
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tooMany]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      if (raw) setText((prev) => mergeRestockText(prev, parseRestockFileContent(file.name, raw)));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const submit = async () => {
    if (items.length === 0 || tooMany) return;
    setError(null);
    try {
      const result = await restock.mutateAsync(items);
      setText("");
      setFileName(null);
      setPreviewData(null);
      onDone(result);
    } catch (err) {
      setError(apiErrorMessage(err, t("restock.failed")));
    }
  };

  const expected = previewData?.expected_field_count ?? pkg.expected_field_count;
  const toAdd = previewData?.to_add ?? items.length;

  return (
    <div className="rounded-xl border border-iris/35 bg-iris-soft/20 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Upload size={14} className="text-iris" />
          {t("restock.title")} <span className="text-iris-hi">{pkg.variant_name}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => downloadRestockTemplate("txt", "sample_inventory_template")} className="h-7 gap-1 text-[11.5px] text-iris"><Download size={12} /> {t("restock.template")}</Button>
          <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-line-2 bg-raised px-2 text-[11.5px] font-medium text-fg hover:border-faint">
            <Upload size={12} /> {t("restock.upload")}
            <Input type="file" accept=".txt,.csv" onChange={handleFile} className="hidden" />
          </label>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("restock.close")} className="h-7 w-7 p-0 text-muted"><X size={14} /></Button>
        </div>
      </div>

      <p className="text-[11.5px] text-muted">
        {t("restock.rule")} <code className="rounded bg-raised px-1 font-mono text-fg">user|pass|2fa</code> · <code className="rounded bg-raised px-1 font-mono text-fg">license_key</code>
        {expected && expected > 1 && <> · {t("restock.expectedFields", { count: expected })}</>}
      </p>

      <Textarea
        autoFocus
        rows={5}
        value={text}
        onChange={(e) => { setText(e.target.value); if (fileName) setFileName(null); }}
        placeholder={t("restock.placeholder")}
        className="bg-surface font-mono text-xs leading-relaxed"
      />

      {items.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("restock.stat.recognized")} value={items.length.toLocaleString(locale)} hint={fileName ?? undefined} />
          <Stat label={t("restock.stat.duplicateInFile")} value={(previewData?.duplicate_in_file ?? 0).toLocaleString(locale)} tone={(previewData?.duplicate_in_file ?? 0) > 0 ? "warn" : "neutral"} hint={(previewData?.duplicate_in_file ?? 0) > 0 ? t("restock.stat.skipped") : undefined} />
          <Stat label={t("restock.stat.existing")} value={(previewData?.existing_in_stock ?? 0).toLocaleString(locale)} tone={(previewData?.existing_in_stock ?? 0) > 0 ? "warn" : "neutral"} hint={(previewData?.existing_in_stock ?? 0) > 0 ? t("restock.stat.skipped") : undefined} />
          <Stat label={t("restock.stat.malformed")} value={(previewData?.malformed_total ?? 0).toLocaleString(locale)} tone={(previewData?.malformed_total ?? 0) > 0 ? "bad" : "neutral"} hint={previewData && previewData.malformed.length > 0 ? t("restock.stat.lines", { lines: previewData.malformed.slice(0, 5).map((m) => m.line).join(", ") }) : undefined} />
        </div>
      )}

      {previewData && previewData.malformed_total > 0 && expected && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("restock.malformedHint", { expected, count: previewData.malformed_total })}
        </p>
      )}
      {tooMany && (
        <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2 text-xs font-medium text-bad">{t("restock.tooMany", { max: MAX_LINES.toLocaleString(locale) })}</p>
      )}
      {error && <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2 text-xs font-medium text-bad">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11.5px] text-faint">{t("restock.dedupe")}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>{t("restock.cancel")}</Button>
          <Button size="sm" onClick={() => void submit()} disabled={restock.isPending || items.length === 0 || tooMany || toAdd === 0} className="gap-1.5">
            {restock.isPending ? <>{t("restock.submitting")}</> : <><Check size={13} /> {t("restock.submit", { count: toAdd.toLocaleString(locale) })}</>}
          </Button>
        </div>
      </div>
      {previewData && previewData.to_add === 0 && items.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><CheckCircle2 size={13} /> {t("restock.nothingNew")}</p>
      )}
    </div>
  );
}
