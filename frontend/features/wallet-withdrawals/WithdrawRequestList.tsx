"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { privateImageBase, privateImageSource } from "@/lib/media";
import { isWithdrawStatus, withdrawStep, withdrawTone } from "@/lib/withdraw-status";
import type { WithdrawRequest } from "@/lib/types";
import { Tag } from "@/components/ui";
import { StepProgress } from "@/components/patterns/StepProgress";
import { ImageStrip } from "@/components/media/ImageStrip";

/**
 * A seller's withdrawal requests, one row each: amount, fee and what reaches
 * the bank, the Gửi yêu cầu → Duyệt → Chuyển khoản progress, where the money
 * is now, the rejection reason and the transfer receipts. The same list on the
 * wallet page and on Kênh người bán › Rút tiền.
 *
 * Withdrawals settle in VND, so amounts are always shown in VND whatever the
 * display currency.
 */
export function WithdrawRequestList({ requests }: { requests: WithdrawRequest[] }) {
  const t = useTranslations("wallet");
  const tw = useTranslations("status.withdraw");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const money = (n: number) => formatLedgerMoney(n, locale);

  return (
    <ul className="divide-y divide-line">
      {requests.map((r) => {
        const fee = r.fee_amount ?? 0;
        const net = r.net_amount ?? r.amount - fee;
        return (
          <li key={r.id} className="space-y-2 px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[14px] font-semibold tabular">{money(r.amount)}</div>
                <div className="mt-0.5 text-[11.5px] text-faint">
                  {formatDate(r.created_at, locale)}
                  {r.source === "affiliate_commission" && <> · {t("withdrawSourceAffiliate")}</>}
                  {/* A rejected request pays nothing: no "you receive" line. */}
                  {fee > 0 && r.status !== "rejected" && <> · {t("withdrawHistoryNet", { fee: money(fee), net: money(net) })}</>}
                </div>
              </div>
              <Tag tone={withdrawTone(r.status)} className="shrink-0">
                {isWithdrawStatus(r.status) ? tw(r.status) : r.status}
              </Tag>
            </div>
            <StepProgress
              steps={[t("withdrawStepSent"), t("withdrawStepApproved"), t("withdrawStepPaid")]}
              current={withdrawStep(r.status)}
              stopped={r.status === "rejected"}
              stoppedLabel={t("withdrawStepRejected")}
            />
            <p className="text-[12px] text-muted">
              {r.status === "pending" && t("withdrawWaitingPending")}
              {r.status === "approved" && t("withdrawWaitingApproved")}
              {r.status === "paid" && t("withdrawWaitingPaid", { amount: money(net) })}
              {r.status === "rejected" && t("withdrawWaitingRejected")}
            </p>
            {r.status === "rejected" && r.reject_reason && (
              <p className="text-[12px] text-fg">{t("withdrawRejectReason", { reason: r.reject_reason })}</p>
            )}
            {r.status === "paid" && r.payout_reference && (
              <p className="font-mono text-[11.5px] text-muted">{t("withdrawPayoutRef", { ref: r.payout_reference })}</p>
            )}
            {r.receipt_images && r.receipt_images.length > 0 && (
              <ImageStrip
                size="sm"
                title={t("withdrawReceipts")}
                images={r.receipt_images.map((image) => ({ ...privateImageSource(image, privateImageBase.withdrawalReceipt(r.id)), id: image.id }))}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
