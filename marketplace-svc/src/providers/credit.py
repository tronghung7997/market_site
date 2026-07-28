"""Sổ Xu ước tính của provider TopProxy + cảnh báo hết tiền.

Vì sao cần: TopProxy trả trước bằng Xu và KHÔNG có API xem số dư
(docs/topproxy-catalog.md §1). Hết Xu thì mọi lệnh mua trả mã `102`, và biểu
hiện phía buyer là đơn nào cũng bị huỷ + hoàn tiền — im lặng cho tới khi có
người phàn nàn.

Hai lớp bảo vệ, cố tình tách rời:

1. PHẢN ỨNG (`report_out_of_credit`) — gặp `102` là chắc chắn đã hết tiền:
   tắt provider để ngừng nhận đơn, bắn alert. Chính xác 100% nhưng muộn.
2. DỰ BÁO (`debit_estimated_cost` + `credit_low_check_job`) — tự trừ dần từ số
   dư admin nhập, cảnh báo trước khi chạm đáy. Sớm nhưng chỉ là ước tính.

Alert đi qua `create_alert_once` nên 50 đơn fail liên tiếp vẫn chỉ một dòng
cảnh báo, không trôi mất mọi thứ khác trong /admin/alerts.
"""
from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.alert import Alert
from src.models.provider import Provider

logger = structlog.get_logger()

ALERT_OUT_OF_CREDIT = "provider_out_of_credit"
ALERT_LOW_CREDIT = "provider_low_credit"

# Ngưỡng mặc định khi admin bật theo dõi mà không tự chọn: ~8 đơn key xoay
# theo tháng, đủ thời gian phản ứng trước khi thật sự cạn.
DEFAULT_LOW_THRESHOLD_XU = 20_000


async def create_alert_once(
    type_: str, severity: str, target_type: str, target_id: int, message: str, db: AsyncSession,
) -> Alert | None:
    """Như `create_alert` nhưng KHÔNG tạo trùng: đã có một alert cùng
    (type, target_type, target_id) đang active thì bỏ qua, trả None.

    Cần thiết vì các sự cố ở đây lặp lại theo từng đơn — hết Xu mà 50 khách
    cùng đặt là 50 lần gặp `102`, admin chỉ cần biết MỘT lần."""
    from src.alerts.service import create_alert

    existing = await db.scalar(
        select(Alert.id).where(
            Alert.type == type_,
            Alert.target_type == target_type,
            Alert.target_id == target_id,
            Alert.is_active.is_(True),
        ).limit(1)
    )
    if existing is not None:
        return None
    return await create_alert(type_, severity, target_type, target_id, message, db)


async def report_out_of_credit(provider_id: int, db: AsyncSession) -> None:
    """Gọi khi nhà cung cấp trả mã "hết tiền" (TopProxy `102`).

    Tắt provider: mỗi đơn đi qua provider hết tiền là một vòng trừ ví → cấp
    phát hỏng → hoàn tiền cho buyer. Dừng bán sớm hơn thì đỡ hơn cho cả hai
    phía. Admin nạp Xu xong dùng `set_credit_balance` để bật lại.

    Tự commit (giống `create_alert`) nên PHẢI gọi SAU khi caller commit xong
    transaction đơn hàng.
    """
    provider = await db.get(Provider, provider_id)
    if provider is None:
        return

    name = provider.name
    was_active = provider.is_active
    if was_active:
        provider.is_active = False
    # Số dư ước tính rõ ràng đã sai (thực tế là 0) — chốt về 0 để lần nạp sau
    # admin nhập đúng con số thật thay vì cộng dồn lên một số đã trôi.
    if provider.credit_balance_xu is not None:
        provider.credit_balance_xu = 0
        provider.credit_updated_at = datetime.now(timezone.utc)
    await db.commit()

    await create_alert_once(
        ALERT_OUT_OF_CREDIT, "critical", "provider", provider_id,
        f"Nhà cung cấp {name} đã HẾT TIỀN — đã tạm dừng bán. "
        f"Nạp Xu trên topproxy.vn rồi cập nhật số dư ở /admin/providers để bán lại.",
        db,
    )
    logger.error("provider_out_of_credit", provider_id=provider_id, was_active=was_active)


async def debit_estimated_cost(provider_id: int, cost_xu: int | None, db: AsyncSession) -> None:
    """Trừ giá vốn ước tính của MỘT lệnh mua thành công khỏi sổ.

    Không commit — chạy chung transaction với đơn hàng, nên lệnh mua bị rollback
    thì số Xu cũng không bị trừ oan.

    Bỏ qua lặng lẽ khi chưa bật theo dõi (`credit_balance_xu` NULL) hoặc không
    tra được giá vốn (`cost_xu` None) — thà không biết còn hơn trừ sai rồi
    cảnh báo nhầm.
    """
    if cost_xu is None or cost_xu <= 0 or provider_id is None:
        return
    provider = await db.get(Provider, provider_id)
    if provider is None or provider.credit_balance_xu is None:
        return
    # Cho phép âm: số dư ước tính âm là tín hiệu rõ ràng rằng sổ đã trôi xa so
    # với thực tế, hữu ích hơn là kẹp về 0 rồi tưởng vẫn còn tiền.
    provider.credit_balance_xu -= cost_xu
    provider.credit_updated_at = datetime.now(timezone.utc)
    logger.info(
        "provider_credit_debited",
        provider_id=provider_id, cost_xu=cost_xu, remaining_xu=provider.credit_balance_xu,
    )


async def set_credit_balance(
    provider_id: int, balance_xu: int, low_threshold_xu: int | None, db: AsyncSession,
) -> Provider:
    """Admin nhập lại số dư Xu thật (sau khi nạp trên topproxy.vn).

    Đây cũng là nút "đã nạp tiền, bán lại đi": bật lại provider và gỡ cảnh báo
    hết tiền, nên admin không phải nhớ làm ba việc rời rạc.
    """
    from src.alerts.service import dismiss_alert

    provider = await db.get(Provider, provider_id)
    if provider is None:
        raise ValueError(f"Provider {provider_id} not found")

    provider.credit_balance_xu = balance_xu
    if low_threshold_xu is not None:
        provider.credit_low_threshold_xu = low_threshold_xu
    elif provider.credit_low_threshold_xu is None:
        provider.credit_low_threshold_xu = DEFAULT_LOW_THRESHOLD_XU
    provider.credit_updated_at = datetime.now(timezone.utc)
    provider.is_active = True
    await db.commit()

    # Gỡ cả hai loại cảnh báo tiền nong — nạp xong thì chúng hết ý nghĩa.
    stale = (await db.execute(
        select(Alert).where(
            Alert.type.in_([ALERT_OUT_OF_CREDIT, ALERT_LOW_CREDIT]),
            Alert.target_type == "provider",
            Alert.target_id == provider_id,
            Alert.is_active.is_(True),
        )
    )).scalars().all()
    for alert in stale:
        await dismiss_alert(alert.id, db)

    logger.info("provider_credit_set", provider_id=provider_id, balance_xu=balance_xu)
    await db.refresh(provider)
    return provider
