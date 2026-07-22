"""proxy_allocations — exclusive DProxy assignment-to-order bindings

See docs/superpowers/specs/2026-07-22-dproxy-integration.md Task 2.
UNIQUE(provider_id, external_id) prevents the same upstream assignment
being delivered to two orders; UNIQUE(order_id) gives one DProxy assignment
per order in this phase.

Revision ID: ac1a2b3c4d5e6
Revises: ab1a2b3c4d5e6
Create Date: 2026-07-22
"""
from alembic import op
import sqlalchemy as sa

revision = "ac1a2b3c4d5e6"
down_revision = "ab1a2b3c4d5e6"
branch_labels = None
depends_on = None

_STATUS_ENUM = sa.Enum("allocated", "expired", "released", "error", name="proxyallocationstatus")


def upgrade() -> None:
    op.create_table(
        "proxy_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("external_id", sa.String(length=100), nullable=False),
        sa.Column("external_proxy_id", sa.String(length=100), nullable=True),
        sa.Column("status", _STATUS_ENUM, nullable=False, server_default="allocated"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotate_path", sa.Text(), nullable=True),
        sa.Column("rotation_available", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cooldown_seconds", sa.Integer(), nullable=True),
        sa.Column("last_rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_public_ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("provider_id", "external_id", name="uq_proxy_allocations_provider_external"),
        sa.UniqueConstraint("order_id", name="uq_proxy_allocations_order"),
    )
    op.create_index(
        "ix_proxy_allocations_provider_status_expiry",
        "proxy_allocations", ["provider_id", "status", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_proxy_allocations_provider_status_expiry", table_name="proxy_allocations")
    op.drop_table("proxy_allocations")
    _STATUS_ENUM.drop(op.get_bind(), checkfirst=True)
