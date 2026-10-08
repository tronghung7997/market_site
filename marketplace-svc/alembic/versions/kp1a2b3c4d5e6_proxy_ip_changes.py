"""proxy_ip_changes: lịch sử đổi IP của proxy tĩnh + cột IP gốc gần nhất

Revision ID: kp1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op

revision = "kp1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("proxy_allocations", sa.Column("previous_public_ip", sa.String(64), nullable=True))
    op.add_column("proxy_allocations", sa.Column("public_ip_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "proxy_allocations",
        sa.Column("public_ip_change_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "proxy_ip_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("allocation_id", sa.Integer(), sa.ForeignKey("proxy_allocations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("old_value", sa.String(64), nullable=False),
        sa.Column("new_value", sa.String(64), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_proxy_ip_changes_allocation_detected", "proxy_ip_changes", ["allocation_id", "detected_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_proxy_ip_changes_allocation_detected", table_name="proxy_ip_changes")
    op.drop_table("proxy_ip_changes")
    op.drop_column("proxy_allocations", "public_ip_change_count")
    op.drop_column("proxy_allocations", "public_ip_changed_at")
    op.drop_column("proxy_allocations", "previous_public_ip")
