"""Per-proxy disputes: the buyer names proxy lines (`#NN`) of a multi-proxy
order, the seller (or Marketplace) refunds exactly those lines, which are
revoked upstream and released; the case then settles like a stock-line claim."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import undefer

from src.database import SessionLocal
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
from src.models.wallet import Transaction, TransactionType
from src.resources.proxy_service import finalize_order_lines

from .conftest import make_admin, make_seller, register_and_login
from .test_proxy_lines import _bulk_order, _creds

TOTAL = 100_000  # three lines → caps 33 334 / 33 333 / 33 333


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class _Revoker:
    """Stands in for the provider adapter: records what was revoked."""

    def __init__(self) -> None:
        self.revoked: list[str] = []

    async def revoke(self, external_id: str) -> bool:
        self.revoked.append(external_id)
        return True


@pytest.fixture
def revoker(monkeypatch):
    fake = _Revoker()

    async def _adapter(provider_id, db):  # noqa: ANN001
        return fake

    monkeypatch.setattr("src.adapters.factory.get_binding_adapter", _adapter)
    return fake


async def _proxy_case(client, suffix: str, *, lines: int = 3, total: int = TOTAL):
    """Admin (account #1, the platform wallet), then a delivered order of
    `lines` proxies with refund caps set, and a seller token for its shop."""
    await register_and_login(client, f"pd_admin{suffix}@example.com")
    await make_admin(f"pd_admin{suffix}@example.com")
    admin = await register_and_login(client, f"pd_admin{suffix}@example.com")
    buyer, order_id, code = await _bulk_order(client, suffix, lines=lines, quantity=lines, total=total)
    seller_email = f"pl_seller{suffix}@example.com"
    await make_seller(seller_email)
    seller = await register_and_login(client, seller_email)
    async with SessionLocal() as db:
        order = await db.get(Order, order_id, options=[undefer(Order.delivered_data)])
        order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(days=2)
        assert await finalize_order_lines(order, db, provision_text=None) == 0
        await db.commit()
    return {"admin": admin, "buyer": buyer, "seller": seller, "order_id": order_id, "code": code}


async def _open(client, case: dict, lines: list[int], key: str = "open-proxy-01"):
    resp = await client.post(
        f"/orders/{case['code']}/dispute",
        json={"reason": "Proxy không kết nối", "proxy_line_nos": lines, "idempotency_key": key},
        headers=_h(case["buyer"]),
    )
    return resp


async def _line(order_id: int, line_no: int) -> ProxyAllocation:
    async with SessionLocal() as db:
        return await db.scalar(select(ProxyAllocation).where(
            ProxyAllocation.order_id == order_id, ProxyAllocation.line_no == line_no,
        ))


async def _refunds(order_id: int) -> list[tuple[str, int]]:
    async with SessionLocal() as db:
        rows = await db.execute(select(Transaction.reference_id, Transaction.amount).where(
            Transaction.type == TransactionType.refund, Transaction.reference_id.like(f"order-{order_id}%"),
        ))
        return [tuple(r) for r in rows.all()]


@pytest.mark.asyncio
async def test_seller_refunds_the_claimed_line_and_buyer_accepts_the_rest(client, revoker):
    case = await _proxy_case(client, "_one")
    opened = await _open(client, case, [2])
    assert opened.status_code == 201, opened.text
    body = opened.json()
    dispute_id = body["id"]
    assert body["claimed_proxy_lines"] == [2] and body["proxy_actions"] == []
    claim = next(e for e in body["timeline"] if e["event_type"] == "claim_batch")
    assert claim["proxy_line_nos"] == [2] and claim["resource_ids"] == []

    # The seller sees every line, the claimed one marked; numbers only, no row ids.
    listed = await client.get(f"/seller/disputes/{dispute_id}/proxies", headers=_h(case["seller"]))
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert [(i["line_no"], i["claimed"], i["remedied"]) for i in items] == [(1, False, False), (2, True, False), (3, False, False)]
    assert items[1]["host"] == "27.73.10.2" and items[1]["port"] == 41002 and items[1]["refund_amount_cap"] == 33_333
    assert set(items[0]) == {"line_no", "host", "port", "status", "claimed", "remedied", "refund_amount_cap", "expires_at"}

    # The buyer's dashboard marks the claimed line.
    dash = (await client.get("/me/proxies?sort=line", headers=_h(case["buyer"]))).json()["items"]
    assert [(i["line_no"], i["dispute_state"]) for i in dash] == [(1, None), (2, "claimed"), (3, None)]

    payload = {"line_nos": [2], "action": "refund", "idempotency_key": "seller-proxy-refund-1", "seller_note": "Đã hoàn #02"}
    acted = await client.post(f"/seller/disputes/{dispute_id}/proxies/action", json=payload, headers=_h(case["seller"]))
    assert acted.status_code == 200, acted.text
    view = acted.json()
    assert view["status"] == "open" and view["refunded_amount"] == 33_333
    assert [(a["line_no"], a["action"], a["refund_amount"]) for a in view["proxy_actions"]] == [(2, "refund", 33_333)]
    assert view["resolution_deadline_at"] is not None  # every claim remedied → buyer's window
    event = next(e for e in view["timeline"] if e["event_type"] == "proxy_refund")
    assert event["line_nos"] == [2] and event["amount"] == 33_333 and event["actor_role"] == "seller"

    assert await _refunds(case["order_id"]) == [(f"order-{case['order_id']}:dispute:{dispute_id}:seller-proxy-refund-1", 33_333)]
    line2 = await _line(case["order_id"], 2)
    assert line2.status == ProxyAllocationStatus.released
    assert revoker.revoked == ["tp_one-2"]
    async with SessionLocal() as db:
        order = await db.get(Order, case["order_id"], options=[undefer(Order.delivered_data)])
    assert order.delivered_data == f"#01\n{_creds(1)}\n\n#03\n{_creds(3)}"
    dash = (await client.get("/me/proxies?sort=line", headers=_h(case["buyer"]))).json()["items"]
    assert [(i["line_no"], i["dispute_state"]) for i in dash] == [(1, None), (2, "refunded"), (3, None)]

    # Idempotent retry: same answer, no second refund, no second revoke.
    again = await client.post(f"/seller/disputes/{dispute_id}/proxies/action", json=payload, headers=_h(case["seller"]))
    assert again.status_code == 200 and again.json()["refunded_amount"] == 33_333
    assert len(await _refunds(case["order_id"])) == 1 and revoker.revoked == ["tp_one-2"]

    # A refunded line cannot be refunded again under a new key.
    twice = await client.post(
        f"/seller/disputes/{dispute_id}/proxies/action",
        json={**payload, "idempotency_key": "seller-proxy-refund-2"}, headers=_h(case["seller"]),
    )
    assert twice.status_code == 409 and twice.json()["error_code"] == "DISPUTE_PROXY_LINE_NOT_REMEDIABLE"

    # A proxy remedy ends the buyer's right to withdraw.
    withdraw = await client.post(f"/orders/{case['code']}/dispute/withdraw", headers=_h(case["buyer"]))
    assert withdraw.status_code == 409 and withdraw.json()["error_code"] == "DISPUTE_WITHDRAWAL_NOT_ALLOWED"

    accepted = await client.post(f"/orders/{case['code']}/dispute/accept", headers=_h(case["buyer"]))
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == DisputeStatus.resolved_partial_refund.value
    # System lines are coded so every viewer reads them in their own words.
    closing = accepted.json()["timeline"][-1]
    assert closing["body"] == "Buyer accepted the applied resolution."
    assert closing["message_code"] == "buyer_accepted"
    assert closing["message_params"] == {"actor": "buyer", "scope": "proxy"}
    async with SessionLocal() as db:
        order = await db.get(Order, case["order_id"])
        released = await db.scalar(select(Transaction.amount).where(
            Transaction.type == TransactionType.purchase_release, Transaction.reference_id == f"order-{case['order_id']}",
        ))
        fee = await db.scalar(select(Transaction.amount).where(
            Transaction.type == TransactionType.platform_fee, Transaction.reference_id == f"order-{case['order_id']}",
        )) or 0
    assert order.status == OrderStatus.completed
    assert released + fee == TOTAL - 33_333
    # Lines 1 and 3 stay with the buyer.
    assert (await _line(case["order_id"], 1)).status == ProxyAllocationStatus.allocated


@pytest.mark.asyncio
async def test_refunding_every_line_closes_the_case_as_a_full_refund(client, revoker):
    case = await _proxy_case(client, "_all")
    dispute_id = (await _open(client, case, [1, 2, 3])).json()["id"]
    resp = await client.post(
        f"/seller/disputes/{dispute_id}/proxies/action",
        json={"line_nos": [1, 2, 3], "action": "refund", "idempotency_key": "seller-refund-all"},
        headers=_h(case["seller"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == DisputeStatus.resolved_refund.value
    closing = next(e for e in resp.json()["timeline"] if e.get("message_code"))
    assert closing["message_code"] == "full_refund"
    assert closing["message_params"] == {"actor": "seller", "scope": "proxy", "amount": TOTAL}
    async with SessionLocal() as db:
        order = await db.get(Order, case["order_id"], options=[undefer(Order.delivered_data)])
    assert order.status == OrderStatus.refunded and order.refunded_amount == TOTAL
    assert order.delivered_data is None
    assert sorted(revoker.revoked) == ["tp_all-1", "tp_all-2", "tp_all-3"]


@pytest.mark.asyncio
async def test_claims_must_name_live_unclaimed_lines_of_this_order(client, revoker):
    case = await _proxy_case(client, "_bad")
    # A line the order does not have (e.g. #04 of another, larger order).
    missing = await _open(client, case, [4])
    assert missing.status_code == 400 and missing.json()["error_code"] == "DISPUTE_PROXY_LINE_NOT_CLAIMABLE"
    # A released line cannot be claimed.
    async with SessionLocal() as db:
        line3 = await db.scalar(select(ProxyAllocation).where(
            ProxyAllocation.order_id == case["order_id"], ProxyAllocation.line_no == 3,
        ))
        line3.status = ProxyAllocationStatus.released
        await db.commit()
    released = await _open(client, case, [3])
    assert released.status_code == 400 and released.json()["error_code"] == "DISPUTE_PROXY_LINE_NOT_CLAIMABLE"
    async with SessionLocal() as db:
        assert await db.scalar(select(Dispute.id).where(Dispute.order_id == case["order_id"])) is None

    opened = await _open(client, case, [1])
    assert opened.status_code == 201, opened.text
    # Retrying the opening batch returns the same case.
    retried = await _open(client, case, [1])
    assert retried.status_code == 201 and retried.json()["id"] == opened.json()["id"]
    order = (await client.get(f"/orders/{case['code']}", headers=_h(case["buyer"]))).json()
    assert order["capabilities"]["can_append_claims"] is True

    dup = await client.post(
        f"/orders/{case['code']}/dispute/claims",
        json={"proxy_line_nos": [1], "reason": "Vẫn lỗi", "idempotency_key": "append-dup-01"},
        headers=_h(case["buyer"]),
    )
    assert dup.status_code == 409 and dup.json()["error_code"] == "DISPUTE_PROXY_LINE_NOT_CLAIMABLE"

    # Append another line: idempotent on its key, and the buyer's window reopens.
    appended = await client.post(
        f"/orders/{case['code']}/dispute/claims",
        json={"proxy_line_nos": [2], "reason": "#02 cũng chết", "idempotency_key": "append-line2-01"},
        headers=_h(case["buyer"]),
    )
    assert appended.status_code == 200, appended.text
    assert appended.json()["claimed_proxy_lines"] == [1, 2]
    again = await client.post(
        f"/orders/{case['code']}/dispute/claims",
        json={"proxy_line_nos": [2], "reason": "#02 cũng chết", "idempotency_key": "append-line2-01"},
        headers=_h(case["buyer"]),
    )
    assert again.status_code == 200 and again.json()["claimed_proxy_lines"] == [1, 2]
    batches = [e for e in again.json()["timeline"] if e["event_type"] == "claim_batch"]
    assert [b["proxy_line_nos"] for b in batches] == [[1], [2]]
    # Line 3 is released, 1 and 2 are claimed: nothing left to append.
    order = (await client.get(f"/orders/{case['code']}", headers=_h(case["buyer"]))).json()
    assert order["capabilities"]["can_append_claims"] is False

    # An empty batch is refused by the contract.
    empty = await client.post(
        f"/orders/{case['code']}/dispute/claims",
        json={"reason": "x", "idempotency_key": "append-empty-01"}, headers=_h(case["buyer"]),
    )
    assert empty.status_code == 422


@pytest.mark.asyncio
async def test_seller_may_refund_only_claimed_lines_of_their_own_case(client, revoker):
    case = await _proxy_case(client, "_own")
    dispute_id = (await _open(client, case, [2])).json()["id"]
    body = {"line_nos": [2], "action": "refund", "idempotency_key": "other-seller-01"}

    other_email = "pd_other_seller@example.com"
    await register_and_login(client, other_email)
    await make_seller(other_email)
    other = await register_and_login(client, other_email)
    assert (await client.get(f"/seller/disputes/{dispute_id}/proxies", headers=_h(other))).status_code == 404
    denied = await client.post(f"/seller/disputes/{dispute_id}/proxies/action", json=body, headers=_h(other))
    assert denied.status_code == 404
    # The buyer is not a seller at all.
    assert (await client.post(
        f"/seller/disputes/{dispute_id}/proxies/action", json=body, headers=_h(case["buyer"]),
    )).status_code == 403

    unclaimed = await client.post(
        f"/seller/disputes/{dispute_id}/proxies/action",
        json={**body, "line_nos": [1], "idempotency_key": "own-unclaimed-01"}, headers=_h(case["seller"]),
    )
    assert unclaimed.status_code == 409 and unclaimed.json()["error_code"] == "DISPUTE_PROXY_LINE_NOT_REMEDIABLE"
    assert await _refunds(case["order_id"]) == [] and revoker.revoked == []


@pytest.mark.asyncio
async def test_admin_refunds_an_unclaimed_line_and_the_case_file_lists_proxy_lines(client, revoker):
    case = await _proxy_case(client, "_adm")
    dispute_id = (await _open(client, case, [1])).json()["id"]
    resp = await client.post(
        f"/admin/disputes/{dispute_id}/proxies/refund",
        json={"line_nos": [3], "action": "refund", "idempotency_key": "admin-proxy-03", "seller_note": "Sàn hoàn #03"},
        headers=_h(case["admin"]),
    )
    assert resp.status_code == 200, resp.text
    view = resp.json()
    assert view["status"] == "open" and view["refunded_amount"] == 33_333
    assert view["proxy_actions"][0]["line_no"] == 3 and view["proxy_actions"][0]["actor_role"] == "admin"
    # Line 1 is still claimed and unremedied: no buyer window yet.
    assert view["resolution_deadline_at"] is None
    assert revoker.revoked == ["tp_adm-3"]
    # Seller and buyer cannot use the admin route.
    assert (await client.post(
        f"/admin/disputes/{dispute_id}/proxies/refund",
        json={"line_nos": [2], "action": "refund", "idempotency_key": "seller-on-admin"}, headers=_h(case["seller"]),
    )).status_code == 403

    file = (await client.get(f"/admin/disputes/{dispute_id}/case", headers=_h(case["admin"]))).json()
    proxy_rows = [(r["line"], r["kind"], r["claimed"], r["refunded"], r["state"]) for r in file["lines"] if r["kind"] == "proxy"]
    assert proxy_rows == [
        ("#01", "proxy", True, False, "claimed"),
        ("#02", "proxy", False, False, "ok"),
        ("#03", "proxy", False, True, "refunded"),
    ]
    assert all(r["id"] is None for r in file["lines"] if r["kind"] == "proxy")
    assert [(r["line_no"], r["refund_amount_cap"]) for r in file["lines"] if r["kind"] == "proxy"] == [
        (1, 33_334), (2, 33_333), (3, 33_333),
    ]

    order_file = (await client.get(f"/admin/orders/{case['order_id']}/case", headers=_h(case["admin"]))).json()
    assert [
        (r["line"], r["line_no"], r["claimed"], r["refunded"], r["refund_amount_cap"])
        for r in order_file["lines"] if r["kind"] == "proxy"
    ] == [("#01", 1, True, False, 33_334), ("#02", 2, False, False, 33_333), ("#03", 3, False, True, 33_333)]


@pytest.mark.asyncio
async def test_case_shows_only_what_this_dispute_refunded(client, revoker):
    """A refund booked before the case (a short delivery) stays on the order's
    total but is not counted as refunded by the dispute."""
    from src.wallet.service import refund_escrow

    case = await _proxy_case(client, "_scope")
    async with SessionLocal() as db:
        order = await db.get(Order, case["order_id"])
        await refund_escrow(order.id, order.buyer_id, 5_000, db, reference_suffix=":short-delivery")
        await db.commit()
    opened = (await _open(client, case, [2])).json()
    assert (opened["refunded_amount"], opened["dispute_refunded_amount"]) == (5_000, 0)

    resp = await client.post(
        f"/seller/disputes/{opened['id']}/proxies/action",
        json={"line_nos": [2], "action": "refund", "idempotency_key": "seller-scope-refund"},
        headers=_h(case["seller"]),
    )
    assert resp.status_code == 200, resp.text
    assert (resp.json()["refunded_amount"], resp.json()["dispute_refunded_amount"]) == (5_000 + 33_333, 33_333)
    buyer_view = (await client.get(f"/orders/{case['code']}/dispute", headers=_h(case["buyer"]))).json()
    assert buyer_view["dispute_refunded_amount"] == 33_333
