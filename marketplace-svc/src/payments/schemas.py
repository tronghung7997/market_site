from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class DepositCreateRequest(BaseModel):
    """amount is always target VND integer (ledger). method defaults to SePay."""

    amount: int = Field(ge=1)
    method: Literal["sepay", "nowpayments"] = "sepay"
    pay_currency: str | None = Field(default=None, max_length=16)


class DepositResponse(BaseModel):
    id: int
    amount: int
    status: str
    provider: str = "sepay"
    # SePay bank transfer
    payment_code: str | None = None
    bank_code: str | None = None
    bank_account_number: str | None = None
    bank_account_name: str | None = None
    sepay_transaction_id: str | None = None
    sepay_reference: str | None = None
    # Shared/legacy hosted payment fields
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


class AdminDepositTransactionRow(BaseModel):
    """Provider-neutral transaction row for the admin reconciliation view."""

    id: str
    provider: str
    provider_transaction_id: str
    provider_status: str
    reference: str | None = None
    expected_amount: Decimal | None = None
    actual_amount: Decimal | None = None
    delta_amount: Decimal | None = None
    currency: str
    settled_amount: Decimal | None = None
    settled_currency: str | None = None
    match_status: Literal["exact", "underpaid", "overpaid", "unknown"]
    credit_status: Literal["credited", "held", "not_credited"]
    direction: Literal["in", "out"] | None = None
    source: str
    received_at: datetime
    destination: str | None = None
    event_count: int = 1
    raw: dict


class AdminDepositLedgerIntent(BaseModel):
    id: int
    account_id: int
    account_email: str | None = None
    amount: int
    paid_amount: int | None = None
    status: str
    provider: str
    payment_code: str | None = None
    now_payment_id: str | None = None
    created_at: datetime
    paid_at: datetime | None = None


class AdminDepositLedgerEntry(BaseModel):
    deposit: AdminDepositLedgerIntent
    transactions: list[AdminDepositTransactionRow]


class AdminDepositLedgerResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[AdminDepositLedgerEntry]


class DepositReconcileResponse(BaseModel):
    """Admin reconciliation result.

    ``status`` is the local deposit state. ``provider_status`` is the status
    returned by the payment provider, when a provider request was made.
    """

    id: int
    status: str
    provider_status: str | None = None
    reconcile_result: Literal[
        "already_paid",
        "checked",
        "credited",
        "not_configured",
        "not_found",
        "provider_error",
        "validation_failed",
    ]


class DepositMethodsResponse(BaseModel):
    """FE uses this to show/hide rails without guessing env.
    Flags are effective (admin toggle AND secrets present)."""

    sepay_enabled: bool
    nowpayments_enabled: bool
    deposit_min_amount: int
    deposit_max_amount: int
    deposit_usdt_min_vnd: int
    deposit_usdt_max_vnd: int


class DepositRailConfigAdmin(BaseModel):
    sepay_enabled: bool
    nowpayments_enabled: bool
    sepay_bank_code: str
    sepay_bank_account_number: str
    sepay_bank_account_name: str
    sepay_bank_account_id: str
    deposit_min_amount: int
    deposit_max_amount: int
    deposit_expire_minutes: int
    deposit_reconcile_retention_hours: int
    deposit_usdt_min_vnd: int
    deposit_usdt_max_vnd: int
    deposit_usdt_local_window_minutes: int
    deposit_usdt_reconcile_retention_hours: int
    sepay_secrets_configured: bool
    sepay_reconciliation_configured: bool
    nowpayments_secrets_configured: bool
    nowpayments_reconciliation_configured: bool
    effective_sepay_enabled: bool
    effective_nowpayments_enabled: bool
    env_seed: dict
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    source: str = "db"


class DepositRailConfigUpdate(BaseModel):
    """Partial update — at least one field required (validated in service)."""

    sepay_enabled: bool | None = None
    nowpayments_enabled: bool | None = None
    sepay_bank_code: str | None = None
    sepay_bank_account_number: str | None = None
    sepay_bank_account_name: str | None = None
    sepay_bank_account_id: str | None = None
    deposit_min_amount: int | None = None
    deposit_max_amount: int | None = None
    deposit_expire_minutes: int | None = None
    deposit_reconcile_retention_hours: int | None = None
    deposit_usdt_min_vnd: int | None = None
    deposit_usdt_max_vnd: int | None = None
    deposit_usdt_local_window_minutes: int | None = None
    deposit_usdt_reconcile_retention_hours: int | None = None
