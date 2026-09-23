"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SupplierSource } from "@/lib/types";
import { Banner, Button, Card, Tag } from "@/components/ui";
import { AlertTriangle, ArrowRight, CheckCircle2, Pause, Plus, RefreshCw, Store } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { balanceDays, blockedCount, lowBalance, sourceRef } from "../logic";
import { relTime } from "./shared";

type Todo = { key: string; title: string; detail: string; href: string; action: string; tone: "warn" | "bad" };

/** Nơi sàn lấy hàng: mỗi nguồn một thẻ, đầu trang chỉ còn việc cần làm. */
export function SourcesList({ area }: { area: SourceArea }) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const [rows, setRows] = useState<SupplierSource[] | null>(null);
  const [error, setError] = useState("");
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

  const todos: Todo[] = [];
  for (const s of rows ?? []) {
    if (s.kind !== "catalog") continue;
    const ref = sourceRef(area, s);
    if (s.sync_error) {
      todos.push({
        key: `${s.id}-sync`, tone: "warn", href: `${base}/${ref}`, action: t("list.todoSyncAction"),
        title: t("list.todoSync", { name: s.name }), detail: t("list.todoSyncDetail", { error: s.sync_error }),
      });
    }
    const blocked = blockedCount(s);
    if (blocked > 0) {
      todos.push({
        key: `${s.id}-blocked`, tone: "warn", href: `${base}/${ref}`, action: t("list.todoBlockedAction", { n: blocked }),
        title: t("list.todoBlocked", { name: s.name, n: blocked }),
        detail: t("list.todoBlockedDetail", {
          low: s.listing_low_margin_count, delisted: s.listing_error_count, paused: s.listing_auto_paused_count,
        }),
      });
    }
    if (lowBalance(s)) {
      todos.push({
        key: `${s.id}-balance`, tone: "warn", href: `${base}/${ref}?tab=settings`, action: t("list.todoBalanceAction"),
        title: t("list.todoBalance", { name: s.name }), detail: t("list.todoBalanceDetail"),
      });
    }
    if (!s.is_active) {
      todos.push({
        key: `${s.id}-paused`, tone: "bad", href: `${base}/${ref}?tab=settings`, action: t("list.todoPausedAction"),
        title: t("list.todoPaused", { name: s.name }), detail: t("list.todoPausedDetail"),
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          {area === "seller" && <h1 className="font-serif text-2xl font-semibold text-fg">{t("title")}</h1>}
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{area === "admin" ? t("list.adminIntro") : t("list.sellerIntro")}</p>
        </div>
        {area === "admin" && (
          <Link href={`${base}/new`}><Button><Plus size={15} />{t("list.addSource")}</Button></Link>
        )}
      </div>

      {error && (
        <Banner tone="bad" icon={<AlertTriangle size={15} />} action={<Button size="sm" variant="secondary" onClick={load}><RefreshCw size={14} />{t("retry")}</Button>}>
          {error}
        </Banner>
      )}

      {todos.length > 0 && (
        <section aria-labelledby="sources-todo" className="overflow-hidden rounded-card border border-warn/30 bg-card">
          <h2 id="sources-todo" className="flex items-center gap-2 bg-warn-soft px-4 py-2.5 text-[14px] font-semibold text-fg">
            <AlertTriangle size={16} className="text-warn" />{t("list.todoTitle")}<Tag tone="warn">{todos.length}</Tag>
          </h2>
          <ul className="divide-y divide-line">
            {todos.map((todo) => (
              <li key={todo.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={cn("text-[13.5px] font-medium", todo.tone === "bad" ? "text-bad" : "text-fg")}>{todo.title}</p>
                  <p className="text-[12.5px] text-muted">{todo.detail}</p>
                </div>
                <Link href={todo.href}><Button size="sm" variant="secondary">{todo.action}<ArrowRight size={14} /></Button></Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows === null && !error ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label={t("loading")}>
          {[0, 1].map((i) => <div key={i} className="h-52 animate-pulse rounded-card border border-line bg-surface" />)}
        </div>
      ) : rows && rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[14px] font-medium text-fg">{area === "admin" ? t("list.emptyAdmin") : t("list.emptySeller")}</p>
          {area === "admin" && (
            <Link href={`${base}/new`} className="mt-4 inline-block"><Button><Plus size={15} />{t("list.addSource")}</Button></Link>
          )}
        </Card>
      ) : rows ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...rows].sort((a, b) => Number(b.kind !== "server") - Number(a.kind !== "server")).map((s) => (
            <SourceCard key={s.id} s={s} area={area} base={base} />
          ))}
        </div>
      ) : null}
      {area === "seller" && rows && rows.length > 0 && <p className="text-[12.5px] text-muted">{t("list.askAdmin")}</p>}
    </div>
  );
}

function SourceCard({ s, area, base }: { s: SupplierSource; area: SourceArea; base: string }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const catalog = s.kind === "catalog";
  const href = s.kind !== "server" ? `${base}/${sourceRef(area, s)}` : area === "admin" ? "/admin/providers" : "/seller/providers";
  const low = lowBalance(s);
  const days = balanceDays(s.balance_vnd, s.stats_7d?.cost ?? 0);
  const blocked = blockedCount(s);
  const status = !s.is_active
    ? <Tag tone="neutral"><Pause size={12} />{t("status.paused")}</Tag>
    : low ? <Tag tone="warn"><AlertTriangle size={12} />{t("status.lowBalance")}</Tag>
    : <Tag tone="good"><CheckCircle2 size={12} />{t("status.running")}</Tag>;
  const store = s.seller_business_name ?? s.seller_email;

  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card p-5 shadow-card transition-colors hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-fg group-hover:text-iris-hi">{s.name}</p>
          <p className="text-[12.5px] text-muted">{t(`kind.${s.kind}`)} · <span className="font-mono">{s.adapter_type}</span></p>
        </div>
        {status}
      </div>
      {s.kind === "gateway" ? (
        <dl className="grid grid-cols-3 gap-3 border-y border-line py-3">
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">{t("gateway.requests24h")}</dt>
            <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{(s.gateway_stats?.requests_24h ?? 0).toLocaleString(locale)}</dd>
            <dd className={cn("text-[12px]", (s.gateway_stats?.errors_24h ?? 0) > 0 ? "text-warn" : "text-muted")}>
              {t("gateway.errorsShort", { n: s.gateway_stats?.errors_24h ?? 0 })}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">{t("gateway.activeKeys")}</dt>
            <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{(s.gateway_stats?.active_keys ?? 0).toLocaleString(locale)}</dd>
            <dd className="text-[12px] text-muted">{t("gateway.activeKeysSub")}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">{t("list.profit7d")}</dt>
            <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{formatLedgerMoney(s.gateway_stats?.profit_7d ?? 0, locale)}</dd>
            <dd className="text-[12px] text-muted">{t("gateway.sales7d", { amount: formatLedgerMoney(s.gateway_stats?.sales_7d ?? 0, locale) })}</dd>
          </div>
        </dl>
      ) : (
        <dl className="grid grid-cols-3 gap-3 border-y border-line py-3">
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">{t("list.balance")}</dt>
            <dd className={cn("font-mono text-[16px] font-semibold tabular-nums", low ? "text-warn" : "text-fg")}>
              {s.balance_vnd === null ? "—" : formatLedgerMoney(s.balance_vnd, locale)}
            </dd>
            <dd className="text-[12px] text-muted">{days === null ? t("list.balanceUnknownPace") : t("list.balanceDays", { n: days })}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">{t("list.selling")}</dt>
            <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{catalog ? s.active_listing_count : s.product_count}</dd>
            <dd className={cn("text-[12px]", blocked > 0 ? "text-warn" : "text-muted")}>
              {catalog ? (blocked > 0 ? t("list.blockedN", { n: blocked }) : t("list.variantsUnit")) : t("list.productsUnit")}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">{t("list.profit7d")}</dt>
            <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{formatLedgerMoney(s.stats_7d?.profit ?? 0, locale)}</dd>
            <dd className="text-[12px] text-muted">{t("list.units7d", { n: s.stats_7d?.units ?? 0 })}</dd>
          </div>
        </dl>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Store size={14} />
          {store ? <span className="min-w-0 truncate">{t("list.soldAs", { store })}</span> : <Tag tone="warn">{t("list.noStore")}</Tag>}
        </span>
        <span>{s.kind === "catalog" || s.kind === "proxy" ? t("list.synced", { when: relTime(s.catalog_synced_at, t) }) : t("list.checked", { when: relTime(s.last_tested_at, t) })}</span>
      </div>
    </Link>
  );
}
