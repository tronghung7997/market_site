"""Index the scheduler scans: orders by (status, id), resources by expiry

escrow_release_job, sla_check_job and provision_sweep_job page through one
order status with `status = X AND id > N ORDER BY id LIMIT 200`; the only
status indexes led with created_at / escrow_expires_at, so plans walked the
primary key and filtered every order. resource_expire_job looks for
`status = 'assigned' AND expires_at <= now`; nothing indexed expires_at.

Plain CREATE INDEX inside the migration transaction, not CONCURRENTLY: the
production tables are small (orders in the low thousands, resources in the
tens of thousands), so the SHARE lock blocking writes lasts well under a
second, and CONCURRENTLY cannot run inside Alembic's transaction.

Revision ID: ib1a2b3c4d5e6
Revises: ia1a2b3c4d5e6
Create Date: 2026-10-06
"""
import sqlalchemy as sa
from alembic import op

revision = "ib1a2b3c4d5e6"
down_revision = "ia1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_orders_status_id", "orders", ["status", "id"])
    op.create_index(
        "ix_resources_status_expires_at",
        "resources",
        ["status", "expires_at", "id"],
        postgresql_where=sa.text("expires_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_resources_status_expires_at", table_name="resources")
    op.drop_index("ix_orders_status_id", table_name="orders")
