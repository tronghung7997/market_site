"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Check, Download, Plus, Trash } from "@/components/Icons";
import {
  EXPORT_FORMATS, MAX_TAG_NAME, TAG_TONES, cooldownRemaining, matchTagImport, normalizeTagName, parseTagImport,
  renderExport, type ExportFormat, type ProxyLine, type ProxyTag, type TagTone,
} from "../model";
import { ProxyTagChip, TAG_DOT } from "./ProxyTagChip";

export interface TagChange { add: string[]; remove: string[] }

const PANEL = "max-w-lg gap-4 rounded-2xl border-line bg-surface p-5 shadow-card-lg";

function ToneRadio({ value, onChange }: { value: TagTone; onChange: (t: TagTone) => void }) {
  const t = useTranslations("buyerProxies");
  return (
    <div role="radiogroup" aria-label={t("tags.tone")} className="flex items-center gap-1.5">
      {TAG_TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          aria-label={t(`tags.tones.${tone}`)}
          onClick={() => onChange(tone)}
          className={cn("grid h-6 w-6 place-items-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris", value === tone ? "border-fg" : "border-line hover:border-line-2")}
        >
          <span className={cn("h-3 w-3 rounded-[3px]", TAG_DOT[tone])} />
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ assign tags */

export function TagAssignDialog({
  open, lines, linesLoading, tags, onClose, onApply, onCreateTag, initialTab,
}: {
  open: boolean;
  initialTab?: "pick" | "import";
  lines: ProxyLine[];
  /** Import from the header loads every line first; matching waits for it. */
  linesLoading?: boolean;
  tags: ProxyTag[];
  onClose: () => void;
  /** Resolves when applied; rejects with a message already shown to the user. */
  onApply: (change: TagChange, mode: "merge" | "replace", perLine?: Map<string, string[]>) => Promise<void>;
  onCreateTag: (name: string, tone: TagTone) => Promise<ProxyTag | null>;
}) {
  const t = useTranslations("buyerProxies");
  const tc = useTranslations("common");
  const [tab, setTab] = useState<"pick" | "import">("pick");
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<TagTone>("iris");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [add, setAdd] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) { setTab(initialTab ?? "pick"); setQuery(""); setAdd(new Set()); setRemove(new Set()); setCsv(""); setMode("merge"); }
  }, [open, initialTab]);

  // How many of the selected lines already carry each tag → "3 / 12" hints and tri-state boxes.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) for (const id of l.tag_ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [lines]);
  const q = normalizeTagName(query).toLowerCase();
  const visible = tags.filter((tg) => !q || tg.name.toLowerCase().includes(q));
  const exactExists = Boolean(q) && tags.some((tg) => tg.name.toLowerCase() === q);

  const stateOf = (id: string): "all" | "some" | "none" => {
    if (add.has(id)) return "all";
    if (remove.has(id)) return "none";
    const n = counts.get(id) ?? 0;
    return n === 0 ? "none" : n === lines.length ? "all" : "some";
  };
  const cycle = (id: string) => {
    const s = stateOf(id);
    const a = new Set(add); const r = new Set(remove);
    if (s === "all") { a.delete(id); r.add(id); } else { r.delete(id); a.add(id); }
    setAdd(a); setRemove(r);
  };
  const create = async () => {
    setCreating(true);
    try {
      const tag = await onCreateTag(query, tone);
      if (tag) { setAdd((prev) => new Set(prev).add(tag.id)); setRemove((prev) => { const r = new Set(prev); r.delete(tag.id); return r; }); setQuery(""); }
    } finally { setCreating(false); }
  };

  const importMatch = useMemo(() => matchTagImport(parseTagImport(csv), lines), [csv, lines]);

  const apply = async () => {
    setBusy(true);
    try {
      if (tab === "import") await onApply({ add: [], remove: [] }, "merge", importMatch.perLine);
      else await onApply({ add: [...add], remove: [...remove] }, mode);
      onClose();
    } catch {
      // The caller already reported the failure; keep the dialog open to retry.
    } finally { setBusy(false); }
  };
  const dirty = tab === "import" ? importMatch.perLine.size > 0 && !linesLoading : add.size + remove.size > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className={PANEL}>
        <div>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("tags.assignTitle", { n: lines.length })}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("tags.assignHint")}</DialogDescription>
        </div>
        <div role="tablist" className="flex gap-1 border-b border-line text-[12.5px] font-medium">
          {(["pick", "import"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris rounded-t", tab === k ? "border-fg text-fg" : "border-transparent text-faint hover:text-fg")}>
              {t(`tags.tab.${k}`)}
            </button>
          ))}
        </div>

        {tab === "pick" ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tags.searchOrCreate")} aria-label={t("tags.searchOrCreate")} className="h-9 text-[13px]" maxLength={MAX_TAG_NAME}
                onKeyDown={(e) => { if (e.key === "Enter" && q && !exactExists && !creating) { e.preventDefault(); void create(); } }} />
              {q && !exactExists && (
                <div className="flex items-center gap-2">
                  <ToneRadio value={tone} onChange={setTone} />
                  <Button size="sm" variant="secondary" onClick={() => void create()} disabled={creating} className="h-9"><Plus size={13} /> {t("tags.create")}</Button>
                </div>
              )}
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1" aria-label={t("tags.listLabel")}>
              {visible.length === 0 && <li className="px-2 py-3 text-center text-[12.5px] text-faint">{t("tags.noMatch")}</li>}
              {visible.map((tag) => {
                const s = stateOf(tag.id);
                const n = add.has(tag.id) ? lines.length : remove.has(tag.id) ? 0 : counts.get(tag.id) ?? 0;
                return (
                  <li key={tag.id}>
                    <button type="button" role="checkbox" aria-checked={s === "all" ? true : s === "some" ? "mixed" : false} onClick={() => cycle(tag.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
                      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", s === "none" ? "border-line-2 bg-surface" : "border-iris bg-iris text-white", s === "some" && "opacity-60")}>
                        {s === "all" && <Check size={10} />}{s === "some" && <span className="h-0.5 w-2 rounded bg-white" />}
                      </span>
                      <ProxyTagChip tag={tag} size="md" />
                      <span className="ml-auto font-mono text-[11px] tabular text-faint">{t("tags.onLines", { n, total: lines.length })}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <fieldset className="grid gap-1.5 sm:grid-cols-2">
              <legend className="sr-only">{t("tags.modeLabel")}</legend>
              {(["merge", "replace"] as const).map((m) => (
                <label key={m} className={cn("flex cursor-pointer gap-2 rounded-lg border p-2.5 text-[12px]", mode === m ? "border-iris bg-iris-soft/40" : "border-line hover:border-line-2")}>
                  <input type="radio" name="tag-mode" checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 accent-iris" />
                  <span><b className="block font-semibold text-fg">{t(`tags.mode.${m}.title`)}</b><span className="text-muted">{t(`tags.mode.${m}.body`)}</span></span>
                </label>
              ))}
            </fieldset>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={7} className="font-mono text-[12px]" placeholder={"113.161.20.5:35270,FB-Farm-01|Team A\n171.244.8.91:40118,FB-Farm-01"} aria-label={t("tags.importLabel")} />
            <p className="text-[12px] text-muted">{t("tags.importHint")}</p>
            {linesLoading && <p className="text-[12px] text-muted" role="status">{t("tags.importLoading")}</p>}
            {csv.trim() && !linesLoading && (
              <p className="text-[12px]">
                <span className="font-semibold text-fg">{t("tags.importMatched", { n: importMatch.perLine.size })}</span>
                {importMatch.unknown > 0 && <span className="ml-2 text-warn">{t("tags.importUnknown", { n: importMatch.unknown })}</span>}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>{tc("cancel")}</Button>
          <Button size="sm" onClick={apply} disabled={!dirty || busy}>{busy ? t("applying") : t("tags.apply", { n: tab === "import" ? importMatch.perLine.size : lines.length })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------ manage tags */

export function ManageTagsDialog({
  open, tags, onClose, onCreate, onUpdate, onDelete,
}: {
  open: boolean;
  tags: ProxyTag[];
  onClose: () => void;
  /** Each resolves true on success; failures are reported by the caller. */
  onCreate: (name: string, tone: TagTone) => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<Pick<ProxyTag, "name" | "tone">>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("buyerProxies");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [tone, setTone] = useState<TagTone>("iris");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(""); setConfirm(null); } }, [open]);
  const run = async (key: string, op: () => Promise<boolean>) => {
    setPending(key);
    try { return await op(); } finally { setPending(null); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={PANEL}>
        <div>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("tags.manageTitle")}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("tags.manageHint")}</DialogDescription>
        </div>
        <form className="flex flex-wrap items-center gap-2 sm:flex-nowrap" onSubmit={(e) => {
          e.preventDefault();
          if (!normalizeTagName(name)) return;
          void run("new", () => onCreate(name, tone)).then((ok) => { if (ok) setName(""); });
        }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tags.newName")} aria-label={t("tags.newName")} className="h-9 min-w-0 flex-1 text-[13px]" maxLength={MAX_TAG_NAME} />
          <ToneRadio value={tone} onChange={setTone} />
          <Button size="sm" type="submit" className="h-9" disabled={!normalizeTagName(name) || pending !== null}><Plus size={13} /> {t("tags.create")}</Button>
        </form>
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {tags.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-faint">{t("tags.none")}</li>}
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2 sm:flex-nowrap" aria-busy={pending === tag.id}>
              <ToneRadio value={tag.tone} onChange={(tn) => { if (tn !== tag.tone) void run(tag.id, () => onUpdate(tag.id, { tone: tn })); }} />
              <Input key={tag.name} defaultValue={tag.name} aria-label={t("tags.rename", { name: tag.name })} className="h-8 min-w-0 flex-1 text-[13px]" maxLength={MAX_TAG_NAME}
                onBlur={(e) => {
                  const input = e.currentTarget;
                  const v = normalizeTagName(input.value);
                  if (!v || v === tag.name) { input.value = tag.name; return; }
                  void run(tag.id, () => onUpdate(tag.id, { name: v })).then((ok) => { if (!ok) input.value = tag.name; });
                }} />
              <span className="w-16 text-right font-mono text-[11px] tabular text-faint">{t("tags.usage", { n: tag.count })}</span>
              {confirm === tag.id ? (
                <Button size="sm" variant="danger" className="h-8" disabled={pending !== null} onClick={() => { void run(tag.id, () => onDelete(tag.id)).then(() => setConfirm(null)); }}>{t("tags.confirmDelete")}</Button>
              ) : (
                <button type="button" onClick={() => setConfirm(tag.id)} aria-label={t("tags.delete", { name: tag.name })} className="grid h-8 w-8 place-items-center rounded-md text-faint hover:bg-bad-soft hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"><Trash size={13} /></button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t border-line pt-3"><Button size="sm" variant="secondary" onClick={onClose}>{tc("close")}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- export */

export function ExportDialog({ open, lines, tagName, onClose }: { open: boolean; lines: ProxyLine[]; tagName: (id: string) => string; onClose: () => void }) {
  const t = useTranslations("buyerProxies");
  const tc = useTranslations("common");
  const [format, setFormat] = useState<ExportFormat>("host_port_user_pass");
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => renderExport(lines, format, tagName), [lines, format, tagName]);
  const ext = format === "csv" ? "csv" : format === "json" ? "json" : "txt";
  const download = () => {
    const blob = new Blob([text], { type: format === "json" ? "application/json" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `proxies-${new Date().toISOString().slice(0, 10)}-${lines.length}.${ext}`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={PANEL}>
        <div>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("export.title", { n: lines.length })}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("export.hint")}</DialogDescription>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
          {t("export.format")}
          <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} className="h-9 text-[13px]">
            {EXPORT_FORMATS.map((f) => <option key={f} value={f}>{t(`export.formats.${f}`)}</option>)}
          </Select>
        </label>
        <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-raised/50 p-3 font-mono text-[11.5px] leading-relaxed text-fg" aria-label={t("export.preview")}>{text.split("\n").slice(0, 40).join("\n")}{lines.length > 40 && format !== "json" ? `\n… ${t("export.more", { n: lines.length - 40 })}` : ""}</pre>
        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={onClose}>{tc("close")}</Button>
          <Button size="sm" variant="secondary" onClick={() => {
            navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => setCopied(false));
          }}>{copied ? tc("copied") : tc("copy")}</Button>
          <Button size="sm" onClick={download}><Download size={13} /> {t("export.download", { ext })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- whitelist */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function WhitelistDialog({
  open, lines, onClose, onConfirm,
}: { open: boolean; lines: ProxyLine[]; onClose: () => void; onConfirm: (ipv4: string) => Promise<void> }) {
  const t = useTranslations("buyerProxies");
  const tc = useTranslations("common");
  const supported = lines.filter((l) => l.whitelist_supported);
  const current = supported[0]?.whitelist_ips ?? "";
  const [ip, setIp] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setIp(current); }, [open, current]);
  const valid = ip.trim() === "" || IPV4.test(ip.trim());
  const inCooldown = supported.filter((l) => cooldownRemaining(l) > 0).length;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className={PANEL}>
        <div>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("whitelist.title", { n: supported.length })}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("whitelist.hint")}</DialogDescription>
        </div>
        {lines.length > supported.length && <p className="rounded-lg border border-line bg-raised/40 px-3 py-2 text-[12px] text-muted">{t("whitelist.skipped", { n: lines.length - supported.length })}</p>}
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
          {t("whitelist.ipLabel")}
          <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="113.161.20.5" className="h-9 font-mono text-[13px]" aria-invalid={!valid} inputMode="decimal" />
          {!valid && <span className="text-[12px] text-bad" role="alert">{t("whitelist.invalid")}</span>}
        </label>
        <p className="text-[12px] text-faint">{t("whitelist.oneIp")}{inCooldown > 0 && <> {t("whitelist.cooldown", { n: inCooldown })}</>}</p>
        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>{tc("cancel")}</Button>
          <Button size="sm" disabled={!valid || busy || supported.length === 0} onClick={async () => {
            setBusy(true);
            try { await onConfirm(ip.trim()); onClose(); } catch { /* reported by the caller; stay open to retry */ } finally { setBusy(false); }
          }}>
            {busy ? t("applying") : ip.trim() ? t("whitelist.activate") : t("whitelist.clear")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
