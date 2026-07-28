"""Sổ Xu ước tính cho provider TopProxy

TopProxy trả trước bằng Xu và không có API xem số dư (docs/topproxy-catalog.md
§1). Ba cột này cho phép admin nhập số dư sau mỗi lần nạp, hệ thống tự trừ dần
theo giá vốn mỗi lệnh mua và cảnh báo trước khi hết.

Revision ID: bf1a2b3c4d5e6
Revises: af1a2b3c4d5e6
"""
import sqlalchemy as sa
from alembic import op

revision = "bf1a2b3c4d5e6"
down_revision = "af1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, không default: NULL = chưa bật theo dõi. Mọi provider hiện có
    # (kể cả topproxy) giữ nguyên hành vi cho tới khi admin nhập số dư đầu tiên.
    op.add_column("providers", sa.Column("credit_balance_xu", sa.Integer(), nullable=True))
    op.add_column("providers", sa.Column("credit_low_threshold_xu", sa.Integer(), nullable=True))
    op.add_column(
        "providers",
        sa.Column("credit_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("providers", "credit_updated_at")
    op.drop_column("providers", "credit_low_threshold_xu")
    op.drop_column("providers", "credit_balance_xu")
