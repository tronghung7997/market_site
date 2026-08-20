"""store the SePay receiving account in the admin deposit config"""

from alembic import op
import sqlalchemy as sa


revision = "cx1a2b3c4d5e6"
down_revision = "cw1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "deposit_intents",
        sa.Column("sepay_bank_account_id", sa.String(length=128), nullable=True),
    )
    for name, length in (
        ("sepay_bank_code", 32),
        ("sepay_bank_account_number", 64),
        ("sepay_bank_account_name", 160),
        ("sepay_bank_account_id", 128),
    ):
        op.add_column(
            "deposit_rail_config",
            sa.Column(name, sa.String(length=length), nullable=False, server_default=""),
        )


def downgrade() -> None:
    op.drop_column("deposit_intents", "sepay_bank_account_id")
    for name in ("sepay_bank_account_id", "sepay_bank_account_name", "sepay_bank_account_number", "sepay_bank_code"):
        op.drop_column("deposit_rail_config", name)
