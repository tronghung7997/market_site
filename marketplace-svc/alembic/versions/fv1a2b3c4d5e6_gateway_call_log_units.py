"""gateway_call_logs: units charged and remaining per call

Revision ID: fv1a2b3c4d5e6
Revises: fu1a2b3c4d5e6
Create Date: 2026-09-23

The API console ("API của tôi") and the source's Request tab show, per
call, whether the buyer was charged (upstream errors are free on sources
with config.charge_only_success) and how many requests were left. Rows
written before this revision keep NULL and read as "unknown".
"""
import sqlalchemy as sa
from alembic import op

revision = "fv1a2b3c4d5e6"
down_revision = "fu1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gateway_call_logs", sa.Column("units_charged", sa.Integer(), nullable=True))
    op.add_column("gateway_call_logs", sa.Column("units_remaining", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("gateway_call_logs", "units_remaining")
    op.drop_column("gateway_call_logs", "units_charged")
