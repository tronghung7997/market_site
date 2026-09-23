"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SupplierSource } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { AlertTriangle, ArrowRight, Layers, Plus, RefreshCw, Activity } from "@/components/Icons";
import { cn } from "@/lib/cn";

type T = (k: string, v?: Record<string, string | number>) => string;

export function relTime(iso: string | null, t: T): string {
  if (!iso) return t("neverSynced");
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minutesAgo", { n: mins });
  return t("hoursAgo", { n: Math.round(mins / 60) });
}

function balanceOf(s: SupplierSource): number | null {
  const health = (s.last_test_result as { health?: { balance_vnd?: number } } | null)?.health;
  return typeof health?.balance_vnd === "number" ? health.balance_vnd : null;
}

function lowBalance(s: SupplierSource): boolean {
  const b = balanceOf(s);
  const th = Number(s.low_balance_vnd ?? 0);
  return b !== null && th > 0 && b < th;
}

/** Việc cần xử lý trên các nguồn — hiện trên đầu cả hai khu. */
function attentionItems(rows: SupplierSource[], t: T): { key: string; text: string; href: string; tone: "warn" | "bad" }[] {
  const out: { key: string; text: string; href: string; tone: "warn" | "bad" }[] = [];
  for (const s of rows) {
    const base = `${s.id}`;
    if (s.listing_error_count > 0) out.push({ key: `${s.id}-err`, tone: "warn", href: base, text: t("attnDelisted", { n: s.listing_error_count, name: s.name }) });
    if (s.listing_low_margin_count > 0) out.push({ key: `${s.id}-low`, tone: "bad", href: base, text: t("attnLowMargin", { n: s.listing_low_margin_count, name: s.name }) });
    if (s.listing_auto_paused_count > 0) out.push({ key: `${s.id}-auto`, tone: "warn", href: base, text: t("attnAutoPaused", { n: s.listing_auto_paused_count, name: s.name }) });
    if (lowBalance(s)) out.push({ key: `${s.id}-bal`, tone: "warn", href: base, text: t("attnLowBalance", { name: s.name, balance: (balanceOf(s) ?? 0).toLocaleString() }) });
    if (!s.is_active) out.push({ key: `${s.id}-off`, tone: "warn", href: base, text: t("attnPaused", { name: s.name }) });
  }
  return out;
}

export function SourcesList({ area }: { area: SourceArea }) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const [rows, setRows] = useState<SupplierSource[] | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState<number | null>(null);
  const base = area === "admin" ? "/admin/sources" : "/seller/sources";

  const load = async () => {
    try {
      setRows(await api.sources.list(area));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [area]);

  const sync = async (id: number) => {
    setSyncing(id);
    try {
      await api.sources.sync(area, id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSyncing(null);
    }
  };

  const attention = rows ? attentionItems(rows, t) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {area !== "admin" && <h1 className="text-lg font-bold text-fg">{t("title")}</h1>}
          <p className="mt-1 text-[13px] text-muted max-w-2xl">{area === "admin" ? t("adminIntro") : t("intro")}</p>
        </div>
        {area === "admin" && (
          <Link href={`${base}/new`}><Button size="sm"><Plus className="h-3.5 w-3.5" />{t("addSource")}</Button></Link>
        )}
      </div>
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}

      {attention.length > 0 && (
        <Card className="p-3 sm:p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            <AlertTriangle className="h-4 w-4 text-warn" />{t("attention")} <Tag tone="warn">{attention.length}</Tag>
          </p>
          <ul className="mt-2 divide-y divide-line">
            {attention.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className={cn(a.tone === "bad" ? "text-bad" : "text-fg")}>{a.text}</span>
                <Link href={`${base}/${a.href}?filter=attention`} className="shrink-0">
                  <Button size="sm" variant="secondary">{t("handle")}</Button>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows === null ? <Spinner /> : rows.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted">
          {area === "admin" ? t("emptyAdmin") : t("emptySeller")}
        </Card>
      ) : area === "admin" ? (
        <AdminTable rows={rows} syncing={syncing} onSync={sync} base={base} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => <SellerCard key={s.id} s={s} syncing={syncing === s.id} onSync={() => sync(s.id)} base={base} />)}
        </div>
      )}
      {area !== "admin" && rows && rows.length > 0 && <p className="text-[12px] text-faint">{t("askAdminForMore")}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function KindTag({ kind }: { kind: SupplierSource["kind"] }) {
  const t = useTranslations("sellerSources");
  return (
    <Tag tone="iris">
      {kind === "catalog" ? <Layers className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
      {kind === "catalog" ? t("kindCatalog") : kind === "proxy" ? t("kindProxy") : t("kindServer")}
    </Tag>
  );
}

function SellerCard({ s, syncing, onSync, base }: { s: SupplierSource; syncing: boolean; onSync: () => void; base: string }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const balance = balanceOf(s);
  const manageHref = s.kind === "server" ? `/seller/providers` : `${base}/${s.id}`;
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-fg truncate">{s.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <KindTag kind={s.kind} />
            {s.kind !== "server" ? `${t("synced")} ${relTime(s.catalog_synced_at, t)}` : `${t("checked")} ${relTime(s.last_tested_at, t)}`}
          </p>
        </div>
        <Tag tone={s.is_active ? "good" : "bad"}>{s.is_active ? t("active") : t("paused")}</Tag>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        <div><dt className="text-faint">{t("selling")}</dt><dd className="font-mono tabular-nums text-fg text-[15px] font-semibold">{s.kind === "catalog" ? s.listing_count : s.product_count}</dd></div>
        <div><dt className="text-faint">{t("attention")}</dt><dd className={cn("font-mono tabular-nums text-[15px] font-semibold", s.attention_count > 0 ? "text-warn" : "text-fg")}>{s.attention_count}</dd></div>
        <div>
          <dt className="text-faint">{t("balance")}</dt>
          <dd className={cn("font-mono tabular-nums text-[15px] font-semibold", lowBalance(s) ? "text-warn" : "text-fg")}>
            {balance === null ? "—" : formatLedgerMoney(balance, locale)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {s.kind === "catalog" && (
          <Link href={`${base}/${s.id}?add=1`}><Button size="sm"><Plus className="h-3.5 w-3.5" />{t("addProducts")}</Button></Link>
        )}
        <Link href={manageHref}><Button size="sm" variant="secondary">{t("manageN", { n: s.kind === "catalog" ? s.listing_count : s.product_count })}<ArrowRight className="h-3.5 w-3.5" /></Button></Link>
        {s.kind === "catalog" && (
          <Button size="sm" variant="ghost" onClick={onSync} disabled={syncing} className="ml-auto">
            <RefreshCw className="h-3.5 w-3.5" />{syncing ? t("syncing") : t("syncNow")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function AdminTable({ rows, syncing, onSync, base }: { rows: SupplierSource[]; syncing: number | null; onSync: (id: number) => void; base: string }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="w-full text-[13px]">
        <thead className="bg-surface text-[11px] uppercase tracking-wider text-faint">
          <tr>
            <th className="p-2.5 text-left">{t("source")}</th>
            <th className="p-2.5 text-left">{t("assignedTo")}</th>
            <th className="p-2.5 text-right">{t("balance")}</th>
            <th className="p-2.5 text-right">{t("selling")}</th>
            <th className="p-2.5 text-left">{t("synced")}</th>
            <th className="p-2.5 text-left">{t("status")}</th>
            <th className="p-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const balance = balanceOf(s);
            return (
              <tr key={s.id} className={cn("border-t border-line", !s.seller_id && "bg-warn-soft/30")}>
                <td className="p-2.5 align-top">
                  <Link href={`${base}/${s.id}`} className="font-medium text-fg hover:text-iris">{s.name}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                    <KindTag kind={s.kind} />
                    <span className="font-mono">{s.adapter_type}</span>
                    {s.kind === "catalog" && <span>· {s.catalog_count.toLocaleString()} SKU</span>}
                  </div>
                </td>
                <td className="p-2.5 align-top">
                  {s.seller_email ? (
                    <>
                      <div className="text-fg truncate max-w-[220px]">{s.seller_email}</div>
                      {s.seller_is_internal && <Tag tone="iris">{t("internalSeller")}</Tag>}
                    </>
                  ) : <Tag tone="warn">{t("unassigned")}</Tag>}
                </td>
                <td className="p-2.5 align-top text-right font-mono tabular-nums">
                  {balance === null ? <span className="text-faint">—</span> : formatLedgerMoney(balance, locale)}
                  {lowBalance(s) && <div><Tag tone="warn"><AlertTriangle className="h-3 w-3" />{t("lowBalance")}</Tag></div>}
                </td>
                <td className="p-2.5 align-top text-right font-mono tabular-nums">
                  {s.kind === "catalog" ? s.listing_count : s.product_count}
                  {s.attention_count > 0 && <div className="text-[11px] text-warn">{t("attnN", { n: s.attention_count })}</div>}
                </td>
                <td className="p-2.5 align-top text-muted">{s.kind === "catalog" ? relTime(s.catalog_synced_at, t) : relTime(s.last_tested_at, t)}</td>
                <td className="p-2.5 align-top"><Tag tone={s.is_active ? "good" : "neutral"}>{s.is_active ? t("active") : t("paused")}</Tag></td>
                <td className="p-2.5 align-top text-right whitespace-nowrap">
                  {s.kind === "catalog" && (
                    <Button size="sm" variant="ghost" onClick={() => onSync(s.id)} disabled={syncing === s.id} aria-label={t("syncNow")}>
                      <RefreshCw className={cn("h-3.5 w-3.5", syncing === s.id && "animate-spin")} />
                    </Button>
                  )}
                  <Link href={s.kind === "server" ? `/admin/providers` : `${base}/${s.id}`}><Button size="sm" variant="secondary">{t("open")}</Button></Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
