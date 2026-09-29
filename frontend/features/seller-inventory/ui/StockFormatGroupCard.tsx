"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button, Input, Tag } from "@/components/ui";
import { AlertTriangle } from "@/components/Icons";
import { checkStockGroup, formatColumns, STOCK_FORMAT_MAX_LENGTH, type StockFormatSplit } from "../logic";

const SAMPLE_ROWS = 3;

/** One batch of a stock upload before it is sent: its format line split into
 *  columns, a few lines under those columns, the login notes (editable) and
 *  what looks wrong. A batch with no account under its format, or whose line 1
 *  is an account and has no typed format (`onFormatChange`), blocks the upload.
 *  A batch sent without a format (the box is off) shows as such, with an offer
 *  to use line 1 when it reads like column names. */
export function StockFormatGroupCard({
  group,
  name,
  note,
  onNoteChange,
  onFormatChange,
  onUseFormat,
  onDisableFormat,
  disabled = false,
  compact = false,
}: {
  group: StockFormatSplit;
  name?: string;
  note: string;
  onNoteChange?: (value: string) => void;
  /** Line 1 is an account: the seller types the format here (files and large pastes). */
  onFormatChange?: (value: string) => void;
  /** Tick the "line 1 is the format" box (offered when line 1 reads like column names). */
  onUseFormat?: () => void;
  /** Untick it (offered when line 1 is an account). */
  onDisableFormat?: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("sellerInventory");
  const [keepHeader, setKeepHeader] = useState(false);
  if (group.unformatted) {
    const hint = group.headerHint && onUseFormat && !keepHeader;
    return (
      <div className={cn("space-y-2 rounded-lg border bg-surface p-3", hint ? "border-warn/50" : "border-line")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <Tag tone="neutral" className="font-semibold uppercase tracking-wide">{t("format.unformattedTag")}</Tag>
          <span className="text-muted">{t("format.accounts", { count: group.items.length })} · {t("format.unformattedHint")}</span>
          {name && <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint" title={name}>{name}</span>}
        </div>
        {hint && (
          <div className="space-y-2 rounded-md border border-warn/40 bg-warn-soft p-2.5">
            <p className="text-[12px] font-semibold text-fg">{t("format.headerHintTitle")}</p>
            <code className="block truncate font-mono text-[12px] text-fg" title={group.items[0]}>{group.items[0]}</code>
            <p className="text-[11.5px] text-muted">{t("format.headerHintBody")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onUseFormat} disabled={disabled}>{t("format.useAsFormat")}</Button>
              <Button size="sm" variant="secondary" onClick={() => setKeepHeader(true)} disabled={disabled}>{t("format.keepAsAccount")}</Button>
            </div>
          </div>
        )}
      </div>
    );
  }
  const check = checkStockGroup(group);
  if (!check) return null;
  const columns = group.format ? formatColumns(group.format) : [];
  const sample = group.format ? group.items.slice(0, compact ? 0 : SAMPLE_ROWS) : [];
  const noteId = `stock-note-${name ?? "batch"}`.replace(/\W+/g, "-");
  const formatId = `stock-format-${name ?? "batch"}`.replace(/\W+/g, "-");
  const blocked = check.missingFormat || check.looksLikeData;

  return (
    <div className={cn("space-y-2 rounded-lg border bg-surface p-3", blocked ? "border-bad/40" : check.mismatch.total > 0 ? "border-warn/40" : "border-iris/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <Tag tone={blocked ? "bad" : "iris"} className="font-semibold uppercase tracking-wide">{t("format.tag")}</Tag>
        {group.format
          ? <code className="min-w-0 max-w-full truncate font-mono text-[12.5px] font-semibold text-iris-hi" title={group.format}>{group.format}</code>
          : <span className="font-medium text-bad">{t("format.missingTag")}</span>}
        <span className="text-faint">· {t("format.columns", { count: check.fieldCount })} · {t("format.accounts", { count: group.items.length })}</span>
        {name && <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint" title={name}>{name}</span>}
      </div>

      {check.missingFormat && (
        <p role="alert" className="flex items-start gap-1.5 text-[11.5px] font-medium text-bad">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {onFormatChange ? t("format.firstLineIsAccount") : t("format.firstLineIsAccountTyped")}
        </p>
      )}
      {check.missingFormat && onDisableFormat && (
        <Button size="sm" onClick={onDisableFormat} disabled={disabled}>{t("format.disableFormat")}</Button>
      )}
      {group.needsFormat && onFormatChange && (
        <div className="space-y-1">
          <label htmlFor={formatId} className="text-[12px] font-medium text-muted">{t("format.typeLabel")}</label>
          <Input
            id={formatId}
            value={group.format ?? ""}
            disabled={disabled}
            maxLength={STOCK_FORMAT_MAX_LENGTH}
            onChange={(event) => onFormatChange(event.target.value)}
            placeholder={t("format.typePlaceholder", { count: check.fieldCount })}
            aria-invalid={blocked}
            className="h-9 font-mono text-[12.5px]"
          />
        </div>
      )}

      {sample.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-max text-left text-[11.5px]">
            <thead className="bg-iris-soft/40 text-[10.5px] font-semibold uppercase tracking-wide text-iris-hi">
              <tr>{columns.map((column, index) => <th key={index} scope="col" className="px-2 py-1.5">{column || "—"}</th>)}</tr>
            </thead>
            <tbody className="font-mono text-fg">
              {sample.map((line, row) => {
                const cells = line.split("|");
                return (
                  <tr key={row} className="border-t border-line">
                    {columns.map((_, index) => (
                      <td key={index} className={cn("max-w-[180px] truncate px-2 py-1", index >= cells.length && "text-warn")}>
                        {index < cells.length ? cells[index] : t("format.missingCell")}
                      </td>
                    ))}
                    {cells.length > columns.length && <td className="px-2 py-1 text-warn">+{cells.slice(columns.length).join("|")}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {onNoteChange && (
        <div className="space-y-1">
          <label htmlFor={noteId} className="text-[12px] font-medium text-muted">
            {t("format.noteLabel")} <span className="font-normal text-faint">· {t("format.noteOptional")}</span>
          </label>
          <Input
            id={noteId}
            value={note}
            disabled={disabled}
            maxLength={500}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder={t("format.notePlaceholder")}
            className="h-9 text-[12.5px]"
          />
        </div>
      )}

      {!onNoteChange && group.note && (
        <p className="text-[12px] text-fg"><span className="text-muted">{t("format.noteLabel")}:</span> {group.note}</p>
      )}

      {check.looksLikeData && (
        <p role="alert" className="flex items-start gap-1.5 text-[11.5px] font-medium text-bad"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {t("format.looksLikeData", { max: STOCK_FORMAT_MAX_LENGTH })}</p>
      )}
      {check.mismatch.total > 0 && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("format.mismatch", { count: check.mismatch.total, lines: check.mismatch.lines.slice(0, 6).join(", ") })}
        </p>
      )}
      {check.empty && <p role="alert" className="text-[11.5px] font-medium text-bad">{t("format.empty")}</p>}
    </div>
  );
}
