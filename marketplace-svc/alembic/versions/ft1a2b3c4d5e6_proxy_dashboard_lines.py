"""Buyer proxy dashboard: line classification snapshot, notes and tags

Revision ID: ft1a2b3c4d5e6
Revises: fs1a2b3c4d5e6
Create Date: 2026-09-23

- proxy_allocations: ip_type / rotation_kind / protocol / network_label /
  country / plan_days / plan_label, frozen at delivery (src/proxies/kinds.py),
  and the buyer's note.
- proxy_tags + proxy_allocation_tags: buyer-owned tags for /proxies.
Existing rows are backfilled with the same classifier used at delivery
(src/proxies/kinds.py) from each order's selection, its product labels and
the provider's mode, so dashboard filters work on old lines too.
"""
import json
from alembic import op
import sqlalchemy as sa

from src.proxies.kinds import classify

revision = "ft1a2b3c4d5e6"
down_revision = "fs1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, type_ in (
        ("ip_type", sa.String(16)), ("rotation_kind", sa.String(16)), ("protocol", sa.String(8)),
        ("network_label", sa.String(80)), ("country", sa.String(8)), ("plan_days", sa.Integer()),
        ("plan_label", sa.String(160)),
    ):
        op.add_column("proxy_allocations", sa.Column(name, type_, nullable=True))
    op.add_column("proxy_allocations", sa.Column("note", sa.String(200), nullable=False, server_default=""))
    _backfill()

    op.create_table(
        "proxy_tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_key", sa.String(12), nullable=False, unique=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("tone", sa.String(12), nullable=False, server_default="neutral"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("account_id", "name", name="uq_proxy_tags_account_name"),
    )
    op.create_index("ix_proxy_tags_account_id", "proxy_tags", ["account_id"])
    op.create_table(
        "proxy_allocation_tags",
        sa.Column("allocation_id", sa.Integer(), sa.ForeignKey("proxy_allocations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("proxy_tags.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_proxy_allocation_tags_tag_id", "proxy_allocation_tags", ["tag_id"])


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            return json.loads(value)
        except ValueError:
            return {}
    return {}


def _backfill() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT a.id, pr.adapter_type, pr.config, o.user_config, p.pricing_params "
        "FROM proxy_allocations a JOIN orders o ON o.id = a.order_id "
        "LEFT JOIN products p ON p.id = o.product_id LEFT JOIN providers pr ON pr.id = a.provider_id"
    )).all()
    for allocation_id, adapter_type, provider_config, user_config, pricing_params in rows:
        kind = classify(adapter_type, _as_dict(user_config), _as_dict(pricing_params),
                        provider_mode=_as_dict(provider_config).get("mode"))
        conn.execute(sa.text(
            "UPDATE proxy_allocations SET ip_type = :ip, rotation_kind = :rk, protocol = :pc, country = :co, "
            "network_label = :nl, plan_days = :pd, plan_label = :pl WHERE id = :id"
        ), {"ip": kind.ip_type, "rk": kind.rotation_kind, "pc": kind.protocol, "co": kind.country,
            "nl": (kind.network_label or None) and kind.network_label[:80], "pd": kind.plan_days,
            "pl": (kind.plan_label or None) and kind.plan_label[:160], "id": allocation_id})


def downgrade() -> None:
    op.drop_index("ix_proxy_allocation_tags_tag_id", table_name="proxy_allocation_tags")
    op.drop_table("proxy_allocation_tags")
    op.drop_index("ix_proxy_tags_account_id", table_name="proxy_tags")
    op.drop_table("proxy_tags")
    for name in ("note", "plan_label", "plan_days", "country", "network_label", "protocol", "rotation_kind", "ip_type"):
        op.drop_column("proxy_allocations", name)
