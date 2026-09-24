"use client";

import { useCallback, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { AlertCircle, RefreshCw, X } from "@/components/Icons";
import { SEGMENTS, SERVICE_LABEL, TABS, buildInsights, type AnalyticsState } from "../model";
import { useAnalyticsState, useBusinessAnalytics, useBusinessFilterOptions } from "../useBusinessAnalytics";
import { FilterBar } from "./FilterBar";
import { InsightsPanel } from "./InsightsPanel";
import { KpiStrip } from "./KpiStrip";
import { MilestonesView } from "./MilestonesView";
import { CategoryTreemap, ProductsTable, ServiceTypeChart } from "./charts/CatalogCharts";
import { BuyerMixChart, OrderFunnel, OrderHeatmap, RatesChart, StatusBreakdown } from "./charts/OperationsCharts";
import { CashflowChart, RevenueMixChart, SegmentChart } from "./charts/RevenueCharts";
import { ConcentrationCard, SellerLeaderboard, SellerQuadrant, SellerTable, TierChart } from "./charts/SellerCharts";
import { TrendChart } from "./charts/TrendChart";

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải số liệu">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 2xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[118px] animate-pulse rounded-card border border-line bg-card" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-[420px] animate-pulse rounded-card border border-line bg-card xl:col-span-2" />
        <div className="h-[420px] animate-pulse rounded-card border border-line bg-card" />
      </div>
    </div>
  );
}

export function AnalyticsDashboard() {
  const { state, update } = useAnalyticsState();
  const query = useBusinessAnalytics(state);
  const options = useBusinessFilterOptions();
  const reduced = useReducedMotion();
  const data = query.data;
  const dimmed = query.isPlaceholderData;

  const onFilter = useCallback((patch: Partial<AnalyticsState>) => update(patch), [update]);
  const insights = useMemo(() => (data ? buildInsights(data) : []), [data]);

  const chips = useMemo(() => {
    const out: { key: string; label: string; clear: Partial<AnalyticsState> }[] = [];
    if (state.segment !== "all") out.push({ key: "seg", label: SEGMENTS.find((s) => s.key === state.segment)!.label, clear: { segment: "all" } });
    if (state.sellerId) {
      const s = options.data?.sellers.find((x) => x.id === state.sellerId);
      out.push({ key: "seller", label: `Seller: ${s ? s.name : `#${state.sellerId}`}`, clear: { sellerId: undefined } });
    }
    if (state.categoryId) {
      const c = options.data?.categories.find((x) => x.id === state.categoryId);
      out.push({ key: "cat", label: `Danh mục: ${c ? c.name : `#${state.categoryId}`}`, clear: { categoryId: undefined } });
    }
    if (state.serviceType) out.push({ key: "svc", label: `Loại: ${SERVICE_LABEL[state.serviceType] ?? state.serviceType}`, clear: { serviceType: undefined } });
    return out;
  }, [state, options.data]);

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Phân tích kinh doanh</h1>

      <FilterBar state={state} update={update} data={data} options={options.data} fetching={query.isFetching} />

      <AnimatePresence initial={false}>
        {chips.length > 0 && (
          <motion.div
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-wrap items-center gap-1.5 overflow-hidden"
          >
            <span className="text-[11.5px] text-faint">Đang lọc:</span>
            {chips.map((c) => (
              <button key={c.key} type="button" onClick={() => update(c.clear)}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-iris/30 bg-iris-soft px-2 text-[11.5px] font-medium text-iris-hi transition-colors hover:border-iris/60">
                {c.label} <X size={11} />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {query.isError && !data ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-12 text-center">
          <AlertCircle size={22} className="text-bad" />
          <div>
            <p className="text-[14px] font-semibold text-fg">Không tải được số liệu</p>
            <p className="mt-1 text-[12.5px] text-muted">{(query.error as Error)?.message || "Máy chủ không phản hồi."}</p>
          </div>
          <button type="button" onClick={() => query.refetch()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] hover:bg-raised">
            <RefreshCw size={13} /> Thử lại
          </button>
        </div>
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <KpiStrip data={data} active={state.metric} onSelect={(metric) => update({ metric, tab: state.tab === "milestones" ? "overview" : state.tab })} />

          <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]" aria-label="Góc nhìn">
            {TABS.map((tab) => {
              const active = tab.key === state.tab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => update({ tab: tab.key })}
                  aria-current={active ? "page" : undefined}
                  className={cn("relative shrink-0 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors", active ? "text-fg" : "text-faint hover:text-fg")}
                >
                  {tab.label}
                  {active && <motion.span layoutId="analytics-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-iris" transition={{ type: "spring", stiffness: 480, damping: 36 }} />}
                </button>
              );
            })}
          </nav>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={state.tab}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
              className="space-y-4"
            >
              {state.tab === "overview" && (
                <>
                  <InsightsPanel insights={insights} onAction={(patch) => update(patch)} />
                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="min-w-0 xl:col-span-2"><TrendChart data={data} metric={state.metric} onMetric={(metric) => update({ metric })} onDrill={onFilter} dimmed={dimmed} height={320} /></div>
                    <SegmentChart data={data} dimmed={dimmed} compact />
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <CategoryTreemap data={data} dimmed={dimmed} onFilter={onFilter} height={300} />
                    <SellerLeaderboard data={data} dimmed={dimmed} onFilter={onFilter} limit={8} />
                  </div>
                </>
              )}
              {state.tab === "revenue" && (
                <>
                  <RevenueMixChart data={data} dimmed={dimmed} />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <SegmentChart data={data} dimmed={dimmed} />
                    <CashflowChart data={data} dimmed={dimmed} />
                  </div>
                </>
              )}
              {state.tab === "sellers" && (
                <>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="xl:col-span-2"><SellerQuadrant data={data} dimmed={dimmed} onFilter={onFilter} /></div>
                    <ConcentrationCard data={data} />
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <SellerLeaderboard data={data} dimmed={dimmed} onFilter={onFilter} />
                    <TierChart data={data} dimmed={dimmed} />
                  </div>
                  <SellerTable data={data} onFilter={onFilter} />
                </>
              )}
              {state.tab === "catalog" && (
                <>
                  <CategoryTreemap data={data} dimmed={dimmed} onFilter={onFilter} height={400} />
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <ServiceTypeChart data={data} dimmed={dimmed} onFilter={onFilter} />
                    <ProductsTable data={data} />
                  </div>
                </>
              )}
              {state.tab === "operations" && (
                <>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <OrderFunnel data={data} dimmed={dimmed} />
                    <StatusBreakdown data={data} />
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <RatesChart data={data} dimmed={dimmed} />
                    <BuyerMixChart data={data} dimmed={dimmed} />
                  </div>
                  <OrderHeatmap data={data} dimmed={dimmed} />
                </>
              )}
              {state.tab === "milestones" && <MilestonesView data={data} />}
            </motion.div>
          </AnimatePresence>

          <p className="pb-2 text-[11px] leading-relaxed text-faint">
            GMV tính theo ngày tạo đơn đã thanh toán; doanh thu sàn tính theo ngày giải ngân ký quỹ. Đơn demo (đánh giá mồi) không được tính.
            Nạp/rút và đăng ký là số toàn sàn, không theo bộ lọc. Múi giờ: {data.range.tz}.
          </p>
        </>
      )}
    </div>
  );
}
