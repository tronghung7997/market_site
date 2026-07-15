"use client";

import * as React from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  ORDER_STATUS,
  DISPUTE_STATUS,
  PRODUCT_STATUS,
  RESOURCE_STATUS,
  ALERT_SEVERITY,
  STRATEGY_LABELS,
  WITHDRAW_STATUS,
  type StatusTone,
} from "./status-config";

type StatusType =
  | { type: "order"; status: string }
  | { type: "dispute"; status: string }
  | { type: "product"; status: string }
  | { type: "resource"; status: string }
  | { type: "alert"; severity: string }
  | { type: "strategy"; strategy: string }
  | { type: "withdraw"; status: string };

function getStatusConfig(item: StatusType): { label: string; tone: StatusTone } {
  switch (item.type) {
    case "order":
      return ORDER_STATUS[item.status] ?? { label: item.status, tone: "neutral" as StatusTone };
    case "dispute":
      return DISPUTE_STATUS[item.status] ?? { label: item.status, tone: "neutral" as StatusTone };
    case "product":
      return PRODUCT_STATUS[item.status] ?? { label: item.status, tone: "neutral" as StatusTone };
    case "resource":
      return RESOURCE_STATUS[item.status] ?? { label: item.status, tone: "neutral" as StatusTone };
    case "alert":
      return ALERT_SEVERITY[item.severity] ?? { label: item.severity, tone: "neutral" as StatusTone };
    case "strategy":
      return STRATEGY_LABELS[item.strategy] ?? { label: item.strategy, tone: "neutral" as StatusTone };
    case "withdraw":
      return WITHDRAW_STATUS[item.status] ?? { label: item.status, tone: "neutral" as StatusTone };
    default:
      return { label: "Unknown", tone: "neutral" as StatusTone };
  }
}

export interface StatusBadgeProps extends Omit<BadgeProps, "tone" | "children"> {
  status: string;
  statusType: "order" | "dispute" | "product" | "resource" | "alert" | "strategy";
}

export function StatusBadge({ status, statusType, className, ...props }: StatusBadgeProps) {
  const config = getStatusConfig({ type: statusType, [statusType === "alert" ? "severity" : "status"]: status } as StatusType);

  return (
    <Badge tone={config.tone} className={className} {...props}>
      {config.label}
    </Badge>
  );
}

// Convenience components
export function OrderStatusBadge({ status, ...props }: { status: string } & Omit<BadgeProps, "children">) {
  const config = ORDER_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={config.tone} {...props}>{config.label}</Badge>;
}

export function DisputeStatusBadge({ status, ...props }: { status: string } & Omit<BadgeProps, "children">) {
  const config = DISPUTE_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={config.tone} {...props}>{config.label}</Badge>;
}

export function ProductStatusBadge({ status, ...props }: { status: string } & Omit<BadgeProps, "children">) {
  const config = PRODUCT_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={config.tone} {...props}>{config.label}</Badge>;
}

export function ResourceStatusBadge({ status, ...props }: { status: string } & Omit<BadgeProps, "children">) {
  const config = RESOURCE_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={config.tone} {...props}>{config.label}</Badge>;
}

export function AlertSeverityBadge({ severity, ...props }: { severity: string } & Omit<BadgeProps, "children">) {
  const config = ALERT_SEVERITY[severity] ?? { label: severity, tone: "neutral" as StatusTone };
  return <Badge tone={config.tone} {...props}>{config.label}</Badge>;
}

export function WithdrawStatusBadge({ status, ...props }: { status: string } & Omit<BadgeProps, "children">) {
  const config = WITHDRAW_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={config.tone} {...props}>{config.label}</Badge>;
}
