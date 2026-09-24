"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/cn";
import type { LedgerFinding, LedgerRun } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { AlertTriangle, CheckCircle2, RefreshCw } from "@/components/Icons";
import { useToast } from "@/components/toast";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${vnd(Math.abs(n))}`;

/** Admin › Reports: result of the nightly books check, with a "run now". */
export function LedgerReconcilePanel() {
  const t = useTranslations("adminLedger");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const runs = useQuery({ queryKey: queryKeys.adminLedgerRuns(), queryFn: api.adminLedgerRuns });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const runNow = useMutation({
    mutationFn: api.runAdminLedgerReconcile,
    onSuccess: (run) => {
      queryClient.setQueryData<LedgerRun[]>(queryKeys.adminLedgerRuns(), (prev) => [run, ...(prev ?? [])]);
      void queryClient.invalidateQueries({ queryKey: ["admin", "alerts"] });
      setSelectedId(run.id);
      if (run.ok) toast.success(t("runOk", { wallets: run.wallets_checked, orders: run.orders_checked }));
      else toast.error({ title: t("runMismatch", { count: run.mismatch_count }), description: t("runMismatchHint") });
    },
    onError: (err) => toast.error(apiErrorMessage(err, t("runFailed"))),
  });

  const latest = runs.data?.[0] ?? null;
  const selected = runs.data?.find((r) => r.id === selectedId) ?? latest;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold">{t("title")}</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("hint")}</p>
        </div>
        <Button size="sm" onClick={() => runNow.mutate()} disabled={runNow.isPending} className="shrink-0">
          <RefreshCw size={14} className={cn("mr-1.5", runNow.isPending && "animate-spin")} />
          {runNow.isPending ? t("running") : t("runNow")}
        </Button>
      </div>

      {runs.isPending && <div className="grid place-items-center py-10"><Spinner /></div>}
      {runs.isError && <p className="px-5 py-4 text-[12.5px] text-bad">{apiErrorMessage(runs.error, t("loadFailed"))}</p>}
      {runs.data && !latest && <p className="px-5 py-6 text-[13px] text-muted">{t("neverRan")}</p>}

      {selected && (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
            {/* Verdict */}
            <div className={cn("flex items-start gap-3 px-5 py-4", selected.ok ? "bg-good-soft/60" : "bg-bad-soft/70")}>
              <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", selected.ok ? "bg-good text-surface" : "bg-bad text-surface")}>
                {selected.ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
              </span>
              <div className="min-w-0">
                <p className={cn("text-[14px] font-semibold", selected.ok ? "text-good" : "text-bad")}>
                  {selected.ok ? t("verdictOk") : t("verdictBad", { count: selected.mismatch_count })}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {t("ranAt", { at: formatDateTime(selected.ran_at, locale), trigger: t(`trigger_${selected.trigger}`), ms: selected.duration_ms })}
                  {" · "}{t("scope", { wallets: selected.wallets_checked, orders: selected.orders_checked })}
                </p>
              </div>
            </div>

            {/* Totals */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line px-5 py-4 text-[12.5px] sm:grid-cols-3">
              {(["available", "locked", "escrow_open", "money_in", "money_out", "net_in"] as const).map((key) => (
                <div key={key} className="min-w-0">
                  <dt className="text-muted">{t(`total_${key}`)}</dt>
                  <dd className="font-mono font-medium tabular-nums text-fg">{vnd(selected.totals[key] ?? 0)}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-line px-5 py-2.5 text-[12px] text-faint">
              {t("identity", { held: vnd(selected.totals.held_total ?? 0), net: vnd(selected.totals.net_in ?? 0) })}
            </p>

            {/* Findings */}
            {selected.findings.length > 0 && (
              <div className="border-t border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-raised/40 text-left text-[11.5px] text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">{t("colTarget")}</th>
                      <th className="px-3 py-2 font-medium">{t("colKind")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("colExpected")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("colActual")}</th>
                      <th className="px-5 py-2 text-right font-medium">{t("colDelta")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selected.findings.map((f, i) => <FindingRow key={i} f={f} />)}
                  </tbody>
                </table>
                {selected.mismatch_count > selected.findings.length && (
                  <p className="px-5 py-2 text-[12px] text-faint">{t("moreFindings", { count: selected.mismatch_count - selected.findings.length })}</p>
                )}
              </div>
            )}
          </div>

          {/* History */}
          <div className="min-w-0">
            <p className="px-4 py-2.5 text-[11.5px] font-medium text-muted">{t("history")}</p>
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto border-t border-line">
              {runs.data!.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[12.5px] hover:bg-raised", r.id === selected.id && "bg-iris-soft/60")}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", r.ok ? "bg-good" : "bg-bad")} />
                    <span className="min-w-0 flex-1 truncate text-fg">{formatDateTime(r.ran_at, locale)}</span>
                    <Tag tone={r.ok ? "good" : "bad"}>{r.ok ? t("okShort") : t("badShort", { count: r.mismatch_count })}</Tag>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

function FindingRow({ f }: { f: LedgerFinding }) {
  const t = useTranslations("adminLedger");
  const target = f.target_type === "order"
    ? <Link href={`/admin/orders/${f.target_id}`} className="font-medium text-iris-hi hover:underline">{t("targetOrder", { id: f.target_id })}</Link>
    : f.target_type === "wallet" ? <span className="font-medium text-fg">{t("targetWallet", { id: f.target_id })}</span>
      : <span className="font-medium text-fg">{t("targetPlatform")}</span>;
  return (
    <tr>
      <td className="px-5 py-2 align-top">
        {target}
        {f.detail && <span className="block text-[11.5px] text-faint">{f.detail}</span>}
      </td>
      <td className="px-3 py-2 align-top text-muted">{t(`kind_${f.kind}`)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{vnd(f.expected)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{vnd(f.actual)}</td>
      <td className={cn("px-5 py-2 text-right font-mono font-semibold tabular-nums", f.delta === 0 ? "text-fg" : "text-bad")}>{signed(f.delta)}</td>
    </tr>
  );
}
