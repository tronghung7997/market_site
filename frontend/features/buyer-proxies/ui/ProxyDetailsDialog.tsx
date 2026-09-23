"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { Button, CopyButton, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Eye, EyeOff, Plus, RotateCcw, ShieldCheck } from "@/components/Icons";
import {
  MAX_NOTE, canRotate, connectionString, cooldownRemaining, lineNoLabel, lineState, locationLabel, proxyKindLabel,
  type ProxyLine, type ProxyTag,
  hasAddress,
} from "../model";
import { ProxyTagChip } from "./ProxyTagChip";
import { StateLabel, TermBar } from "./ProxiesTable";

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-2 text-[12.5px]">
      <span className="text-faint">{k}</span>
      <span className={cn("min-w-0 break-all text-fg", mono && "font-mono")}>{v}</span>
    </div>
  );
}

/** Inspector for one line: address, credentials, rotate, whitelist, term,
 *  tags, private note and the escrow link to its order. Only actions the
 *  backend supports are offered. */
export function ProxyDetailsDialog({
  line, tags, onClose, onRotate, onTag, onWhitelist, onNote, rotating,
}: {
  line: ProxyLine;
  tags: Map<string, ProxyTag>;
  onClose: () => void;
  onRotate: () => void;
  onTag: () => void;
  onWhitelist: () => void;
  /** Resolves true once saved; failures are reported by the caller. */
  onNote: (note: string) => Promise<boolean>;
  rotating: boolean;
}) {
  const t = useTranslations("buyerProxies");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [reveal, setReveal] = useState(false);
  const [note, setNote] = useState(line.note);
  const [savingNote, setSavingNote] = useState(false);
  const [cooldown, setCooldown] = useState(cooldownRemaining(line));
  useEffect(() => { setCooldown(cooldownRemaining(line)); }, [line.last_rotated_at, line.cooldown_seconds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNote(line.note); }, [line.note]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const state = lineState(line);
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const lineTags = line.tag_ids.map((id) => tags.get(id)).filter((x): x is ProxyTag => Boolean(x));
  const rotatable = canRotate(line) && cooldown === 0;
  const location = locationLabel(line);
  const saveNote = async () => {
    const next = note.trim();
    if (next === line.note.trim()) return;
    setSavingNote(true);
    try { if (!(await onNote(next))) setNote(line.note); } finally { setSavingNote(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-2xl gap-0 overflow-y-auto rounded-2xl border-line bg-surface p-0 shadow-card-lg">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4 pr-14">
          <div className="min-w-0">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-[16px] font-bold text-fg">
              <span className="font-mono text-[13px] text-muted">{line.order_code}<span className="text-fg"> {lineNoLabel(line)}</span></span>
              <span>{[t(`kind.${proxyKindLabel(line)}`), line.network].filter(Boolean).join(" · ")}</span>
              <StateLabel state={state} />
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12px] text-muted">
              {line.product_title} · {line.variant_name} · {t("details.bought", { date: fmt(line.created_at) })}
            </DialogDescription>
          </div>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          {/* Address + credentials */}
          <section className="space-y-3 rounded-card border border-line p-4">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{line.rotation === "rotating_key" ? t("details.gateway") : t("details.address")}</h3>
            {hasAddress(line) ? (
              <p className="break-all font-mono text-[20px] font-semibold leading-tight text-fg">{line.host}<span className="text-faint">:</span><span className="text-iris-hi">{line.port}</span></p>
            ) : (
              <p className="text-[13px] text-muted">{t("noAddress")}</p>
            )}
            {line.socks5_port && (
              <p className="-mt-1 font-mono text-[12.5px] text-muted">HTTP <span className="text-fg">:{line.port}</span> · SOCKS5 <span className="text-fg">:{line.socks5_port}</span> <span className="text-faint">— {t("details.twoPorts")}</span></p>
            )}
            <div className="space-y-1.5">
              <Row k={t("details.protocol")} v={line.protocol} />
              {line.username ? (
                <>
                  <Row k={t("details.username")} v={line.username} mono />
                  <Row k={t("details.password")} v={
                    <span className="inline-flex items-center gap-2">
                      <span>{reveal ? line.password : "••••••••"}</span>
                      <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? t("details.hide") : t("details.show")} className="grid h-6 w-6 place-items-center rounded text-faint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">{reveal ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                    </span>
                  } mono />
                </>
              ) : (
                <Row k={t("details.auth")} v={t("details.authByIp")} />
              )}
              <Row k={t("exitIp")} v={line.public_ip ?? "—"} mono />
              {location && <Row k={t("details.location")} v={location} />}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <CopyButton text={connectionString(line)} label={t("copyConnection")} className="rounded-lg border border-line-2 bg-raised px-2.5 py-1.5 text-[12px] text-fg" />
              {line.rotation_available && (
                <Button size="sm" onClick={onRotate} disabled={!rotatable || rotating}>
                  <RotateCcw size={13} className={rotating ? "animate-spin" : undefined} />
                  {cooldown > 0 ? t("action.rotateCooldown", { s: cooldown }) : t("action.rotate")}
                </Button>
              )}
            </div>
            {line.rotation_available && (
              <p className="text-[11.5px] text-faint">{t("details.rotateExplain", { s: line.cooldown_seconds ?? 0 })}{line.last_rotated_at && <> · {t("details.lastRotated", { at: fmt(line.last_rotated_at) })}</>}</p>
            )}
          </section>

          {/* Term + whitelist */}
          <section className="space-y-3 rounded-card border border-line p-4">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{t("details.term")}</h3>
            <TermBar line={line} />
            <Row k={t("details.expires")} v={fmt(line.expires_at)} />
            {state === "offline" && <p className="text-[11.5px] text-muted">{t("state.offlineHint")}</p>}
            {line.whitelist_supported && (
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                  {t("whitelist.label")}
                  <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold normal-case tracking-normal", line.whitelist_ips ? "bg-good-soft text-good" : "bg-warn-soft text-warn")}>
                    {line.whitelist_ips ? <><ShieldCheck size={11} /> {t("whitelist.active")}</> : t("whitelist.pending")}
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-all rounded-lg border border-line bg-raised/40 px-3 py-2 font-mono text-[13px] text-fg">{line.whitelist_ips ?? t("whitelist.none")}</span>
                  <Button size="sm" variant="secondary" onClick={onWhitelist} disabled={state === "expired"}>{line.whitelist_ips ? t("whitelist.update") : t("whitelist.activate")}</Button>
                </div>
                <p className="text-[11.5px] text-muted">{t("whitelist.hint")}</p>
              </div>
            )}
          </section>

          {/* Tags + note */}
          <section className="space-y-3 rounded-card border border-line p-4 md:col-span-2">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{t("col.tags")}</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {lineTags.map((tag) => <ProxyTagChip key={tag.id} tag={tag} size="md" />)}
              <button type="button" onClick={onTag} className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-line-2 px-2 text-[12px] text-faint hover:border-iris hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"><Plus size={11} /> {t("action.addTag")}</button>
            </div>
            <label htmlFor={`note-${line.id}`} className="block pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{t("details.note")}</label>
            <Textarea id={`note-${line.id}`} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void saveNote()} disabled={savingNote}
              rows={2} maxLength={MAX_NOTE} placeholder={t("details.notePlaceholder")} className="min-h-[56px] text-[12.5px]" aria-busy={savingNote} />
            <p className="text-[11px] text-faint" role={savingNote ? "status" : undefined}>{savingNote ? t("details.noteSaving") : t("details.noteHint")}</p>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised/30 px-5 py-3 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} className="text-good" /> {t("details.escrow", { order: line.order_code })}</span>
          <div className="flex items-center gap-2">
            <Link href={`/orders?order=${encodeURIComponent(line.order_code)}`} className="inline-flex items-center gap-1 rounded font-medium text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">{t("details.openOrder")} <ExternalLink size={12} /></Link>
            <Button size="sm" variant="secondary" onClick={onClose}>{tc("close")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
