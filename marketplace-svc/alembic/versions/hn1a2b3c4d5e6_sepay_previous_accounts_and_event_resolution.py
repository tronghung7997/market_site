"""Retired SePay beneficiary numbers; manual resolution of unmatched transfers

Revision ID: hn1a2b3c4d5e6
Revises: hm1a2b3c4d5e6
Create Date: 2026-09-29

- deposit_rail_config.sepay_previous_account_numbers: numbers used before the
  current beneficiary, still accepted so saved standing QRs keep working.
- sepay_webhook_events.resolution/resolved_by_id/resolved_at/resolution_note:
  an admin assigns an unmatched incoming transfer to an account or dismisses it.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "hn1a2b3c4d5e6"
down_revision = "hm1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "deposit_rail_config",
        sa.Column(
            "sepay_previous_account_numbers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("sepay_webhook_events", sa.Column("resolution", sa.String(length=16), nullable=True))
    op.add_column(
        "sepay_webhook_events",
        sa.Column("resolved_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
    )
    op.add_column("sepay_webhook_events", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sepay_webhook_events", sa.Column("resolution_note", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("sepay_webhook_events", "resolution_note")
    op.drop_column("sepay_webhook_events", "resolved_at")
    op.drop_column("sepay_webhook_events", "resolved_by_id")
    op.drop_column("sepay_webhook_events", "resolution")
    op.drop_column("deposit_rail_config", "sepay_previous_account_numbers")
