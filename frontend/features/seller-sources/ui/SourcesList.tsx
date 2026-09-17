"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SourceArea, SupplierSource } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { ArrowRight, Layers, RefreshCw } from "@/components/Icons";

function relTime(iso: string | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!iso) return t("neverSynced");
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minutesAgo", { n: mins });
  return t("hoursAgo", { n: Math.round(mins / 60) });
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

  return (
    <div className="space-y-4">
      <div>
        {area !== "admin" && <h1 className="text-lg font-bold text-fg">{t("title")}</h1>}
        <p className="mt-1 text-[13px] text-muted">{area === "admin" ? t("adminIntro") : t("intro")}</p>
      </div>
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
      {rows === null ? <Spinner /> : rows.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted">
          {area === "admin" ? t("emptyAdmin") : t("emptySeller")}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => {
            const health = (s.last_test_result as { health?: { status?: string; balance_vnd?: number } } | null)?.health;
            const balance = health?.balance_vnd;
            return (
              <Card key={s.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-iris shrink-0" />
                      <span className="font-semibold text-fg truncate">{s.name}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {s.adapter_type}
                      {area === "admin" && (s.seller_email ? ` · ${s.seller_email}` : ` · ${t("unassigned")}`)}
                    </p>
                  </div>
                  <Tag tone={s.is_active ? "good" : "bad"}>{s.is_active ? t("active") : t("paused")}</Tag>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-[12px]">
                  <div><dt className="text-faint">{t("catalogCount")}</dt><dd className="font-mono tabular-nums text-fg">{s.catalog_count.toLocaleString()}</dd></div>
                  <div><dt className="text-faint">{t("listingCount")}</dt><dd className="font-mono tabular-nums text-fg">{s.listing_count}{s.listing_error_count > 0 && <span className="text-warn"> · {s.listing_error_count}!</span>}</dd></div>
                  <div><dt className="text-faint">{t("minMargin")}</dt><dd className="font-mono tabular-nums text-fg">{s.min_margin_pct}%</dd></div>
                </dl>
                <p className="text-[12px] text-faint">
                  {t("synced")}: {relTime(s.catalog_synced_at, t)}
                  {typeof balance === "number" && ` · ${t("balance")}: ${balance.toLocaleString()} đ`}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => sync(s.id)} disabled={syncing === s.id}>
                    <RefreshCw className="h-3.5 w-3.5" />{syncing === s.id ? t("syncing") : t("syncNow")}
                  </Button>
                  <Link href={`${base}/${s.id}`} className="ml-auto">
                    <Button size="sm">{t("open")}<ArrowRight className="h-3.5 w-3.5" /></Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
