"""Rewrite stored buyer/seller alerts to name orders by code, not by id

Alert text is stored at creation, so notifications written before order codes
existed still say "Đơn #134 … (#111 → #112)" and link to
``?order_id=134&resources=111,112``. Buyers and sellers must never see row
ids, so this pass rewrites the message and href of every buyer/seller alert
that carries them. Admin-facing alerts (target_type order/provider/...) keep
their ids. Data-only; downgrade is a no-op because the original text is not
worth keeping.

Revision ID: du1a2b3c4d5e6
Revises: dt1a2b3c4d5e6
Create Date: 2026-09-16
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "du1a2b3c4d5e6"
down_revision = "dt1a2b3c4d5e6"
branch_labels = None
depends_on = None

_HREF_ORDER = re.compile(r"(?:order_id|order|search)=(?:%23|#)?(\d+)")
_RESOURCE_PREVIEW = re.compile(r"\s*\((?:#\d+[^)]*)\)")
_ORDER_REF = re.compile(r"(Đơn|đơn|Order|order)\s*#(\d+)")


def _rewrite_message(message: str, order_id: int, code: str) -> str:
    message = _RESOURCE_PREVIEW.sub("", message)
    return _ORDER_REF.sub(
        lambda m: f"{m.group(1)} {code}" if int(m.group(2)) == order_id else m.group(0),
        message,
    )


def _rewrite_href(href: str, code: str) -> str:
    path = href.split("?", 1)[0] or "/orders"
    return f"{path}?order={code}"


_PACKAGE_REF = re.compile(r"^Gói #(\d+) ")
_RESOURCE_REF = re.compile(r"^Tài nguyên #(\d+) ")


def _rewrite_inventory_alert(bind, alert_id: int, message: str, href: str | None) -> bool:
    """Low-stock / error incidents named the variant or resource by row id."""
    pkg = _PACKAGE_REF.match(message)
    res = _RESOURCE_REF.match(message)
    if not pkg and not res:
        return False
    if pkg:
        variant_id = int(pkg.group(1))
        suffix = ""
    else:
        variant_id = bind.execute(
            sa.text("SELECT variant_id FROM resources WHERE id = :id"), {"id": int(res.group(1))}
        ).scalar()
        suffix = "?status=error"
    row = bind.execute(sa.text(
        "SELECT v.public_key, v.name, p.title FROM product_variants v "
        "JOIN products p ON p.id = v.product_id WHERE v.id = :id"
    ), {"id": variant_id}).first() if variant_id else None
    if pkg:
        label = f"{row[2]} · {row[1]}" if row else "?"
        new_message = _PACKAGE_REF.sub(f"Gói {label} ", message)
    else:
        new_message = "Một tài nguyên trong kho được báo lỗi bởi nhà bán"
    new_href = f"/seller/inventory/{row[0]}{suffix}" if row else href
    bind.execute(
        sa.text("UPDATE alerts SET message = :message, href = :href WHERE id = :id"),
        {"message": new_message, "href": new_href, "id": alert_id},
    )
    return True


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, message, href FROM alerts "
        "WHERE target_type IN ('buyer', 'seller') "
        "AND (message ~ '#[0-9]+' OR href ~ '(order_id|order|search)=(%23|#)?[0-9]+')"
    )).all()
    for alert_id, message, href in rows:
        if _rewrite_inventory_alert(bind, alert_id, message or "", href):
            continue
        match = _HREF_ORDER.search(href or "")
        order_id = int(match.group(1)) if match else None
        if order_id is None:
            ref = _ORDER_REF.search(message or "")
            order_id = int(ref.group(2)) if ref else None
        if order_id is None:
            continue
        code = bind.execute(
            sa.text("SELECT order_code FROM orders WHERE id = :id"), {"id": order_id}
        ).scalar()
        if not code:
            continue
        new_message = _rewrite_message(message or "", order_id, code)
        new_href = _rewrite_href(href, code) if href and match else href
        if new_message != message or new_href != href:
            bind.execute(
                sa.text("UPDATE alerts SET message = :message, href = :href WHERE id = :id"),
                {"message": new_message, "href": new_href, "id": alert_id},
            )


def downgrade() -> None:
    pass
