"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { Copy, Globe, Info, Plus, RotateCcw } from "@/components/Icons";
import {
  canRotate, connectionString, hasAddress, cooldownRemaining, daysLeft, lineNoLabel, lineState, locationLabel, proxyKindLabel,
  type LineState, type ProxyLine, type ProxyTag,
} from "../model";
import { OverflowText } from "./OverflowText";
import { ProxyTagChip } from "./ProxyTagChip";

export interface LineActionHandlers {
  onOpen: (line: ProxyLine) => void;
  onRotate: (line: ProxyLine) => void;
  onTag: (line: ProxyLine) => void;
  onCopied: (ok: boolean) => void;
}

const STATE_TONE: Record<LineState, string> = {
  running: "text-good", soon: "text-warn", offline: "text-warn", expired: "text-bad", error: "text-bad",
};
const STATE_DOT: Record<LineState, string> = {
  running: "bg-good", soon: "bg-warn", offline: "bg-warn", expired: "bg-bad", error: "bg-bad",
};

export function StateLabel({ state, className }: { state: LineState; className?: string }) {
  const t = useTranslations("buyerProxies");
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium", STATE_TONE[state], className)}>
      <span aria-hidden className={cn("inline-block h-1.5 w-1.5 rounded-full", STATE_DOT[state])} />
      {t(`state.${state}`)}
    </span>
  );
}

/** Remaining-term bar: green → amber under 3 days → red when gone. */
export function TermBar({ line, className }: { line: ProxyLine; className?: string }) {
  const t = useTranslations("buyerProxies");
  const locale = useLocale();
  const state = lineState(line);
  const total = Math.max(1, (new Date(line.expires_at).getTime() - new Date(line.created_at).getTime()) / 86_400_000);
  const left = daysLeft(line);
  const pct = state === "expired" ? 0 : Math.max(4, Math.min(100, Math.round((left / total) * 100)));
  // Expired: the status label already says so; the bar shows *when* instead.
  const label = state === "expired"
    ? new Date(line.expires_at).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", { day: "2-digit", month: "2-digit" })
    : left < 1 ? t("term.today") : t("term.days", { n: Math.floor(left) });
  const tone = state === "expired" ? "bg-bad" : left <= 3 ? "bg-warn" : "bg-good";
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line" aria-hidden><span className={cn("block h-full", tone)} style={{ width: `${pct}%` }} /></span>
      <span className={cn("font-mono text-[11.5px] font-semibold tabular whitespace-nowrap", state === "expired" ? "text-bad" : left <= 3 ? "text-warn" : "text-fg")}>{label}</span>
    </span>
  );
}

export function HostCell({ line, onCopied }: { line: ProxyLine; onCopied: (ok: boolean) => void }) {
  const t = useTranslations("buyerProxies");
  const cred = line.username
    ? <>{line.username} · <span aria-label={t("passwordHidden")}>••••••</span></>
    : <>{line.socks5_port ? <>SOCKS5 :{line.socks5_port} · </> : null}{t("exitIp")} {line.public_ip ?? "—"}</>;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {hasAddress(line) ? (
          <button
            type="button"
            onClick={() => {
              const clip = navigator.clipboard;
              if (!clip) { onCopied(false); return; }
              clip.writeText(connectionString(line)).then(() => onCopied(true), () => onCopied(false));
            }}
            title={t("copyConnection")}
            className="group inline-flex min-w-0 items-center gap-1.5 rounded text-left font-mono text-[12.5px] font-medium text-fg hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <span className="break-all">{line.host}<span className="text-faint">:</span><span className="font-semibold text-iris-hi">{line.port}</span></span>
            <Copy size={11} className="shrink-0 text-faint group-hover:text-iris" />
          </button>
        ) : (
          <span className="text-[12.5px] leading-snug text-muted">{t("noAddress")}</span>
        )}
      </div>
      <div className="mt-1 break-all font-mono text-[11px] leading-snug text-faint">{cred}</div>
    </div>
  );
}

export function TagsCell({ line, tags, onTag, addLabel }: { line: ProxyLine; tags: Map<string, ProxyTag>; onTag: () => void; addLabel: string }) {
  const shown = line.tag_ids.map((id) => tags.get(id)).filter((x): x is ProxyTag => Boolean(x));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((tag) => <ProxyTagChip key={tag.id} tag={tag} />)}
      <button
        type="button"
        onClick={onTag}
        aria-label={addLabel}
        title={addLabel}
        className="grid h-5 w-5 place-items-center rounded-md border border-dashed border-line-2 text-faint hover:border-iris hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

function RowActions({ line, handlers, busy }: { line: ProxyLine; handlers: LineActionHandlers; busy: boolean }) {
  const t = useTranslations("buyerProxies");
  const cooldown = cooldownRemaining(line);
  const rotatable = canRotate(line) && cooldown === 0;
  const rotateTitle = !line.rotation_available ? t("action.rotateUnsupported") : cooldown > 0 ? t("action.rotateCooldown", { s: cooldown }) : t("action.rotate");
  const btn = "grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";
  return (
    <div className="flex items-center justify-end gap-0.5">
      {line.rotation_available && (
        <button type="button" className={btn} disabled={!rotatable || busy} onClick={() => handlers.onRotate(line)} title={rotateTitle} aria-label={rotateTitle}>
          <RotateCcw size={13} className={busy ? "animate-spin" : undefined} />
        </button>
      )}
      <button type="button" className={btn} onClick={() => handlers.onOpen(line)} title={t("action.details")} aria-label={t("action.details")}><Info size={13} /></button>
    </div>
  );
}

export function ProxiesTable({
  lines, tags, selected, onToggle, onTogglePage, handlers, empty, busyLine,
}: {
  lines: ProxyLine[];
  tags: Map<string, ProxyTag>;
  selected: Set<string>;
  onToggle: (id: string, shift: boolean) => void;
  onTogglePage: () => void;
  handlers: LineActionHandlers;
  empty: React.ReactNode;
  busyLine: string | null;
}) {
  const t = useTranslations("buyerProxies");
  const allOnPage = lines.length > 0 && lines.every((l) => selected.has(l.id));
  const someOnPage = lines.some((l) => selected.has(l.id));
  const th = "px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-faint whitespace-nowrap";
  const td = "px-4 py-3.5 align-top";

  if (lines.length === 0) return <div>{empty}</div>;

  return (
    <table className="w-full table-fixed border-collapse">
      <thead className="border-b border-line bg-raised/40">
        <tr>
          <th className={cn(th, "w-10")}>
            <input
              type="checkbox"
              aria-label={t("selectPage")}
              checked={allOnPage}
              ref={(el) => { if (el) el.indeterminate = !allOnPage && someOnPage; }}
              onChange={onTogglePage}
              className="h-3.5 w-3.5 accent-iris"
            />
          </th>
          <th className={cn(th, "w-[124px]")}>{t("col.line")}</th>
          <th className={cn(th, "w-[20%]")}>{t("col.proxy")}</th>
          <th className={cn(th, "w-[19%]")}>{t("col.kind")}</th>
          <th className={th}>{t("col.tags")}</th>
          <th className={cn(th, "w-[140px]")}>{t("col.status")}</th>
          <th className={cn(th, "w-[60px] text-right")}><span className="sr-only">{t("col.actions")}</span></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const state = lineState(line);
          const isSel = selected.has(line.id);
          const dead = state === "expired";
          return (
            <tr
              key={line.id}
              className={cn("border-b border-line last:border-b-0 transition-colors hover:bg-raised/40", isSel && "bg-iris-soft/40", dead && "text-faint")}
              aria-selected={isSel}
            >
              <td className={td}>
                <input
                  type="checkbox"
                  aria-label={t("selectLine", { id: line.id })}
                  checked={isSel}
                  onClick={(e) => onToggle(line.id, e.shiftKey)}
                  onChange={() => {}}
                  className="mt-0.5 h-3.5 w-3.5 accent-iris"
                />
              </td>
              <td className={td}>
                <button type="button" onClick={() => handlers.onOpen(line)} className="rounded text-left font-mono text-[11.5px] leading-tight text-muted hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
                  <span className="block whitespace-nowrap text-[11px] text-faint">{line.order_code}</span>
                  <span className="font-semibold text-fg">{lineNoLabel(line)}</span>
                </button>
              </td>
              <td className={td}><HostCell line={line} onCopied={handlers.onCopied} /></td>
              <td className={td}>
                <div className="text-[12.5px] font-medium leading-snug text-fg">{t(`kind.${proxyKindLabel(line)}`)}</div>
                <OverflowText
                  as="div"
                  lines={2}
                  className="mt-1 text-[11.5px] leading-snug text-muted"
                  text={[locationLabel(line), line.protocol].filter(Boolean).join(" · ")}
                />
              </td>
              <td className={td}>
                <TagsCell line={line} tags={tags} onTag={() => handlers.onTag(line)} addLabel={t("action.addTag")} />
                {line.note && <OverflowText as="div" lines={2} className="mt-1.5 text-[11.5px] leading-snug text-muted" text={line.note} />}
              </td>
              <td className={td}>
                <StateLabel state={state} />
                <TermBar line={line} className="mt-1" />
                {state === "offline" && <div className="mt-0.5 text-[10.5px] text-faint">{t("state.offlineHint")}</div>}
              </td>
              <td className={td}><RowActions line={line} handlers={handlers} busy={busyLine === line.id} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Mobile: one stacked record per line, same actions. */
export function ProxyLineCard({
  line, tags, selected, onToggle, handlers, busy,
}: { line: ProxyLine; tags: Map<string, ProxyTag>; selected: boolean; onToggle: () => void; handlers: LineActionHandlers; busy: boolean }) {
  const t = useTranslations("buyerProxies");
  const state = lineState(line);
  return (
    <div className={cn("rounded-card border border-line bg-card p-3 shadow-card", selected && "border-iris/40 bg-iris-soft/30")}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={t("selectLine", { id: line.id })} className="mt-1 h-4 w-4 accent-iris" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-faint">{line.order_code} <b className="text-fg">{lineNoLabel(line)}</b></span>
            <StateLabel state={state} />
          </div>
          <HostCell line={line} onCopied={handlers.onCopied} />
          <div className="text-[12px] text-muted"><Globe size={11} className="mr-1 inline text-faint" />{[t(`kind.${proxyKindLabel(line)}`), locationLabel(line), line.protocol].filter(Boolean).join(" · ")}</div>
          <TagsCell line={line} tags={tags} onTag={() => handlers.onTag(line)} addLabel={t("action.addTag")} />
          <div className="flex items-center justify-between gap-2">
            <TermBar line={line} />
            <div className="flex gap-1">
              {line.rotation_available && (
                <Button size="sm" variant="ghost" className="h-10 px-2.5" disabled={!canRotate(line) || cooldownRemaining(line) > 0 || busy} onClick={() => handlers.onRotate(line)} aria-label={t("action.rotate")}>
                  <RotateCcw size={14} className={busy ? "animate-spin" : undefined} />
                </Button>
              )}
              <Button size="sm" variant="secondary" className="h-10" onClick={() => handlers.onOpen(line)}>{t("action.details")}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
