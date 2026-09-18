"""disputes: seller response deadline (A4.5) + fee_runtime_config.dispute_seller_response_hours

Revision ID: fk1a2b3c4d5e6
Revises: fj1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "fk1a2b3c4d5e6"
down_revision = "fj1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("disputes", sa.Column("seller_deadline_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("disputes", sa.Column("seller_responded_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_disputes_seller_deadline_open", "disputes", ["seller_deadline_at"],
        postgresql_where=sa.text("status = 'open' AND seller_responded_at IS NULL"),
    )
    op.add_column("fee_runtime_config", sa.Column("dispute_seller_response_hours", sa.Integer(), nullable=False, server_default="24"))
    # Existing open cases: treat any seller activity so far as a response, so
    # the new deadline never punishes a seller retroactively.
    op.execute(
        "UPDATE disputes d SET seller_responded_at = m.first_seen FROM ("
        "  SELECT dispute_id, MIN(created_at) AS first_seen FROM dispute_messages WHERE actor_role = 'seller' GROUP BY dispute_id"
        ") m WHERE m.dispute_id = d.id"
    )
    op.execute(
        "UPDATE disputes d SET seller_responded_at = COALESCE(d.seller_responded_at, a.first_seen) FROM ("
        "  SELECT dispute_id, MIN(created_at) AS first_seen FROM dispute_resource_actions GROUP BY dispute_id"
        ") a WHERE a.dispute_id = d.id"
    )


def downgrade() -> None:
    op.drop_column("fee_runtime_config", "dispute_seller_response_hours")
    op.drop_index("ix_disputes_seller_deadline_open", table_name="disputes")
    op.drop_column("disputes", "seller_responded_at")
    op.drop_column("disputes", "seller_deadline_at")
