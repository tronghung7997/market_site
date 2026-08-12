from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class DepositCreateRequest(BaseModel):
    """amount is always target VND integer (ledger). method defaults to payos."""

    amount: int
    method: Literal["payos", "nowpayments"] = "payos"
    pay_currency: str | None = None


class DepositResponse(BaseModel):
    id: int
    amount: int
    status: str
    provider: str = "payos"
    # PayOS
    checkout_url: str | None = None
    qr_code: str | None = None
    payment_link_id: str | None = None
    # NOWPayments
    now_invoice_id: str | None = None
    pay_currency: str | None = None
    pay_address: str | None = None
    pay_amount: Decimal | None = None
    now_payment_id: str | None = None
    quoted_usd_amount: Decimal | None = None
    vnd_per_usd_snapshot: int | None = None
    price_currency: str | None = None
    paid_crypto_amount: Decimal | None = None
    paid_amount: int | None = None
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None = None

    model_config = {"from_attributes": True}


class AdminDepositResponse(DepositResponse):
    account_id: int
    account_email: str | None = None
    payos_reference: str | None = None
    external_reference: str | None = None
    outcome_amount: Decimal | None = None
    outcome_currency: str | None = None


class DepositMethodsResponse(BaseModel):
    """FE uses this to show/hide rails without guessing env.
    Flags are effective (admin toggle AND secrets present)."""

    payos_enabled: bool
    nowpayments_enabled: bool
    nowpayments_default_pay_currency: str = "usdtbsc"
    nowpayments_allowed_pay_currencies: list[str] = Field(default_factory=lambda: ["usdtbsc"])
    deposit_min_amount: int
    deposit_max_amount: int
    deposit_usdt_min_vnd: int
    deposit_usdt_max_vnd: int


class DepositRailConfigAdmin(BaseModel):
    payos_enabled: bool
    nowpayments_enabled: bool
    deposit_min_amount: int
    deposit_max_amount: int
    deposit_expire_minutes: int
    deposit_reconcile_retention_hours: int
    deposit_usdt_min_vnd: int
    deposit_usdt_max_vnd: int
    deposit_usdt_local_window_minutes: int
    deposit_usdt_reconcile_retention_hours: int
    nowpayments_default_pay_currency: str
    nowpayments_allowed_pay_currencies: str
    payos_secrets_configured: bool
    nowpayments_secrets_configured: bool
    nowpayments_reconciliation_configured: bool
    effective_payos_enabled: bool
    effective_nowpayments_enabled: bool
    env_seed: dict
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    source: str = "db"


class DepositRailConfigUpdate(BaseModel):
    """Partial update — at least one field required (validated in service)."""

    payos_enabled: bool | None = None
    nowpayments_enabled: bool | None = None
    deposit_min_amount: int | None = None
    deposit_max_amount: int | None = None
    deposit_expire_minutes: int | None = None
    deposit_reconcile_retention_hours: int | None = None
    deposit_usdt_min_vnd: int | None = None
    deposit_usdt_max_vnd: int | None = None
    deposit_usdt_local_window_minutes: int | None = None
    deposit_usdt_reconcile_retention_hours: int | None = None
    nowpayments_default_pay_currency: str | None = None
    nowpayments_allowed_pay_currencies: str | None = None
