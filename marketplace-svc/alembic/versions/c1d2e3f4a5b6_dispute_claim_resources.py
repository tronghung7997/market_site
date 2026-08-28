"""Persist buyer-selected dispute resources.

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
"""
from alembic import op
import sqlalchemy as sa


revision = "c1d2e3f4a5b6"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dispute_claim_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dispute_id", sa.Integer(), sa.ForeignKey("disputes.id"), nullable=False),
        sa.Column("resource_id", sa.Integer(), sa.ForeignKey("resources.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("dispute_id", "resource_id", name="uq_dispute_claim_resources_dispute_resource"),
    )


def downgrade() -> None:
    op.drop_table("dispute_claim_resources")
