"""supplier_listings: cầu dao mua lỗi liên tiếp

fail_streak = số lần mua thất bại LIÊN TIẾP (reset khi mua thành công hoặc
seller bật lại gói). Đủ ngưỡng (provider config `auto_pause_after_failures`,
mặc định 3) thì gói tự tắt, kèm lý do ở last_fail_reason.

Revision ID: ef1a2b3c4d5e6
Revises: ee1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "ef1a2b3c4d5e6"
down_revision = "ee1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("supplier_listings", sa.Column("fail_streak", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("supplier_listings", sa.Column("last_fail_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("supplier_listings", sa.Column("last_fail_reason", sa.String(255), nullable=True))
    op.add_column("supplier_listings", sa.Column("auto_paused_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for col in ("auto_paused_at", "last_fail_reason", "last_fail_at", "fail_streak"):
        op.drop_column("supplier_listings", col)
