"""Nguồn sự thật duy nhất cho việc adapter_type nào tương thích với
pricing_strategy nào.

Tồn tại vì trước đây không có gì kiểm tra hai giá trị này — admin gắn
`seller_pool` (yêu cầu `variant_id` trong user_config, xem SellerPoolAdapter)
vào một sản phẩm strategy `task` (không hề có variant, chỉ có target_urls)
là hợp lệ về mặt schema nhưng vỡ ngay khi buyer đặt hàng, với KeyError không
liên quan gì tới nguyên nhân thật (đơn giản là bị refund + cancelled).

`None` = tương thích với mọi strategy nhưng chỉ ở mức cảnh báo (`mock` là
adapter dev/demo theo đúng tinh thần docs/huong-dan-van-hanh.md — không chặn,
chỉ nhắc admin biết họ đang dùng dữ liệu giả).
"""

from dataclasses import dataclass

ADAPTER_STRATEGY_COMPAT: dict[str, set[str] | None] = {
    "mock": None,
    "seller_pool": {"fixed"},
    "manual": {"task"},
    # Adapter TopProxy thật (2026-07-23): provision đọc type/network/days từ
    # ConfigPricing — chỉ còn "config". Trước đây là RealApiAdapter giả định
    # nên từng cho cả "credit".
    "topproxy": {"config"},
    "scrapecreators": {"config", "credit"},
    # Per-request forward tới backend do seller tự khai (RealApiAdapter.call(),
    # xem src/gateway/router.py) — chỉ hợp lý với credit vì buyer cần một gói
    # quota/units_total để gateway trừ dần theo từng lần gọi.
    "seller_gateway": {"credit"},
    # POST task cho backend seller thay vì hàng đợi người xử lý tay (ManualAdapter).
    "seller_task_webhook": {"task"},
    # "credit" (package_size, ép bằng 1 — xem
    # orders/service.py::create_order_with_adapter) là flow "mua nhanh,
    # không chọn gì" — DProxyAdapter.provision() bind assignment khả dụng
    # đầu tiên từ pool admin đã mua sẵn.
    # "config" (Loại proxy/Nhà mạng/Thời hạn) giờ CŨNG hợp lệ:
    # DProxyAdapter._provision_via_purchase() thật sự gọi mua mới theo đúng
    # type/network/days buyer chọn (POST /api/v1/proxies/order), nên field
    # hiển thị được fulfillment tôn trọng thật, khác với trước đây (P0#1,
    # docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md) khi
    # provision() bỏ qua hoàn toàn lựa chọn của buyer. quantity vẫn bị chặn
    # ở orders/service.py — mỗi order chỉ bind đúng 1 ProxyAllocation dù
    # dùng strategy nào.
    "dproxy": {"credit", "config"},
}


@dataclass
class CompatResult:
    level: str  # "ok" | "warn" | "block"
    message: str | None = None


def check_compatibility(adapter_type: str | None, pricing_strategy: str | None) -> CompatResult:
    if not adapter_type or not pricing_strategy:
        return CompatResult("ok")

    compatible = ADAPTER_STRATEGY_COMPAT.get(adapter_type)
    if compatible is None:
        return CompatResult(
            "warn",
            f"Adapter '{adapter_type}' là dữ liệu giả (dev/demo) — đơn sẽ được giao ngay, "
            f"không qua fulfillment thật của chiến lược '{pricing_strategy}'.",
        )
    if pricing_strategy in compatible:
        return CompatResult("ok")
    return CompatResult(
        "block",
        f"Adapter '{adapter_type}' không tương thích với chiến lược giá '{pricing_strategy}' — "
        f"chỉ dùng được với: {', '.join(sorted(compatible))}.",
    )


def setup_status(
    adapter_type: str | None, pricing_strategy: str | None, *, provider_active: bool = True,
) -> dict:
    """Tổng hợp trạng thái sẵn sàng bán của một sản phẩm.

    `needs_setup` tách riêng khỏi `demo_mode`: sản phẩm dùng mock là một
    trạng thái dev/demo đã biết trước, không phải cấu hình sai — gộp chung
    sẽ làm bộ lọc "sản phẩm lỗi cấu hình" ở admin đầy rác không thật sự cần xử lý.

    Strategy "fixed" đi qua đường variant_id cũ (claim_resources trực tiếp,
    không qua Provider/adapter) nên KHÔNG cần provider — chỉ coi là thiếu
    cấu hình khi strategy thật sự cần adapter (config/credit/task).
    """
    if not adapter_type:
        if pricing_strategy == "fixed":
            return {"needs_setup": False, "needs_setup_reason": None, "demo_mode": False}
        return {
            "needs_setup": True,
            "needs_setup_reason": "Chưa gắn nhà cung cấp (provider) nào cho sản phẩm này.",
            "demo_mode": False,
        }

    # Provider bị tắt (thủ công, hoặc tự tắt vì hết tiền / hỏng 3 lần liên
    # tiếp) thì sản phẩm KHÔNG bán được: get_adapter sẽ raise, đơn bị huỷ +
    # hoàn tiền ngay sau khi đã trừ ví buyer. Chặn ở đây để FE khoá nút mua,
    # thay vì để khách đặt rồi nhận một đơn huỷ khó hiểu.
    if not provider_active:
        return {
            "needs_setup": True,
            "needs_setup_reason": "Nhà cung cấp của sản phẩm này đang tạm ngừng — vui lòng quay lại sau.",
            "demo_mode": False,
        }

    result = check_compatibility(adapter_type, pricing_strategy)
    return {
        "needs_setup": result.level == "block",
        "needs_setup_reason": result.message if result.level == "block" else None,
        "demo_mode": result.level == "warn",
    }
