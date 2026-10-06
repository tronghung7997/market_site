import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WalletLedgerQuery } from "@/lib/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Query ví cho buyer — TopNav và trang Ví đọc CHUNG một cache: mọi mutation
 *  đụng tới tiền (mua hàng, nạp, rút, hoàn) chỉ cần invalidate prefix
 *  ["wallet"] là số dư nhảy ở mọi nơi, không cần chuyển trang hay F5.
 *  `enabled` để trang gate theo đăng nhập — chưa có account thì không bắn 401. */

export function useWalletBalance(enabled = true) {
  return useQuery({
    queryKey: queryKeys.walletBalance(),
    queryFn: () => api.wallet(),
    enabled,
  });
}

/** One page of the ledger, filtered server-side; the previous page stays on
 *  screen while the next one loads. */
export function useWalletLedger(params: WalletLedgerQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.walletLedger(params),
    queryFn: () => api.walletLedger(params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** Latest top-up requests; `limit` grows when the buyer asks for more. */
export function useWalletDeposits(enabled = true, limit = 20, status?: "paid" | "pending" | "expired" | "cancelled") {
  return useQuery({
    queryKey: [...queryKeys.walletDeposits(), limit, status ?? "all"],
    queryFn: () => api.myDeposits(limit, status),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useWalletWithdrawals(enabled = true) {
  return useQuery({
    queryKey: queryKeys.walletWithdrawals(),
    queryFn: () => api.myWithdrawals(),
    enabled,
  });
}

/** Trả về hàm "tiền vừa đổi — làm mới mọi thứ thuộc ví". */
export function useInvalidateWallet() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.wallet() });
}
