"""Tests for pricing strategy layer — pure Python, no DB required.

Contract: subclasses implement _subtotal(); quote() is the ONLY money API
and applies volume discount exactly once.
"""

import pytest

from src.pricing.base import PricingStrategy, Quote
from src.pricing.fixed import FixedPricing
from src.pricing.config_pricing import ConfigPricing
from src.pricing.credit import CreditPricing
from src.pricing.task import TaskPricing
from src.pricing.factory import get_pricing_strategy


# ---------------------------------------------------------------------------
# Fixtures — sample params mimicking pricing_configs.params
# ---------------------------------------------------------------------------

FIXED_PARAMS = {
    "variants": [
        {"id": "basic", "label": "Email only", "price": 15000},
        {"id": "premium", "label": "Email + cookies", "price": 25000},
    ],
    "volume_tiers": [
        {"min_qty": 10, "discount": 0.05},
        {"min_qty": 50, "discount": 0.10},
    ],
}

CONFIG_PARAMS = {
    "base_price": 75000,
    "type_mult": {
        "residential_static": 1.6,
        "residential_rotating": 1.2,
        "datacenter": 1.0,
    },
    "network_mult": {
        "viettel": 1.0,
        "fpt": 0.9,
        "vnpt": 0.85,
    },
    "duration_options": [
        {"days": 7, "label": "7 ngay"},
        {"days": 30, "label": "30 ngay"},
    ],
    "volume_tiers": [
        {"min_qty": 5, "discount": 0.05},
        {"min_qty": 20, "discount": 0.10},
    ],
}

CREDIT_PARAMS = {
    "credit_price": 10,
    "packages": [
        {"size": 1000, "label": "1K requests"},
        {"size": 5000, "label": "5K requests"},
        {"size": 10000, "label": "10K requests"},
    ],
    "volume_tiers": [
        {"min_qty": 5000, "discount": 0.05},
        {"min_qty": 10000, "discount": 0.10},
    ],
}

TASK_PARAMS = {
    "base_price": 500000,
    "platform_mult": {
        "facebook": 1.0,
        "instagram": 1.0,
        "tiktok": 1.2,
        "youtube": 1.5,
    },
    "volume_tiers": [
        {"min_qty": 5, "discount": 0.05},
        {"min_qty": 10, "discount": 0.10},
    ],
}


def urls(n: int) -> str:
    return "\n".join(f"https://fb.com/post/{i}" for i in range(n))


# ---------------------------------------------------------------------------
# Volume discount (base class helper)
# ---------------------------------------------------------------------------

class TestVolumeDiscount:
    def setup_method(self):
        self.strategy = FixedPricing()  # any concrete subclass works

    def test_no_tiers(self):
        assert self.strategy.apply_volume_discount(100000, 5, []) == (100000, None)

    def test_below_all_tiers(self):
        tiers = [{"min_qty": 10, "discount": 0.05}]
        assert self.strategy.apply_volume_discount(100000, 3, tiers) == (100000, None)

    def test_matches_first_tier(self):
        tiers = [{"min_qty": 10, "discount": 0.05}, {"min_qty": 50, "discount": 0.10}]
        result = self.strategy.apply_volume_discount(100000, 15, tiers)
        assert result == (95000, 0.05)

    def test_matches_highest_tier(self):
        tiers = [{"min_qty": 10, "discount": 0.05}, {"min_qty": 50, "discount": 0.10}]
        result = self.strategy.apply_volume_discount(100000, 60, tiers)
        assert result == (90000, 0.10)

    def test_exact_boundary(self):
        tiers = [{"min_qty": 10, "discount": 0.05}]
        result = self.strategy.apply_volume_discount(100000, 10, tiers)
        assert result == (95000, 0.05)

    def test_rounds_to_int(self):
        tiers = [{"min_qty": 1, "discount": 0.03}]
        # 99999 * 0.97 = 96999.03 -> rounds to 96999
        result = self.strategy.apply_volume_discount(99999, 1, tiers)
        assert result == (96999, 0.03)


# ---------------------------------------------------------------------------
# FixedPricing
# ---------------------------------------------------------------------------

class TestFixedPricing:
    def setup_method(self):
        self.strategy = FixedPricing()

    def test_quote_basic(self):
        q = self.strategy.quote(FIXED_PARAMS, {"variant_id": "premium", "quantity": 3})
        assert isinstance(q, Quote)
        assert (q.amount, q.quantity, q.discount_pct) == (75000, 3, None)
        assert q.original_amount is None
        assert q.strategy == "fixed"

    def test_quote_volume_discount_applied_once(self):
        q = self.strategy.quote(FIXED_PARAMS, {"variant_id": "premium", "quantity": 10})
        # 25000*10 = 250000, 5% off MỘT lần = 237500 (không phải 225625)
        assert (q.amount, q.original_amount, q.discount_pct) == (237500, 250000, 0.05)

    def test_quote_no_discount_below_tier(self):
        q = self.strategy.quote(FIXED_PARAMS, {"variant_id": "basic", "quantity": 5})
        assert (q.amount, q.original_amount) == (75000, None)

    def test_validate_valid(self):
        assert self.strategy.validate(FIXED_PARAMS, {"variant_id": "basic", "quantity": 1}) is True

    def test_validate_missing_variant(self):
        assert self.strategy.validate(FIXED_PARAMS, {"quantity": 1}) is False

    def test_validate_invalid_variant_id(self):
        assert self.strategy.validate(FIXED_PARAMS, {"variant_id": "nonexistent", "quantity": 1}) is False

    def test_validate_zero_quantity(self):
        assert self.strategy.validate(FIXED_PARAMS, {"variant_id": "basic", "quantity": 0}) is False

    def test_validate_negative_quantity(self):
        assert self.strategy.validate(FIXED_PARAMS, {"variant_id": "basic", "quantity": -1}) is False

    def test_get_options_returns_fields(self):
        fields = self.strategy.get_options(FIXED_PARAMS)
        assert len(fields) == 2
        assert fields[0]["field"] == "variant_id"
        assert fields[0]["type"] == "select"
        assert len(fields[0]["choices"]) == 2
        assert fields[1]["field"] == "quantity"


# ---------------------------------------------------------------------------
# ConfigPricing
# ---------------------------------------------------------------------------

class TestConfigPricing:
    def setup_method(self):
        self.strategy = ConfigPricing()

    def test_quote_basic(self):
        config = {"type": "residential_static", "network": "viettel", "days": 30, "quantity": 1}
        # 75000 * 1.6 * 1.0 * (30/30) * 1 = 120000
        q = self.strategy.quote(CONFIG_PARAMS, config)
        assert (q.amount, q.quantity, q.strategy) == (120000, 1, "config")

    def test_quote_partial_month(self):
        config = {"type": "datacenter", "network": "fpt", "days": 7, "quantity": 2}
        # 75000 * 1.0 * 0.9 * (7/30) * 2 = 31500
        assert self.strategy.quote(CONFIG_PARAMS, config).amount == 31500

    def test_quote_with_volume_discount(self):
        config = {"type": "datacenter", "network": "viettel", "days": 30, "quantity": 5}
        # 75000 * 5 = 375000, 5% off = 356250
        q = self.strategy.quote(CONFIG_PARAMS, config)
        assert (q.amount, q.original_amount, q.discount_pct) == (356250, 375000, 0.05)

    def test_validate_valid(self):
        config = {"type": "residential_static", "network": "viettel", "days": 30, "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is True

    def test_validate_missing_field(self):
        config = {"type": "datacenter", "network": "viettel", "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is False

    def test_validate_invalid_type(self):
        config = {"type": "nonexistent", "network": "viettel", "days": 30, "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is False

    def test_validate_invalid_network(self):
        config = {"type": "datacenter", "network": "nonexistent", "days": 30, "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is False

    def test_validate_zero_days(self):
        config = {"type": "datacenter", "network": "viettel", "days": 0, "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is False

    @pytest.mark.parametrize("days", [1, 3, 45, 365])
    def test_validate_rejects_days_not_in_duration_options(self, days):
        """Giá ở đây tuyến tính theo ngày còn giá nhập của nhà cung cấp là bậc
        thang (kỳ hạn càng ngắn đơn giá càng đắt). Cho phép days tự do nghĩa là
        gọi thẳng API với days=1 sẽ trả 1/30 giá tháng trong khi mình mua ở đơn
        giá ngày đắt nhất — lỗ đều mỗi đơn. Chỉ bán đúng kỳ hạn đã niêm yết."""
        config = {"type": "datacenter", "network": "viettel", "days": days, "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is False

    def test_validate_accepts_listed_durations(self):
        for days in (7, 30):
            config = {"type": "datacenter", "network": "viettel", "days": days, "quantity": 1}
            assert self.strategy.validate(CONFIG_PARAMS, config) is True

    def test_validate_rejects_float_days(self):
        # 1.9 ngày: FE không gửi được, nhưng gọi thẳng API thì trả tiền theo
        # 1.9/30 tháng trong khi adapter int() xuống 1 ngày và mua nguyên ngày.
        config = {"type": "datacenter", "network": "viettel", "days": 7.0, "quantity": 1}
        assert self.strategy.validate(CONFIG_PARAMS, config) is False

    def test_validate_without_duration_options_keeps_positive_int_rule(self):
        # Sản phẩm chưa niêm yết kỳ hạn nào thì giữ luật cũ (dương, nguyên) —
        # không phá cấu hình sẵn có.
        params = {k: v for k, v in CONFIG_PARAMS.items() if k != "duration_options"}
        config = {"type": "datacenter", "network": "viettel", "days": 45, "quantity": 1}
        assert self.strategy.validate(params, config) is True

    def test_get_options_returns_fields(self):
        field_names = [f["field"] for f in self.strategy.get_options(CONFIG_PARAMS)]
        assert {"type", "network", "days", "quantity"} <= set(field_names)


# ---------------------------------------------------------------------------
# CreditPricing
# ---------------------------------------------------------------------------

class TestCreditPricing:
    def setup_method(self):
        self.strategy = CreditPricing()

    def test_quote_basic(self):
        q = self.strategy.quote(CREDIT_PARAMS, {"package_size": 1000})
        # 10 * 1000 = 10000 (dưới min_qty 5000, không discount)
        assert (q.amount, q.quantity, q.strategy) == (10000, 1000, "credit")

    def test_quote_with_volume_discount(self):
        q = self.strategy.quote(CREDIT_PARAMS, {"package_size": 5000})
        # 10 * 5000 = 50000, 5% off = 47500
        assert (q.amount, q.original_amount, q.discount_pct) == (47500, 50000, 0.05)

    def test_quote_high_tier_discount(self):
        q = self.strategy.quote(CREDIT_PARAMS, {"package_size": 10000})
        assert (q.amount, q.discount_pct) == (90000, 0.10)

    def test_quote_no_tiers(self):
        q = self.strategy.quote({"credit_price": 10}, {"package_size": 1000})
        assert (q.amount, q.original_amount, q.discount_pct) == (10000, None, None)

    def test_validate_valid(self):
        assert self.strategy.validate(CREDIT_PARAMS, {"package_size": 1000}) is True

    def test_validate_missing_package_size(self):
        assert self.strategy.validate(CREDIT_PARAMS, {}) is False

    def test_validate_zero_package(self):
        assert self.strategy.validate(CREDIT_PARAMS, {"package_size": 0}) is False

    def test_validate_float_package(self):
        assert self.strategy.validate(CREDIT_PARAMS, {"package_size": 1.5}) is False

    def test_get_options_with_packages(self):
        fields = self.strategy.get_options(CREDIT_PARAMS)
        assert len(fields) == 1
        assert fields[0]["field"] == "package_size"
        assert fields[0]["type"] == "select"
        assert len(fields[0]["choices"]) == 3

    def test_get_options_without_packages(self):
        fields = self.strategy.get_options({"credit_price": 10})
        assert len(fields) == 1
        assert fields[0]["field"] == "package_size"
        assert fields[0]["type"] == "number"


# ---------------------------------------------------------------------------
# TaskPricing — quantity tự đếm từ target_urls
# ---------------------------------------------------------------------------

class TestTaskPricing:
    def setup_method(self):
        self.strategy = TaskPricing()

    def test_parse_target_urls_trims_and_skips_blanks(self):
        raw = "https://fb.com/a\nhttps://fb.com/b\n\n  https://fb.com/c  \n"
        assert TaskPricing.parse_target_urls(raw) == [
            "https://fb.com/a", "https://fb.com/b", "https://fb.com/c",
        ]

    def test_parse_target_urls_empty(self):
        assert TaskPricing.parse_target_urls("") == []
        assert TaskPricing.parse_target_urls("  \n \n") == []

    def test_quote_counts_urls(self):
        q = self.strategy.quote(TASK_PARAMS, {"platform": "facebook", "target_urls": urls(3)})
        # 500000 * 1.0 * 3
        assert (q.amount, q.quantity, q.strategy) == (1500000, 3, "task")

    def test_quote_with_multiplier(self):
        q = self.strategy.quote(TASK_PARAMS, {"platform": "youtube", "target_urls": urls(2)})
        # 500000 * 1.5 * 2 = 1500000
        assert (q.amount, q.quantity) == (1500000, 2)

    def test_quote_tiktok_single(self):
        q = self.strategy.quote(TASK_PARAMS, {"platform": "tiktok", "target_urls": urls(1)})
        assert (q.amount, q.quantity) == (600000, 1)

    def test_quote_url_discount_applied_once(self):
        q = self.strategy.quote(TASK_PARAMS, {"platform": "facebook", "target_urls": urls(5)})
        # 500000*5 = 2500000, 5% off MỘT lần = 2375000
        assert (q.amount, q.original_amount, q.discount_pct) == (2375000, 2500000, 0.05)

    def test_validate_valid(self):
        assert self.strategy.validate(
            TASK_PARAMS, {"platform": "facebook", "target_urls": urls(1)}
        ) is True

    def test_validate_missing_platform(self):
        assert self.strategy.validate(TASK_PARAMS, {"target_urls": urls(1)}) is False

    def test_validate_invalid_platform(self):
        assert self.strategy.validate(
            TASK_PARAMS, {"platform": "nonexistent", "target_urls": urls(1)}
        ) is False

    def test_validate_requires_urls(self):
        assert self.strategy.validate(TASK_PARAMS, {"platform": "facebook", "target_urls": ""}) is False
        assert self.strategy.validate(TASK_PARAMS, {"platform": "facebook"}) is False

    def test_get_options_has_no_quantity_field(self):
        names = [f["field"] for f in self.strategy.get_options(TASK_PARAMS)]
        assert "quantity" not in names
        assert "platform" in names
        assert "target_urls" in names


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

class TestFactory:
    def test_get_fixed(self):
        assert isinstance(get_pricing_strategy("fixed"), FixedPricing)

    def test_get_config(self):
        assert isinstance(get_pricing_strategy("config"), ConfigPricing)

    def test_get_credit(self):
        assert isinstance(get_pricing_strategy("credit"), CreditPricing)

    def test_get_task(self):
        assert isinstance(get_pricing_strategy("task"), TaskPricing)

    def test_unknown_raises(self):
        with pytest.raises(ValueError, match="Unknown pricing strategy"):
            get_pricing_strategy("nonexistent")

    def test_no_public_calculate(self):
        """calculate() đã bị xoá — quote() là API duy nhất."""
        assert not hasattr(PricingStrategy, "calculate")
