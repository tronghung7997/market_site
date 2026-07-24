"""Cứu các đơn TopProxy đã MUA THẬT nhưng bị cancel do bug parse response
(sự cố 2026-07-24: muaproxy.php trả về ARRAY, adapter cũ chỉ nhận dict →
báo "dữ liệu không hợp lệ" dù đã trừ Xu). Proxy đã mua vẫn nằm trong tài
khoản TopProxy với marker `od{order_id}` ở username.

Script này, cho từng order_id truyền vào:
  1. Re-charge buyer (deduct_credit) — hoàn lại dòng tiền đã refund lúc cancel.
  2. Set order về `pending`.
  3. Gọi provision_pending_order — adapter ĐÃ SỬA tìm proxy theo marker qua
     listproxy và BIND (KHÔNG mua lại, không tốn thêm Xu).

Chạy (SAU khi backend đã nạp code adapter đã sửa):
    cd marketplace-svc
    uv run python scripts/recover_topproxy_orders.py 79 81

Kiểm tra trước bằng --dry-run để chỉ xem, không đụng gì:
    uv run python scripts/recover_topproxy_orders.py --dry-run 79 81
"""
import asyncio
import sys

from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.orders.service import provision_pending_order
from src.wallet.service import deduct_credit


async def recover(order_ids: list[int], dry_run: bool) -> None:
    for oid in order_ids:
        async with SessionLocal() as db:
            order = await db.get(Order, oid)
            if order is None:
                print(f"order {oid}: KHÔNG tồn tại, bỏ qua")
                continue
            if order.status != OrderStatus.cancelled:
                print(f"order {oid}: status={order.status.value} (không phải cancelled), bỏ qua")
                continue
            print(f"order {oid}: US, {order.total_amount}đ, buyer {order.buyer_id}, config={order.user_config}")
            if dry_run:
                print("  [dry-run] sẽ: re-charge + set pending + provision (marker recovery)")
                continue
            await deduct_credit(
                order.buyer_id, order.total_amount,
                f"Tái kích hoạt đơn {oid} — cứu proxy đã mua", f"order-{oid}-recover", db,
            )
            order.status = OrderStatus.pending
            order.provider_id = None
            await db.commit()
            print(f"  đã re-charge {order.total_amount}đ + set pending")

        if dry_run:
            continue
        await provision_pending_order(oid)
        async with SessionLocal() as db:
            order = await db.get(Order, oid)
            print(f"  → {order.status.value}")
            if order.delivered_data:
                for line in order.delivered_data.splitlines():
                    print(f"    {line}")


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv
    ids = [int(a) for a in args]
    if not ids:
        print("Dùng: recover_topproxy_orders.py [--dry-run] <order_id> [order_id ...]")
        sys.exit(1)
    asyncio.run(recover(ids, dry))


if __name__ == "__main__":
    main()
