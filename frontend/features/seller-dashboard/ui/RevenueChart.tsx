"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMoney } from "@/lib/money";
import type { SellerDashboard } from "@/lib/types";
import { Card } from "@/components/ui";
import { BarChart as BarIcon } from "@/components/Icons";
import { formatIsoDate } from "../model";

// Both series are money on ONE axis: bars = gross by order date, line = net
// credited to the wallet by release date (so the line can sit above a bar on
// days when older escrows settle). Colours come from the design tokens.
const GROSS_FILL = "color-mix(in srgb, var(--color-iris) 28%, var(--color-surface))";
const NET_STROKE = "var(--color-iris)";

export function RevenueChart({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const money = (v: number) => formatBrowseMoney(v, { locale });
  const weekly = data.range.bucket === "week";

  const points = useMemo(
    () => data.timeseries.map((p) => ({ ...p, label: formatIsoDate(p.date, locale) })),
    [data.timeseries, locale],
  );
  const empty = points.every((p) => p.gross === 0 && p.net === 0);
  // Thin out x labels: ~8 ticks regardless of range length.
  const tickEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <Card className="flex h-full flex-col p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <BarIcon size={14} className="text-faint" /> {weekly ? t("chartTitleWeek") : t("chartTitleDay")}
        </h3>
        <div className="flex items-center gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GROSS_FILL }} /> {t("legendGross")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: NET_STROKE }} /> {t("legendNet")}
          </span>
        </div>
      </div>
      <div className="min-h-[220px] flex-1">
        {empty ? (
          <div className="grid h-full place-items-center text-[13px] text-muted">{t("chartEmpty")}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={tickEvery - 1}
                tick={{ fontSize: 11, fill: "var(--color-faint)" }}
              />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip
                cursor={{ fill: "color-mix(in srgb, var(--color-iris) 6%, transparent)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof points)[number];
                  return (
                    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-card-lg">
                      <p className="font-semibold text-fg">
                        {p.label} · {t("tooltipOrders", { count: p.orders })}
                      </p>
                      <p className="mt-1 text-muted">{t("legendGross")}: <span className="font-mono text-fg">{money(p.gross)}</span></p>
                      <p className="text-muted">{t("legendNet")}: <span className="font-mono text-fg">{money(p.net)}</span></p>
                      {p.refunded > 0 && (
                        <p className="text-bad">{t("tooltipRefunded", { amount: money(p.refunded) })}</p>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="gross" fill={GROSS_FILL} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line
                type="monotone"
                dataKey="net"
                stroke={NET_STROKE}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
