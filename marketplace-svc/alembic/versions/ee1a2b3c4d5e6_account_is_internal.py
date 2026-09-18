"""accounts.is_internal — seller nội bộ do sàn vận hành

Cờ này gate khu "Nguồn cung" bên seller (nguồn hàng admin giao) và là tiêu chí
admin chọn seller khi thêm nguồn. Seller thường mặc định false.

Revision ID: ee1a2b3c4d5e6
Revises: ed1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "ee1a2b3c4d5e6"
down_revision = "ed1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("accounts", "is_internal")
