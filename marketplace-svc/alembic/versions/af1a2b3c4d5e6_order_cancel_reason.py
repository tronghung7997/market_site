"""order cancel_reason — lý do huỷ đơn hiển thị cho buyer

Trước đây provision fail chỉ ghi lý do vào log_entries (admin) — buyer chỉ thấy
"Đã huỷ" trống trơn, không biết vì sao (hết hàng?) và có được hoàn tiền không.
Cột này lưu lý do WHITE-LABEL để buyer đọc được.

Revision ID: af1a2b3c4d5e6
Revises: ae1a2b3c4d5e6
Create Date: 2026-07-24
"""
from alembic import op
import sqlalchemy as sa

revision = "af1a2b3c4d5e6"
down_revision = "ae1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("cancel_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "cancel_reason")
