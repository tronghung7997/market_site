"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SourceRepriceResult, SourceSellerCandidate, SourceSettings, SourceTestResult } from "@/lib/types";
import { Banner, Button, Card, Input, Select, Spinner, Switch, Tag } from "@/components/ui";
import { AlertTriangle, CheckCircle2, Info, Key, Pause, Plug, RefreshCw, Store } from "@/components/Icons";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { suggestPrice } from "../logic";
import { RepriceDialog } from "./RepriceDialog";
import { relTime } from "./shared";

const ROUND_OPTIONS = [100, 500, 1000, 5000, 10000] as const;

/** Mọi cấu hình của một nguồn ở một chỗ. Seller nội bộ sửa luật giá và
 *  ngưỡng an toàn; kết nối, cửa hàng bán, tạm dừng chỉ admin thấy. */
export function SettingsTab({ area, sourceRef: ref, onSaved, kind = "catalog" }: {
  area: SourceArea; sourceRef: string; onSaved: () => Promise<void>; kind?: "catalog" | "gateway";
}) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const [settings, setSettings] = useState<SourceSettings | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setSettings(await api.sources.settings(area, ref));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [area, ref]);

  const saved = async (next: SourceSettings) => {
    setSettings(next);
    await onSaved();
  };

  if (error && !settings) {
    return <div className="pt-4"><Banner tone="bad" icon={<AlertTriangle size={15} />} action={<Button size="sm" variant="secondary" onClick={load}>{t("retry")}</Button>}>{error}</Banner></div>;
  }
  if (!settings) return <Spinner />;

  return (
    <div className="space-y-4 pt-4">
      {settings.can_manage_connection && <ConnectionSection area={area} sref={ref} s={settings} onSaved={saved} />}
      {kind === "gateway" ? (
        <CallSection area={area} sref={ref} s={settings} onSaved={saved} />
      ) : (
        <>
          <PriceRuleSection area={area} sref={ref} s={settings} onSaved={saved} />
          <SafetySection area={area} sref={ref} s={settings} onSaved={saved} />
        </>
      )}
      {settings.can_manage_connection && <StoreSection area={area} sref={ref} s={settings} onSaved={saved} />}
      {settings.can_manage_connection && <PauseSection area={area} sref={ref} s={settings} onSaved={saved} />}
      {!settings.can_manage_connection && <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><Info size={14} />{t("settings.sellerNote")}</p>}
    </div>
  );
}

type SectionProps = { area: SourceArea; sref: string; s: SourceSettings; onSaved: (next: SourceSettings) => Promise<void> };

function Section({ title, description, adminOnly, danger, children }: {
  title: string; description: string; adminOnly?: boolean; danger?: boolean; children: ReactNode;
}) {
  const t = useTranslations("sellerSources");
  return (
    <Card className={cn("grid gap-5 p-5 md:grid-cols-[280px_minmax(0,1fr)] md:gap-8", danger && "border-bad/30")}>
      <div className="space-y-1.5">
        <h2 className={cn("flex flex-wrap items-center gap-2 text-[15px] font-semibold", danger ? "text-bad" : "text-fg")}>
          {title}
          {adminOnly && <Tag tone="neutral"><Key size={12} />{t("settings.adminOnly")}</Tag>}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </Card>
  );
}

function useSave(area: SourceArea, ref: string, onSaved: SectionProps["onSaved"]) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const save = async (body: Parameters<typeof api.sources.updateSettings>[2], okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await onSaved(await api.sources.updateSettings(area, ref, body));
      setMsg({ tone: "good", text: okText ?? t("settings.saved") });
      return true;
    } catch (e) {
      setMsg({ tone: "bad", text: apiErrorMessage(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, setMsg, save };
}

function SaveMsg({ msg }: { msg: { tone: "good" | "bad"; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.tone === "bad" ? "alert" : "status"} className={cn("text-[12.5px]", msg.tone === "bad" ? "text-bad" : "text-good")}>{msg.text}</p>;
}

/* ------------------------------------------------------------------ */

function ConnectionSection({ area, sref, s, onSaved }: SectionProps) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const { busy, msg, save } = useSave(area, sref, onSaved);
  const [name, setName] = useState(s.name);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState(s.base_url ?? "");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<SourceTestResult | null>(null);
  const [testError, setTestError] = useState("");

  const runTest = async () => {
    setTesting(true);
    setTestError("");
    try {
      setTest(await api.sources.testSaved(s.id));
    } catch (e) {
      setTestError(apiErrorMessage(e));
    } finally {
      setTesting(false);
    }
  };
  const lastHealth = test?.health ?? (s.last_test_result as { health?: SourceTestResult["health"] } | null)?.health ?? null;
  const lastOk = test ? test.ok : lastHealth ? lastHealth.status !== "unhealthy" : false;
  const changed = name.trim() !== s.name || baseUrl.trim() !== (s.base_url ?? "") || (newKey ?? "").trim().length > 0;

  return (
    <Section title={t("settings.connTitle", { adapter: s.adapter_type })} description={t("settings.connDesc")} adminOnly>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[12.5px] font-medium text-fg">{t("settings.name")}</span>
          <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="block text-[12px] text-muted">{t("settings.nameHint")}</span>
        </label>
        <label className="block space-y-1">
          <span className="text-[12.5px] font-medium text-fg">{t("settings.baseUrl")}</span>
          <Input id="set-base" className="font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
      </div>
      <div className="space-y-1">
        <span className="text-[12.5px] font-medium text-fg">{t("settings.apiKey")}</span>
        {newKey === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[13.5px] text-fg">{s.api_key_hint ? `••••••••••••${s.api_key_hint}` : t("settings.keyHidden")}</span>
            <Button size="sm" variant="secondary" onClick={() => setNewKey("")}><Key size={14} />{t("settings.replaceKey")}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input id="set-key" type="password" autoComplete="off" className="max-w-sm" placeholder={t("settings.newKey")} value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>{t("cancel")}</Button>
          </div>
        )}
        <span className="block text-[12px] text-muted">{t("settings.keyHint")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || !changed || name.trim().length === 0}
          onClick={async () => {
            const body: Parameters<typeof api.sources.updateSettings>[2] = {};
            if (name.trim() !== s.name) body.name = name.trim();
            if (baseUrl.trim() !== (s.base_url ?? "")) body.base_url = baseUrl.trim();
            if (newKey && newKey.trim()) body.api_key = newKey.trim();
            if (await save(body)) setNewKey(null);
          }}
        >{t("save")}</Button>
        <Button variant="secondary" onClick={runTest} disabled={testing}><Plug size={15} />{testing ? t("wizard.testing") : t("wizard.test")}</Button>
        {lastHealth && (
          <span className={cn("inline-flex items-center gap-1.5 text-[12.5px]", lastOk ? "text-good" : "text-bad")}>
            {lastOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {lastOk
              ? t("settings.testOk", { balance: typeof lastHealth.balance_vnd === "number" ? formatLedgerMoney(lastHealth.balance_vnd, locale) : "—", when: relTime(test?.tested_at ?? s.last_tested_at, t) })
              : `${t("wizard.testFailed")}: ${lastHealth.message ?? ""}`}
          </span>
        )}
      </div>
      {testError && <p role="alert" className="text-[12.5px] text-bad">{testError}</p>}
      <SaveMsg msg={msg} />
    </Section>
  );
}

function PriceRuleSection({ area, sref, s, onSaved }: SectionProps) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const money = (n: number) => formatLedgerMoney(n, locale);
  const { busy, msg, setMsg, save } = useSave(area, sref, onSaved);
  const [markup, setMarkup] = useState(String(s.markup_pct));
  const [roundTo, setRoundTo] = useState(s.round_to);
  const [follow, setFollow] = useState(s.follow_cost);
  const [preview, setPreview] = useState<SourceRepriceResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const pct = Number(markup);
  const valid = markup.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= 1000;
  const priceChanged = valid && (pct !== s.markup_pct || roundTo !== s.round_to);
  const changed = priceChanged || follow !== s.follow_cost;

  const submit = async () => {
    if (!priceChanged) { await save({ follow_cost: follow }); return; }
    setPreviewing(true);
    setMsg(null);
    try {
      setPreview(await api.sources.reprice(area, sref, { margin_pct: pct, round_to: roundTo, dry_run: true }));
    } catch (e) {
      setMsg({ tone: "bad", text: apiErrorMessage(e) });
    } finally {
      setPreviewing(false);
    }
  };
  const confirm = async () => {
    setPreviewing(true);
    try {
      const ok = await save({ markup_pct: pct, round_to: roundTo, follow_cost: follow });
      if (ok && preview && preview.changed.length > 0) {
        const r = await api.sources.reprice(area, sref, {});
        setMsg({ tone: "good", text: t("settings.ruleApplied", { n: r.changed.length }) });
        await onSaved(await api.sources.settings(area, sref));
      }
      setPreview(null);
    } catch (e) {
      setMsg({ tone: "bad", text: apiErrorMessage(e) });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Section title={t("settings.ruleTitle")} description={t("settings.ruleDesc")}>
      <div className="flex flex-wrap items-center gap-2 text-[14px] text-fg">
        <span>{t("settings.ruleLead")}</span>
        <Input id="set-markup" type="number" min={0} max={1000} aria-label={t("settings.markup")} aria-invalid={!valid}
          className="h-9 w-20 text-right font-mono" value={markup} onChange={(e) => setMarkup(e.target.value)} />
        <span>{t("settings.ruleRound")}</span>
        <Select id="set-round" aria-label={t("settings.round")} className="h-9 w-32 font-mono" value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value))}>
          {ROUND_OPTIONS.map((r) => <option key={r} value={r}>{money(r)}</option>)}
        </Select>
      </div>
      {valid && (
        <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] text-muted">
          {t("settings.ruleExample", {
            cost1: money(3920), price1: money(suggestPrice(3920, pct, roundTo)),
            cost2: money(280), price2: money(suggestPrice(280, pct, roundTo)),
          })}
        </p>
      )}
      <fieldset className="space-y-2.5">
        <legend className="text-[13.5px] font-semibold text-fg">{t("settings.followQ")}</legend>
        {[true, false].map((v) => (
          <label key={String(v)} className="flex cursor-pointer items-start gap-2.5">
            <input type="radio" name="set-follow" className="mt-1 accent-iris" checked={follow === v} onChange={() => setFollow(v)} />
            <span>
              <span className="block text-[13.5px] font-medium text-fg">{v ? t("settings.followOn") : t("settings.followOff")}</span>
              <span className="block text-[12.5px] text-muted">{v ? t("settings.followOnHint") : t("settings.followOffHint")}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={!changed || !valid || busy || previewing}>
          {priceChanged ? t("settings.previewAndSave") : t("save")}
        </Button>
        {priceChanged && <span className="text-[12px] text-muted">{t("settings.previewHint")}</span>}
      </div>
      <SaveMsg msg={msg} />
      {preview && (
        <RepriceDialog
          preview={preview} busy={previewing || busy}
          title={t("reprice.changeTitle", { from: s.markup_pct, to: pct })}
          confirmLabel={preview.changed.length > 0 ? t("reprice.saveAndApply", { n: preview.changed.length }) : t("reprice.saveOnly")}
          onCancel={() => setPreview(null)} onConfirm={confirm}
        />
      )}
    </Section>
  );
}

function SafetySection({ area, sref, s, onSaved }: SectionProps) {
  const t = useTranslations("sellerSources");
  const { busy, msg, save } = useSave(area, sref, onSaved);
  const [minMargin, setMinMargin] = useState(String(s.min_margin_pct));
  const [autoPause, setAutoPause] = useState(String(s.auto_pause_after_failures));
  const [lowBalance, setLowBalance] = useState(String(s.low_balance_vnd));
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const valid = num(minMargin) >= 1 && num(minMargin) <= 500 && Number.isInteger(num(autoPause)) && num(autoPause) >= 0 && num(autoPause) <= 100
    && Number.isInteger(num(lowBalance)) && num(lowBalance) >= 0;
  const changed = num(minMargin) !== s.min_margin_pct || num(autoPause) !== s.auto_pause_after_failures || num(lowBalance) !== s.low_balance_vnd;

  const row = (id: string, label: string, hint: string, value: string, set: (v: string) => void, unit: string, width = "w-24") => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-fg">{label}</span>
        <span className="block text-[12.5px] text-muted">{hint}</span>
      </label>
      <span className="flex items-center gap-2">
        <Input id={id} type="number" min={0} className={cn("h-9 text-right font-mono", width)} value={value} onChange={(e) => set(e.target.value)} />
        <span className="w-14 text-[13px] text-muted">{unit}</span>
      </span>
    </div>
  );

  return (
    <Section title={t("settings.safetyTitle")} description={t("settings.safetyDesc")}>
      {row("set-min", t("settings.minMargin"), t("settings.minMarginHint"), minMargin, setMinMargin, "%")}
      {row("set-pause", t("settings.autoPause"), t("settings.autoPauseHint"), autoPause, setAutoPause, t("settings.failuresUnit"))}
      {row("set-balance", t("settings.lowBalance"), t("settings.lowBalanceHint"), lowBalance, setLowBalance, "VND", "w-32")}
      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted"><Info size={14} className="mt-0.5 shrink-0" />{t("settings.outOfCredit")}</p>
      <div className="flex items-center gap-3">
        <Button disabled={!changed || !valid || busy} onClick={() => save({
          min_margin_pct: num(minMargin), auto_pause_after_failures: num(autoPause), low_balance_vnd: num(lowBalance),
        })}>{t("save")}</Button>
        {!valid && <span className="text-[12.5px] text-bad">{t("settings.safetyInvalid")}</span>}
      </div>
      <SaveMsg msg={msg} />
    </Section>
  );
}

function CallSection({ area, sref, s, onSaved }: SectionProps) {
  const t = useTranslations("sellerSources");
  const { busy, msg, save } = useSave(area, sref, onSaved);
  const [timeout, setTimeoutS] = useState(String(s.timeout_seconds));
  const [retry, setRetry] = useState(s.max_attempts > 1);
  const [rate, setRate] = useState(String(s.rate_limit_per_minute ?? ""));
  const tNum = Number(timeout);
  const rNum = Number(rate);
  const valid = Number.isInteger(tNum) && tNum >= 5 && tNum <= 120 && Number.isInteger(rNum) && rNum >= 1 && rNum <= 600;
  const changed = tNum !== s.timeout_seconds || retry !== (s.max_attempts > 1) || rNum !== (s.rate_limit_per_minute ?? 0);
  return (
    <Section title={t("settings.callTitle")} description={t("settings.callDesc")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="set-timeout" className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-fg">{t("settings.timeout")}</span>
          <span className="block text-[12.5px] text-muted">{t("settings.timeoutHint")}</span>
        </label>
        <span className="flex items-center gap-2">
          <Input id="set-timeout" type="number" min={5} max={120} className="h-9 w-24 text-right font-mono" value={timeout} onChange={(e) => setTimeoutS(e.target.value)} />
          <span className="w-14 text-[13px] text-muted">{t("settings.seconds")}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-fg">{t("settings.retry")}</span>
          <span className="block text-[12.5px] text-muted">{t("settings.retryHint")}</span>
        </div>
        <Switch checked={retry} onChange={setRetry} label={t("settings.retry")} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <label htmlFor="set-rate" className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-fg">{t("settings.rate")}</span>
          <span className="block text-[12.5px] text-muted">{t("settings.rateHint")}</span>
        </label>
        <span className="flex items-center gap-2">
          <Input id="set-rate" type="number" min={1} max={600} className="h-9 w-24 text-right font-mono" value={rate} onChange={(e) => setRate(e.target.value)} />
          <span className="w-14 text-[13px] text-muted">{t("settings.perMinute")}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={!changed || !valid || busy} onClick={() => save({ timeout_seconds: tNum, max_attempts: retry ? 3 : 1, rate_limit_per_minute: rNum })}>{t("save")}</Button>
        {!valid && <span className="text-[12.5px] text-bad">{t("settings.callInvalid")}</span>}
      </div>
      <SaveMsg msg={msg} />
    </Section>
  );
}

function StoreSection({ area, sref, s, onSaved }: SectionProps) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const { busy, msg, save } = useSave(area, sref, onSaved);
  const [candidates, setCandidates] = useState<SourceSellerCandidate[] | null>(null);
  const [pick, setPick] = useState<string>("");
  const [loadError, setLoadError] = useState("");

  const open = async () => {
    try {
      const list = await api.sources.sellers();
      setCandidates(list);
      setPick(String(list.find((c) => c.id !== s.seller?.id)?.id ?? ""));
    } catch (e) {
      setLoadError(apiErrorMessage(e));
    }
  };

  return (
    <Section title={t("settings.storeTitle")} description={t("settings.storeDesc")} adminOnly>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-iris-soft text-iris"><Store size={18} /></span>
          {s.seller ? (
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-fg">{s.seller.business_name ?? s.seller.email}</span>
              <span className="block truncate text-[12.5px] text-muted">{s.seller.email}{s.seller.is_internal ? ` · ${t("settings.internal")}` : ""}</span>
            </span>
          ) : <Tag tone="warn">{t("list.noStore")}</Tag>}
        </div>
        {candidates === null && <Button size="sm" variant="secondary" onClick={open}>{t("settings.changeStore")}</Button>}
      </div>
      {loadError && <p role="alert" className="text-[12.5px] text-bad">{loadError}</p>}
      {candidates && (
        <div className="flex flex-wrap items-center gap-2">
          <Select id="set-store" aria-label={t("settings.changeStore")} className="h-9 max-w-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
            {candidates.filter((c) => c.id !== s.seller?.id).map((c) => (
              <option key={c.id} value={c.id}>{c.business_name ?? c.email} — {c.email}{c.is_internal ? "" : ` (${t("wizard.becomesInternal")})`}</option>
            ))}
          </Select>
          <Button size="sm" disabled={!pick || busy} onClick={async () => { if (await save({ seller_id: Number(pick) })) setCandidates(null); }}>{t("save")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setCandidates(null)}>{t("cancel")}</Button>
          <p className="w-full text-[12px] text-muted">{t("settings.changeStoreHint")}</p>
        </div>
      )}
      <SaveMsg msg={msg} />
    </Section>
  );
}

function PauseSection({ area, sref, s, onSaved }: SectionProps) {
  const t = useTranslations("sellerSources");
  const { busy, msg, save } = useSave(area, sref, onSaved);
  const [confirming, setConfirming] = useState(false);
  const gateway = s.kind === "gateway";
  const pauseDesc = t(gateway ? "settings.pauseDescGateway" : "settings.pauseDesc");
  return (
    <Section title={s.is_active ? t("settings.pauseTitle") : t("settings.resumeTitle")} description={s.is_active ? pauseDesc : t(gateway ? "settings.resumeDescGateway" : "settings.resumeDesc")} adminOnly danger={s.is_active}>
      <div>
        {s.is_active ? (
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy}><Pause size={15} />{t("settings.pause")}</Button>
        ) : (
          <Button onClick={() => save({ is_active: true }, t("settings.resumed"))} disabled={busy}><RefreshCw size={15} />{t("settings.resume")}</Button>
        )}
      </div>
      <SaveMsg msg={msg} />
      <Dialog open={confirming} onOpenChange={(o) => { if (!o && !busy) setConfirming(false); }}>
        <DialogContent className="max-w-sm border-line bg-panel p-5 text-fg">
          <DialogHeader><DialogTitle className="text-[15px] font-semibold">{t("settings.pauseConfirmTitle", { name: s.name })}</DialogTitle></DialogHeader>
          <p className="text-[13px] leading-relaxed text-muted">{pauseDesc}</p>
          <DialogFooter className="mt-2 flex-row justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>{t("cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={async () => { if (await save({ is_active: false }, t("settings.paused"))) setConfirming(false); }}>
              {t("settings.pause")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
