"""alerts: admin-side resolution (who, when, note)

Revision ID: ga1a2b3c4d5e6
Revises: fy1a2b3c4d5e6
Create Date: 2026-09-24

Admins used to "dismiss" an alert by flipping is_active, which also hid
seller/buyer-facing alerts (sla_breach, resource_low…) from their owner. The
admin inbox now tracks its own resolution. Rows that were already inactive
count as resolved for the admin too, so the inbox does not refill with old
seller notices after the upgrade.
"""
import sqlalchemy as sa
from alembic import op

revision = "ga1a2b3c4d5e6"
down_revision = "fy1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alerts", sa.Column("admin_resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("alerts", sa.Column("admin_resolved_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True))
    op.add_column("alerts", sa.Column("admin_note", sa.Text(), nullable=True))
    op.execute(
        "UPDATE alerts SET admin_resolved_at = COALESCE(resolved_at, last_seen_at, created_at) WHERE is_active = false"
    )
    op.create_index(
        "ix_alerts_admin_open", "alerts", ["last_seen_at"],
        postgresql_where=sa.text("admin_resolved_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_alerts_admin_open", table_name="alerts")
    op.drop_column("alerts", "admin_note")
    op.drop_column("alerts", "admin_resolved_by_id")
    op.drop_column("alerts", "admin_resolved_at")
