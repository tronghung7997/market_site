from datetime import datetime

from pydantic import BaseModel, Field


class LedgerFinding(BaseModel):
    kind: str
    target_type: str
    target_id: int
    expected: int
    actual: int
    delta: int
    detail: str = ""


class LedgerRunResponse(BaseModel):
    id: int
    ran_at: datetime
    duration_ms: int
    trigger: str
    ok: bool
    wallets_checked: int
    orders_checked: int
    mismatch_count: int
    totals: dict
    findings: list[LedgerFinding]

    model_config = {"from_attributes": True}


# ── Money journal (ledger.journal) ──────────────────────────────────────────

class JournalEntry(BaseModel):
    id: int
    created_at: datetime
    type: str
    direction: str
    amount: int
    description: str | None = None
    account_id: int
    account_email: str
    account_role: str
    group: str | None = None
    group_label: str | None = None
    balance_after: int | None = None
    actor: str
    proof_count: int = 0


class JournalPage(BaseModel):
    items: list[JournalEntry]
    next_cursor: str | None = None


class JournalTypeTotal(BaseModel):
    count: int
    amount: int


class JournalReconcile(BaseModel):
    ran_at: datetime
    ok: bool
    mismatch_count: int


class JournalSummary(BaseModel):
    by_type: dict[str, JournalTypeTotal]
    filtered_in: int
    filtered_out: int
    filtered_count: int
    money_in: int
    money_out: int
    platform_revenue: int
    user_available: int
    platform_available: int
    locked: int
    escrow_open_orders: int
    escrow_open_amount: int
    pending_withdrawals: int
    last_reconcile: JournalReconcile | None = None


class JournalStatement(BaseModel):
    account_id: int
    email: str
    role: str
    opening: int
    money_in: int
    money_out: int
    closing: int
    count: int
    available_now: int
    locked_now: int
    matches_wallet: bool | None = None
    escrow_open_orders: int
    escrow_open_amount: int


class JournalGroupEntry(BaseModel):
    id: int
    created_at: datetime
    type: str
    direction: str
    amount: int
    description: str | None = None
    account_id: int
    account_email: str
    account_role: str
    actor: str
    proof_images: list[dict] = []


class JournalGroup(BaseModel):
    header: dict
    entries: list[JournalGroupEntry]


class JournalSearchFilter(BaseModel):
    account_id: int | None = None
    group: str | None = None
    amount: int | None = None
    entry_id: int | None = None


class JournalSuggestion(BaseModel):
    kind: str
    label: str
    detail: str | None = None
    filter: JournalSearchFilter


# ── Period finance report & close (ledger.report) ──────────────────────────

class ReportFlows(BaseModel):
    gmv: int
    orders: int
    revenue: int
    order_fee: int
    withdraw_fee: int
    costs: int
    promo_subsidy: int
    affiliate_net: int
    manual_net: int
    net: int
    refunds: int
    refund_count: int
    disputes_opened: int
    deposits: int
    deposit_count: int
    demo_topups: int
    seed_writeoffs: int = 0
    withdrawn: int
    withdraw_count: int


class ReportBalance(BaseModel):
    opening: int
    deposits: int
    injected: int
    withdrawn: int
    removed: int
    closing: int
    buyer_wallets: int
    seller_wallets: int
    platform_wallet: int
    locked: int
    escrow: int
    parts_total: int
    stored_total: int | None = None
    delta: int
    matches: bool


class ReportChannel(BaseModel):
    provider: str
    count: int
    amount: int


class ReportChannels(BaseModel):
    providers: list[ReportChannel]
    unmatched_count: int
    unmatched_amount: int


class ReportSeller(BaseModel):
    account_id: int
    email: str
    received: int
    fee: int
    orders: int


class ReportProgram(BaseModel):
    kind: str
    label: str
    count: int
    amount: int


class PeriodCloseDrift(BaseModel):
    net_delta: int
    late_rows: int
    late_amount: int


class PeriodCloseRow(BaseModel):
    id: int
    label: str
    period_start: datetime
    period_end: datetime
    closed_at: datetime
    closed_by: str | None = None
    note: str | None = None
    net: int | None = None
    closing: int | None = None
    drift: PeriodCloseDrift | None = None


class FinanceReport(BaseModel):
    start: datetime
    end: datetime
    compare_start: datetime
    compare_end: datetime
    current: ReportFlows
    previous: ReportFlows
    balance: ReportBalance
    channels: ReportChannels
    top_sellers: list[ReportSeller]
    programs: list[ReportProgram]
    closed: PeriodCloseRow | None = None


class CountAmount(BaseModel):
    count: int
    amount: int


class ChecklistReconcile(BaseModel):
    ran_at: datetime
    ok: bool
    mismatch_count: int
    after_period: bool


class ManualAdjustments(BaseModel):
    count: int
    without_proof: int


class CloseChecklist(BaseModel):
    reconcile: ChecklistReconcile | None = None
    pending_deposits: CountAmount
    unmatched_deposits: CountAmount
    pending_withdrawals: CountAmount
    manual_adjustments: ManualAdjustments
    period_ended: bool
    overlaps: PeriodCloseRow | None = None
    can_close: bool


class ClosePeriodRequest(BaseModel):
    start: datetime
    end: datetime
    note: str | None = Field(None, max_length=500)
