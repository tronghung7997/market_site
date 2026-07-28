"""Sổ Xu ước tính + cảnh báo hết tiền nhà cung cấp.

Bối cảnh: TopProxy trả trước bằng Xu và KHÔNG có API xem số dư
(docs/topproxy-catalog.md §1). Hết Xu thì mọi đơn bị huỷ + hoàn tiền trong im
lặng — đúng kiểu sự cố chỉ phát hiện khi có người phàn nàn.
"""
import pytest

from src.adapters.topproxy_costs import static_cost_xu, xoay_cost_xu
from src.models.alert import Alert
from src.models.provider import Provider
from src.providers.credit import (
    ALERT_LOW_CREDIT,
    ALERT_OUT_OF_CREDIT,
    create_alert_once,
    debit_estimated_cost,
    report_out_of_credit,
    set_credit_balance,
)
from sqlalchemy import select

from src.database import SessionLocal

# Mở session TRONG thân test (đúng convention của repo, xem tests/test_auth.py)
# chứ không dùng fixture: fixture giữ transaction mở qua ranh giới test và
# deadlock với TRUNCATE của `clean_db` ở test kế tiếp.


@pytest.mark.no_db  # thuần hàm, không chạm DB → khỏi TRUNCATE trước mỗi case
class TestCostTable:
    """Giá vốn theo bậc thang (catalog §2G) — mua càng dài đơn giá/ngày càng rẻ."""

    @pytest.mark.parametrize("days,expected_per_day", [
        (1, 800), (3, 800), (5, 720), (10, 640), (30, 480), (120, 320),
    ])
    def test_residential_share_ladder(self, days, expected_per_day):
        assert static_cost_xu("Viettel", days) == expected_per_day * days

    def test_datacenter_private_is_the_expensive_tier(self):
        # 1 ngày dùng riêng = 2.800 Xu; sản phẩm #31 bán 4.200đ → biên +50%.
        assert static_cost_xu("DatacenterA", 1) == 2800

    def test_package_products_priced_per_30_days(self):
        assert static_cost_xu("GoiDATACENTER", 30) == 480_000

    def test_unknown_loaiproxy_returns_none_instead_of_guessing(self):
        # None = bỏ qua trừ sổ. Đoán bừa sẽ làm số dư ước tính sai âm thầm.
        assert static_cost_xu("KhongCoLoaiNay", 30) is None
        assert static_cost_xu("Viettel", 0) is None

    @pytest.mark.parametrize("unit,thoigian,expected", [
        ("day", 1, 2_500), ("day", 5, 12_500), ("week", 2, 28_000), ("month", 3, 135_000),
    ])
    def test_xoay_costs(self, unit, thoigian, expected):
        assert xoay_cost_xu(unit, thoigian) == expected

    def test_xoay_unknown_unit(self):
        assert xoay_cost_xu("century", 1) is None


async def _provider(db, **kw) -> Provider:
    p = Provider(
        name=kw.pop("name", "TP test"), type="proxy", adapter_type="topproxy",
        config={}, is_active=True, **kw,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


class TestDebit:
    @pytest.mark.asyncio
    async def test_debit_reduces_balance(self):
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=10_000)
            await debit_estimated_cost(p.id, 2_500, db)
            assert p.credit_balance_xu == 7_500
            await db.rollback()

    @pytest.mark.asyncio
    async def test_no_tracking_means_no_debit(self):
        # credit_balance_xu NULL = admin chưa bật theo dõi → im lặng bỏ qua.
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=None)
            await debit_estimated_cost(p.id, 2_500, db)
            assert p.credit_balance_xu is None
            await db.rollback()

    @pytest.mark.asyncio
    async def test_unknown_cost_is_skipped(self):
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=10_000)
            await debit_estimated_cost(p.id, None, db)
            assert p.credit_balance_xu == 10_000
            await db.rollback()

    @pytest.mark.asyncio
    async def test_balance_may_go_negative(self):
        # Âm là tín hiệu "sổ đã trôi xa thực tế", hữu ích hơn là kẹp về 0 rồi
        # tưởng vẫn còn tiền.
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=1_000)
            await debit_estimated_cost(p.id, 2_500, db)
            assert p.credit_balance_xu == -1_500
            await db.rollback()


class TestOutOfCredit:
    @pytest.mark.asyncio
    async def test_stops_selling_and_alerts_once(self):
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=500)
            pid = p.id

            # Ba đơn liên tiếp cùng gặp 102 — admin chỉ cần biết MỘT lần.
            for _ in range(3):
                await report_out_of_credit(pid, db)

            await db.refresh(p)
            assert p.is_active is False
            assert p.credit_balance_xu == 0  # sổ rõ ràng đã sai, chốt về 0

            alerts = (await db.execute(
                select(Alert).where(Alert.type == ALERT_OUT_OF_CREDIT, Alert.target_id == pid)
            )).scalars().all()
            assert len(alerts) == 1
            assert alerts[0].severity == "critical"
            await db.rollback()

    @pytest.mark.asyncio
    async def test_topping_up_reopens_selling_and_clears_alerts(self):
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=0)
            pid = p.id
            await report_out_of_credit(pid, db)
            await create_alert_once(ALERT_LOW_CREDIT, "warning", "provider", pid, "sắp hết", db)

            await set_credit_balance(pid, 500_000, 30_000, db)

            await db.refresh(p)
            assert p.is_active is True
            assert p.credit_balance_xu == 500_000
            assert p.credit_low_threshold_xu == 30_000
            active = (await db.execute(
                select(Alert).where(Alert.target_id == pid, Alert.is_active.is_(True))
            )).scalars().all()
            assert active == []
            await db.rollback()


class TestAlertOnce:
    @pytest.mark.asyncio
    async def test_second_call_is_a_noop_while_first_is_active(self):
        async with SessionLocal() as db:
            p = await _provider(db)
            first = await create_alert_once("x_alert", "warning", "provider", p.id, "một", db)
            second = await create_alert_once("x_alert", "warning", "provider", p.id, "hai", db)
            assert first is not None
            assert second is None
            await db.rollback()

    @pytest.mark.asyncio
    async def test_alerts_for_different_targets_are_independent(self):
        async with SessionLocal() as db:
            a = await _provider(db, name="A")
            b = await _provider(db, name="B")
            assert await create_alert_once("x_alert2", "warning", "provider", a.id, "m", db)
            assert await create_alert_once("x_alert2", "warning", "provider", b.id, "m", db)
            await db.rollback()
