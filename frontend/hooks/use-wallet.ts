import { useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useWalletTransactions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.walletTransactions(),
    queryFn: () => api.transactions(),
    enabled,
  });
}

export function useWalletDeposits(enabled = true) {
  return useQuery({
    queryKey: queryKeys.walletDeposits(),
    queryFn: () => api.myDeposits(),
    enabled,
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
