"""IP whitelist của buyer cho key xoay TopProxy

Nhà cung cấp chỉ cho kết nối tới proxy từ IP đã đăng ký. Với phương án B1
(server mình gọi get.php thay buyer), whitelist mặc định là IP server nên buyer
không dùng được proxy — xem src/models/proxy_allocation.py.

Revision ID: cf1a2b3c4d5e6
Revises: bf1a2b3c4d5e6
"""
import sqlalchemy as sa
from alembic import op

revision = "cf1a2b3c4d5e6"
down_revision = "bf1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, không default: NULL = buyer chưa khai báo. Mọi binding hiện có
    # (DProxy lẫn TopProxy) giữ nguyên hành vi.
    op.add_column("proxy_allocations", sa.Column("whitelist_ips", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("proxy_allocations", "whitelist_ips")
