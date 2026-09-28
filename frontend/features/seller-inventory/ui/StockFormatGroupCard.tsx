"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Input, Tag } from "@/components/ui";
import { AlertTriangle } from "@/components/Icons";
import { checkStockGroup, formatColumns, type StockFormatSplit } from "../logic";

const SAMPLE_ROWS = 3;

/** One batch of a stock upload before it is sent: its format line split into
 *  columns, a few lines under those columns, the login notes (editable) and
 *  what looks wrong. Nothing here blocks the upload except a batch with no
 *  account under its format. */
export function StockFormatGroupCard({
  group,
  name,
  note,
  onNoteChange,
  disabled = false,
  compact = false,
}: {
  group: StockFormatSplit;
  name?: string;
  note: string;
  onNoteChange?: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("sellerInventory");
  const check = checkStockGroup(group);
  if (!group.format || !check) return null;
  const columns = formatColumns(group.format);
  const sample = group.items.slice(0, compact ? 0 : SAMPLE_ROWS);
  const noteId = `stock-note-${name ?? "batch"}`.replace(/\W+/g, "-");

  return (
    <div className={cn("space-y-2 rounded-lg border bg-surface p-3", check.mismatch.total > 0 || check.looksLikeData ? "border-warn/40" : "border-iris/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <Tag tone="iris" className="font-semibold uppercase tracking-wide">{t("format.tag")}</Tag>
        <code className="min-w-0 max-w-full truncate font-mono text-[12.5px] font-semibold text-iris-hi" title={group.format}>{group.format}</code>
        <span className="text-faint">· {t("format.columns", { count: check.fieldCount })} · {t("format.accounts", { count: group.items.length })}</span>
        {name && <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint" title={name}>{name}</span>}
      </div>

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
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {t("format.looksLikeData")}</p>
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
