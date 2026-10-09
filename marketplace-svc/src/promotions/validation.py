"""Campaign input rules, one place for create and partial edit.

``validate_promotion`` takes the full field set (stored values merged with a
partial patch, or defaults merged with a create body) and returns the
normalised values, or raises a 422 whose ``detail`` is
``{"code": "validation", "fields": {field: Vietnamese message}}`` so the
console can show each message under its input.
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status

from src.models.promotion import DiscountType
from src.promotions.schemas import CODE_PATTERN, MAX_MONEY

_CODE = re.compile(CODE_PATTERN)

DEFAULTS = {
    "note": None, "max_discount_amount": None, "min_order_amount": 0, "starts_at": None, "ends_at": None,
    "usage_limit": None, "per_buyer_limit": 1, "budget_amount": None, "category_ids": [],
    "new_buyers_only": False, "is_active": True, "affiliate_account_id": None,
}
REQUIRED = ("code", "name", "discount_type", "discount_value")


def normalize_code(raw: str | None) -> str:
    return (raw or "").strip().upper()


class PromotionValidationError(HTTPException):
    def __init__(self, fields: dict[str, str]):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "validation", "fields": fields},
        )
        self.fields = fields


def _int_range(fields: dict, name: str, value, *, low: int, high: int, msg: str) -> None:
    if value is not None and not (low <= value <= high):
        fields[name] = msg


def validate_promotion(values: dict) -> dict:
    data = {**DEFAULTS, **{k: v for k, v in values.items() if k in DEFAULTS or k in REQUIRED}}
    fields: dict[str, str] = {}

    data["code"] = normalize_code(data.get("code"))
    if not data["code"]:
        fields["code"] = "Nhập mã khuyến mãi"
    elif not _CODE.match(data["code"]):
        fields["code"] = "Mã gồm 3–32 ký tự: chữ in hoa, số, '-' hoặc '_'"

    name = (data.get("name") or "").strip()
    data["name"] = name
    if not name:
        fields["name"] = "Nhập tên chiến dịch"
    elif len(name) > 120:
        fields["name"] = "Tên tối đa 120 ký tự"

    note = data.get("note")
    note = note.strip() if isinstance(note, str) else None
    data["note"] = note or None
    if note and len(note) > 2000:
        fields["note"] = "Ghi chú tối đa 2000 ký tự"

    kind = data.get("discount_type")
    if kind is not None and not isinstance(kind, DiscountType):
        try:
            kind = DiscountType(kind)
        except ValueError:
            kind = None
            fields["discount_type"] = "Chọn loại giảm giá"
    data["discount_type"] = kind
    if kind is None and "discount_type" not in fields:
        fields["discount_type"] = "Chọn loại giảm giá"

    value = data.get("discount_value")
    if value is None:
        fields["discount_value"] = "Nhập mức giảm"
    elif kind == DiscountType.percent and not (1 <= value <= 100):
        fields["discount_value"] = "Phần trăm giảm từ 1 đến 100"
    elif kind == DiscountType.fixed and not (1 <= value <= MAX_MONEY):
        fields["discount_value"] = "Số tiền giảm phải lớn hơn 0"

    cap = data.get("max_discount_amount")
    if cap is not None:
        if kind != DiscountType.percent:
            fields["max_discount_amount"] = "Mức giảm tối đa chỉ dùng cho giảm theo phần trăm"
        else:
            _int_range(fields, "max_discount_amount", cap, low=1, high=MAX_MONEY, msg="Mức giảm tối đa phải lớn hơn 0")

    minimum = data.get("min_order_amount")
    if minimum is None:
        data["min_order_amount"] = minimum = 0
    _int_range(fields, "min_order_amount", minimum, low=0, high=MAX_MONEY, msg="Đơn tối thiểu không hợp lệ")
    if (
        kind == DiscountType.fixed and value is not None and minimum and minimum > 0
        and "discount_value" not in fields and value >= minimum
    ):
        fields["discount_value"] = "Số tiền giảm phải nhỏ hơn giá trị đơn tối thiểu"

    starts, ends = data.get("starts_at"), data.get("ends_at")
    if starts and ends and ends <= starts:
        fields["ends_at"] = "Thời điểm kết thúc phải sau thời điểm bắt đầu"

    _int_range(fields, "usage_limit", data.get("usage_limit"), low=1, high=10_000_000, msg="Tổng lượt dùng phải lớn hơn 0")
    _int_range(fields, "per_buyer_limit", data.get("per_buyer_limit"), low=1, high=1000,
               msg="Lượt dùng mỗi khách từ 1 đến 1000")
    _int_range(fields, "budget_amount", data.get("budget_amount"), low=1, high=MAX_MONEY, msg="Ngân sách phải lớn hơn 0")

    data["category_ids"] = sorted(set(data.get("category_ids") or []))
    data["new_buyers_only"] = bool(data.get("new_buyers_only"))
    data["is_active"] = True if data.get("is_active") is None else bool(data["is_active"])
    kol = data.get("affiliate_account_id")
    if kol is not None and (not isinstance(kol, int) or kol <= 0):
        fields["affiliate_account_id"] = "Chọn tài khoản KOL"

    if fields:
        raise PromotionValidationError(fields)
    return data
