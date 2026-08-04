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

Incident hết/sắp hết Xu đi qua fingerprint `provider:{id}:provider_out_of_credit`
(và low credit) nên 50 đơn fail liên tiếp vẫn chỉ một dòng active, count tăng.
"""
from datetime import datetime, timezone

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from src.alerts.service import emit_incident, fp_provider
from src.models.alert import Alert
from src.models.provider import Provider

logger = structlog.get_logger()

ALERT_OUT_OF_CREDIT = "provider_out_of_credit"
ALERT_LOW_CREDIT = "provider_low_credit"

# Ngưỡng mặc định khi admin bật theo dõi mà không tự chọn: ~8 đơn key xoay
# theo tháng, đủ thời gian phản ứng trước khi thật sự cạn.
DEFAULT_LOW_THRESHOLD_XU = 20_000


async def report_out_of_credit(provider_id: int, db: AsyncSession) -> None:
    """Gọi khi nhà cung cấp trả mã "hết tiền" (TopProxy `102`).

    Tắt provider: mỗi đơn đi qua provider hết tiền là một vòng trừ ví → cấp
    phát hỏng → hoàn tiền cho buyer. Dừng bán sớm hơn thì đỡ hơn cho cả hai
    phía. Admin nạp Xu xong dùng `set_credit_balance` để bật lại.

    Commits provider state, then emits the incident on its own session so a
    prior domain rollback cannot swallow the outage signal.
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

    await emit_incident(
        fingerprint=fp_provider(provider_id, ALERT_OUT_OF_CREDIT),
        type_=ALERT_OUT_OF_CREDIT,
        severity="critical",
        target_type="provider",
        target_id=provider_id,
        message=(
            f"Nhà cung cấp {name} đã HẾT TIỀN — đã tạm dừng bán. "
            f"Nạp Xu trên topproxy.vn rồi cập nhật số dư ở /admin/providers để bán lại."
        ),
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
    now = datetime.now(timezone.utc)
    # Trừ NGAY TRONG câu UPDATE (không đọc ra Python rồi gán lại): hai provision
    # chạy song song trên hai session cùng đọc 100k rồi mỗi bên trừ 45k sẽ chốt
    # 55k thay vì 10k — sổ trôi có hệ thống theo hướng LẠC QUAN, tức cảnh báo
    # sắp hết Xu đến muộn, đúng cái cơ chế này sinh ra để tránh.
    # Cho phép âm: số dư ước tính âm là tín hiệu rõ ràng rằng sổ đã trôi xa so
    # với thực tế, hữu ích hơn là kẹp về 0 rồi tưởng vẫn còn tiền.
    result = await db.execute(
        update(Provider)
        .where(Provider.id == provider_id, Provider.credit_balance_xu.isnot(None))
        .values(
            credit_balance_xu=Provider.credit_balance_xu - cost_xu,
            credit_updated_at=now,
        )
        .returning(Provider.credit_balance_xu)
        .execution_options(synchronize_session=False)
    )
    row = result.first()
    if row is None:
        return  # provider không tồn tại hoặc chưa bật theo dõi (NULL)
    remaining_xu = row[0]
    # Đồng bộ bản sao trong identity map (get_adapter thường đã load Provider
    # trên cùng session) mà KHÔNG mark dirty — mark dirty là flush lại con số
    # vừa đọc và tái tạo đúng lost update vừa loại bỏ.
    provider = await db.get(Provider, provider_id)
    if provider is not None:
        set_committed_value(provider, "credit_balance_xu", remaining_xu)
        set_committed_value(provider, "credit_updated_at", now)
    logger.info(
        "provider_credit_debited",
        provider_id=provider_id, cost_xu=cost_xu, remaining_xu=remaining_xu,
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
