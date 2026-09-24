"""Admin entity references: (kind, id) → readable label + admin deep link.

Alerts, audit logs and dispute cases store bare ids (order 42, account 7,
provider 3…). Operators need "ORD-7K2M…", "Kho 247 · kho247@…", and a link
that opens that record. Callers collect every (kind, id) they need, load them
in one batch per table, then ask for refs.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.order import Dispute, DisputeStatus, Order
from src.models.payment import DepositIntent
from src.models.product import Product, ProductVariant
from src.models.provider import Provider
from src.models.resource import Resource
from src.models.wallet import Wallet, WithdrawRequest

KINDS = ("order", "dispute", "account", "provider", "product", "variant", "resource", "deposit", "withdrawal", "wallet")

ORDER_STATUS_VI = {
    "pending": "chờ xử lý", "processing": "đang xử lý", "delivered": "đã giao · ký quỹ", "completed": "hoàn tất",
    "disputed": "khiếu nại", "refunded": "đã hoàn tiền", "cancelled": "đã huỷ",
}


def vnd(amount: int | None) -> str:
    return f"{(amount or 0):,} ₫".replace(",", ".")


@dataclass
class Ref:
    kind: str
    id: int
    label: str
    detail: str | None = None
    href: str | None = None
    role: str | None = None

    def as_dict(self) -> dict:
        return {"kind": self.kind, "id": self.id, "label": self.label, "detail": self.detail, "href": self.href, "role": self.role}


class EntityIndex:
    def __init__(self) -> None:
        self.orders: dict[int, Order] = {}
        self.disputes: dict[int, Dispute] = {}
        self.order_dispute: dict[int, Dispute] = {}
        self.accounts: dict[int, Account] = {}
        self.providers: dict[int, Provider] = {}
        self.products: dict[int, Product] = {}
        self.variants: dict[int, tuple[ProductVariant, Product]] = {}
        self.resources: dict[int, Resource] = {}
        self.deposits: dict[int, DepositIntent] = {}
        self.withdrawals: dict[int, WithdrawRequest] = {}
        self.wallets: dict[int, int] = {}

    async def load(self, db: AsyncSession, pairs: Iterable[tuple[str, int]]) -> "EntityIndex":
        want: dict[str, set[int]] = {k: set() for k in KINDS}
        for kind, ident in pairs:
            if kind in want and isinstance(ident, int) and ident > 0:
                want[kind].add(ident)

        async def fetch(model, ids):
            if not ids:
                return {}
            return {r.id: r for r in (await db.execute(select(model).where(model.id.in_(ids)))).scalars()}

        if want["wallet"]:
            self.wallets = {w.id: w.account_id for w in (await fetch(Wallet, want["wallet"])).values()}
            want["account"] |= set(self.wallets.values())
        self.disputes = await fetch(Dispute, want["dispute"])
        want["order"] |= {d.order_id for d in self.disputes.values()}
        self.resources = await fetch(Resource, want["resource"])
        want["variant"] |= {r.variant_id for r in self.resources.values()}
        self.withdrawals = await fetch(WithdrawRequest, want["withdrawal"])
        want["account"] |= {w.account_id for w in self.withdrawals.values()}
        self.deposits = await fetch(DepositIntent, want["deposit"])
        want["account"] |= {d.account_id for d in self.deposits.values()}
        self.orders = await fetch(Order, want["order"])
        want["account"] |= {o.seller_id for o in self.orders.values()} | {o.buyer_id for o in self.orders.values()}
        self.providers = await fetch(Provider, want["provider"])
        if want["variant"]:
            self.variants = {
                v.id: (v, p) for v, p in (await db.execute(
                    select(ProductVariant, Product).join(Product, Product.id == ProductVariant.product_id)
                    .where(ProductVariant.id.in_(want["variant"]))
                )).all()
            }
        self.products = await fetch(Product, want["product"] | {p.id for _, p in self.variants.values()})
        self.accounts = await fetch(Account, want["account"])
        if self.orders:
            # Latest case per order; an open one wins.
            for d in (await db.execute(select(Dispute).where(Dispute.order_id.in_(self.orders)).order_by(Dispute.id))).scalars():
                cur = self.order_dispute.get(d.order_id)
                if cur is None or d.status == DisputeStatus.open or cur.status != DisputeStatus.open:
                    self.order_dispute[d.order_id] = d
        return self

    # ── refs ────────────────────────────────────────────────────────────────

    def account(self, aid: int, role: str | None = None) -> Ref:
        a = self.accounts.get(aid)
        href = f"/admin/accounts?account={aid}"
        if a is None:
            return Ref("account", aid, f"Tài khoản #{aid}", None, href, role)
        tags = [t for t in ("nội bộ" if a.is_internal else None, "đã khoá" if not a.is_active else None) if t]
        return Ref("account", aid, a.display_name or a.email.split("@")[0], " · ".join([a.email, *tags]), href, role)

    def order(self, oid: int, role: str | None = None) -> Ref:
        o = self.orders.get(oid)
        if o is None:
            return Ref("order", oid, f"Đơn #{oid}", "không còn tồn tại", None, role)
        detail = f"{ORDER_STATUS_VI.get(o.status.value, o.status.value)} · {vnd(o.total_amount)}"
        return Ref("order", oid, o.order_code, detail, f"/admin/orders/{oid}", role)

    def dispute(self, did: int, role: str | None = None) -> Ref:
        d = self.disputes.get(did)
        o = self.orders.get(d.order_id) if d else None
        # The chip already says "Khiếu nại"; the label is the order it is about.
        label = o.order_code if o else f"#{did}"
        detail = ("đang mở" if d.status == DisputeStatus.open else "đã đóng") if d else None
        return Ref("dispute", did, label, detail, f"/admin/disputes/{did}", role)

    def dispute_of_order(self, oid: int) -> Ref | None:
        d = self.order_dispute.get(oid)
        if d is None:
            return None
        self.disputes.setdefault(d.id, d)
        return self.dispute(d.id)

    def provider(self, pid: int, role: str | None = None) -> Ref:
        p = self.providers.get(pid)
        return Ref("provider", pid, p.name if p else f"Nguồn #{pid}",
                   ("đang bật" if p.is_active else "đang tắt") if p else None, f"/admin/providers?provider={pid}", role)

    def product(self, pid: int, role: str | None = None, variant: str | None = None) -> Ref:
        p = self.products.get(pid)
        return Ref("product", pid, p.title if p else f"Sản phẩm #{pid}", variant, f"/admin/products/{pid}?tab=operations", role)

    def variant(self, vid: int, role: str | None = None) -> Ref:
        vp = self.variants.get(vid)
        if vp is None:
            return Ref("variant", vid, f"Biến thể #{vid}", None, None, role)
        v, p = vp
        return self.product(p.id, role, v.name)

    def resource(self, rid: int, role: str | None = None) -> Ref:
        r = self.resources.get(rid)
        return Ref("resource", rid, f"Tài nguyên #{rid}", r.status.value if r else None, f"/admin/resources?q={rid}", role)

    def deposit(self, did: int, role: str | None = None) -> Ref:
        d = self.deposits.get(did)
        code = (d.payment_code or f"#{did}") if d else f"#{did}"
        detail = f"{vnd(d.amount)} · {d.status.value}" if d else None
        return Ref("deposit", did, f"Lệnh nạp {code}", detail, f"/admin/deposits?q={code.lstrip('#')}", role)

    def withdrawal(self, wid: int, role: str | None = None) -> Ref:
        w = self.withdrawals.get(wid)
        detail = f"{vnd(w.amount)} · {w.status.value}" if w else None
        return Ref("withdrawal", wid, f"Lệnh rút #{wid}", detail, f"/admin/withdrawals?highlight={wid}", role)

    def wallet(self, wid: int, role: str | None = None) -> Ref | None:
        aid = self.wallets.get(wid)
        return self.account(aid, role or "ví") if aid else None

    def ref(self, kind: str, ident: int, role: str | None = None) -> Ref | None:
        fn = {
            "order": self.order, "dispute": self.dispute, "account": self.account, "provider": self.provider,
            "product": self.product, "variant": self.variant, "resource": self.resource, "deposit": self.deposit,
            "withdrawal": self.withdrawal, "wallet": self.wallet,
        }.get(kind)
        return fn(ident, role) if fn else None


def unique(refs: Iterable[Ref | None]) -> list[Ref]:
    seen: set[tuple[str, int]] = set()
    out: list[Ref] = []
    for r in refs:
        if r is not None and (r.kind, r.id) not in seen:
            seen.add((r.kind, r.id))
            out.append(r)
    return out
