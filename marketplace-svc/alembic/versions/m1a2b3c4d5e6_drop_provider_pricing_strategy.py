"""drop dead providers.pricing_strategy column

Giá được resolve ở product-level (product -> pricing_configs -> fixed);
cột này chưa bao giờ được đọc trong pricing resolution và chỉ gây nhầm
lẫn trên UI admin.
"""

from alembic import op
import sqlalchemy as sa

revision = "m1a2b3c4d5e6"
down_revision = "l1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("providers", "pricing_strategy")


def downgrade():
    op.add_column(
        "providers",
        sa.Column("pricing_strategy", sa.String(50), server_default="fixed", nullable=True),
    )
