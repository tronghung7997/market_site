"""Transport contracts of the public sales API and of buyer key management."""
import ipaddress
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

SCOPES = ("orders:read", "orders:write")
DEFAULT_DAILY_SPEND_LIMIT = 1_000_000  # VND
MAX_ALLOWED_IPS = 20


def _clean_ips(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    out: list[str] = []
    for raw in value:
        entry = (raw or "").strip()
        if not entry:
            continue
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError as exc:
            raise ValueError(f"not an IP address or CIDR: {entry[:64]}") from exc
        text = str(network.network_address) if network.num_addresses == 1 else str(network)
        if text not in out:
            out.append(text)
    if len(out) > MAX_ALLOWED_IPS:
        raise ValueError(f"at most {MAX_ALLOWED_IPS} entries")
    return out or None


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[str] = Field(default_factory=lambda: list(SCOPES), min_length=1)
    allowed_ips: list[str] | None = None
    daily_spend_limit: int | None = Field(default=DEFAULT_DAILY_SPEND_LIMIT, ge=0, le=2_000_000_000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name is required")
        return value

    @field_validator("scopes")
    @classmethod
    def known_scopes(cls, value: list[str]) -> list[str]:
        unknown = [s for s in value if s not in SCOPES]
        if unknown:
            raise ValueError("unknown scope")
        return [s for s in SCOPES if s in value]

    @field_validator("allowed_ips")
    @classmethod
    def valid_ips(cls, value: list[str] | None) -> list[str] | None:
        return _clean_ips(value)


class ApiKeyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    allowed_ips: list[str] | None = None
    daily_spend_limit: int | None = Field(default=None, ge=0, le=2_000_000_000)

    @field_validator("allowed_ips")
    @classmethod
    def valid_ips(cls, value: list[str] | None) -> list[str] | None:
        return _clean_ips(value)


class ApiKeyRow(BaseModel):
    id: int
    name: str
    prefix: str
    scopes: list[str]
    allowed_ips: list[str] | None
    daily_spend_limit: int | None
    spent_today: int = 0
    last_used_at: datetime | None
    last_used_ip: str | None
    revoked_at: datetime | None
    created_at: datetime


class ApiKeyCreated(ApiKeyRow):
    # Shown once; only its sha256 is stored.
    key: str


class ApiKeyList(BaseModel):
    enabled: bool
    email_verified: bool
    max_active: int
    items: list[ApiKeyRow]


# ── /v1 ──

class V1OrderCreate(BaseModel):
    variant: str = Field(min_length=1, max_length=64)
    quantity: int


class V1Me(BaseModel):
    balance: int
    currency: str
    daily_spend_limit: int | None
    spent_today: int


class V1Variant(BaseModel):
    id: str
    name: str
    price: int
    min_quantity: int
    max_quantity: int
    in_stock: bool
    available: int | None = None


class V1Product(BaseModel):
    product: str
    title: str
    variants: list[V1Variant]


class V1ProductList(BaseModel):
    currency: str
    items: list[V1Product]


class V1OrderItem(BaseModel):
    line: int
    data: str


class V1Order(BaseModel):
    order: str
    status: str
    product: str | None
    variant: str | None
    quantity: int
    delivered_quantity: int
    total: int
    refunded_amount: int
    currency: str
    created_at: datetime
    items: list[V1OrderItem] | None = None
    items_truncated: bool | None = None


class V1OrderList(BaseModel):
    items: list[V1Order]
    next_cursor: str | None
