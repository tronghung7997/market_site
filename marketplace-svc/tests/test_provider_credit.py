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
    debit_estimated_cost,
    report_out_of_credit,
    set_credit_balance,
)
from src.alerts.service import emit_incident, fp_provider, upsert_incident
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

            # Ba đơn liên tiếp cùng gặp 102 — một active incident, count tăng.
            for _ in range(3):
                await report_out_of_credit(pid, db)

            await db.refresh(p)
            assert p.is_active is False
            assert p.credit_balance_xu == 0  # sổ rõ ràng đã sai, chốt về 0

            alerts = (await db.execute(
                select(Alert).where(
                    Alert.type == ALERT_OUT_OF_CREDIT,
                    Alert.target_type == "provider",
                    Alert.target_id == pid,
                    Alert.is_active.is_(True),
                )
            )).scalars().all()
            assert len(alerts) == 1
            assert alerts[0].severity == "critical"
            assert alerts[0].occurrence_count == 3
            assert alerts[0].fingerprint == fp_provider(pid, ALERT_OUT_OF_CREDIT)
            await db.rollback()

    @pytest.mark.asyncio
    async def test_order_fail_also_alerts_seller(self):
        """Đơn fail 102 → seller của đơn có bell (gộp theo seller+provider)."""
        from src.models.account import Account
        from src.models.order import Order, OrderStatus
        from src.orders.service import _raise_operational_alert

        async with SessionLocal() as db:
            buyer = Account(email="buyer-ooc@ex.com", password_hash="x", roles=["buyer"])
            seller = Account(email="seller-ooc@ex.com", password_hash="x", roles=["buyer", "seller"])
            db.add_all([buyer, seller])
            await db.flush()
            p = await _provider(db, credit_balance_xu=100)
            order = Order(
                buyer_id=buyer.id, seller_id=seller.id, quantity=1,
                total_amount=10_000, status=OrderStatus.cancelled,
            )
            db.add(order)
            await db.commit()
            await db.refresh(order)
            seller_id, order_id, pid = seller.id, order.id, p.id

            for _ in range(2):
                await _raise_operational_alert(order_id, "out_of_credit", str(pid), db)

            admin_alerts = (await db.execute(
                select(Alert).where(
                    Alert.type == ALERT_OUT_OF_CREDIT,
                    Alert.target_type == "provider",
                    Alert.target_id == pid,
                    Alert.is_active.is_(True),
                )
            )).scalars().all()
            seller_alerts = (await db.execute(
                select(Alert).where(
                    Alert.type == ALERT_OUT_OF_CREDIT,
                    Alert.target_type == "seller",
                    Alert.target_id == seller_id,
                    Alert.is_active.is_(True),
                )
            )).scalars().all()
            assert len(admin_alerts) == 1
            assert len(seller_alerts) == 1
            assert seller_alerts[0].occurrence_count == 2
            assert seller_alerts[0].fingerprint == (
                f"seller:{seller_id}:{ALERT_OUT_OF_CREDIT}:{pid}"
            )
            assert "hết tiền" in seller_alerts[0].message
            await db.rollback()

    @pytest.mark.asyncio
    async def test_topping_up_reopens_selling_and_clears_alerts(self):
        async with SessionLocal() as db:
            p = await _provider(db, credit_balance_xu=0)
            pid = p.id
            await report_out_of_credit(pid, db)
            await emit_incident(
                fingerprint=fp_provider(pid, ALERT_LOW_CREDIT),
                type_=ALERT_LOW_CREDIT,
                severity="warning",
                target_type="provider",
                target_id=pid,
                message="sắp hết",
            )
            # Seller alert từ đơn fail — cũng phải gỡ khi nạp lại.
            await emit_incident(
                fingerprint=f"seller:99:{ALERT_OUT_OF_CREDIT}:{pid}",
                type_=ALERT_OUT_OF_CREDIT,
                severity="critical",
                target_type="seller",
                target_id=99,
                message="đơn fail hết tiền",
            )

            await set_credit_balance(pid, 500_000, 30_000, db)

            await db.refresh(p)
            assert p.is_active is True
            assert p.credit_balance_xu == 500_000
            assert p.credit_low_threshold_xu == 30_000
            active = (await db.execute(
                select(Alert).where(Alert.is_active.is_(True))
            )).scalars().all()
            assert active == []
            await db.rollback()


class TestIncidentUpsert:
    @pytest.mark.asyncio
    async def test_second_upsert_increments_count(self):
        async with SessionLocal() as db:
            p = await _provider(db)
            fp = fp_provider(p.id, "x_alert")
            first = await upsert_incident(
                db, fingerprint=fp, type_="x_alert", severity="warning",
                target_type="provider", target_id=p.id, message="một",
            )
            second = await upsert_incident(
                db, fingerprint=fp, type_="x_alert", severity="warning",
                target_type="provider", target_id=p.id, message="hai",
            )
            await db.commit()
            assert first.id == second.id
            assert second.occurrence_count == 2
            assert second.message == "hai"
            await db.rollback()

    @pytest.mark.asyncio
    async def test_incidents_for_different_targets_are_independent(self):
        async with SessionLocal() as db:
            a = await _provider(db, name="A")
            b = await _provider(db, name="B")
            await upsert_incident(
                db, fingerprint=fp_provider(a.id, "x_alert2"), type_="x_alert2",
                severity="warning", target_type="provider", target_id=a.id, message="m",
            )
            await upsert_incident(
                db, fingerprint=fp_provider(b.id, "x_alert2"), type_="x_alert2",
                severity="warning", target_type="provider", target_id=b.id, message="m",
            )
            await db.commit()
            active = (await db.execute(
                select(Alert).where(Alert.type == "x_alert2", Alert.is_active.is_(True))
            )).scalars().all()
            assert len(active) == 2
            await db.rollback()
