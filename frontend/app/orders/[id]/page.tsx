/** /orders/123 — địa chỉ của MỘT đơn hàng.
 *
 *  Trước 30/07 route này không tồn tại: mọi thứ về đơn nằm trong thẻ mở rộng ở
 *  /orders, nên link "đơn #123" mà buyer copy từ thanh địa chỉ, hay gửi cho hỗ
 *  trợ, đều rơi vào trang 404 — kể cả link do chính app sinh ra sau khi mua.
 *
 *  Chi tiết đơn vẫn sống ở /orders (thẻ mở rộng là nơi có sẵn proxy panel,
 *  dashboard, khiếu nại, đánh giá) — trang này chỉ chuyển hướng sang danh sách
 *  đã lọc đúng đơn đó, để không phải nhân đôi toàn bộ giao diện chỉ để có một
 *  URL. Buyer thấy đúng đơn mình cần; URL vẫn bookmark/chia sẻ được.
 */
"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";

export default function OrderDetailRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  useEffect(() => {
    if (!id) return;
    // replace: đơn không có trang riêng nên không để lại một bước lịch sử
    // "rỗng" mà nút Back phải đi qua hai lần.
    router.replace(/^\d+$/.test(id) ? `/orders?search=${id}` : "/orders");
  }, [id, router]);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-20">
      <Spinner label="Đang mở đơn hàng…" />
    </div>
  );
}
