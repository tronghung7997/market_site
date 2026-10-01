from datetime import datetime

from pydantic import BaseModel


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
