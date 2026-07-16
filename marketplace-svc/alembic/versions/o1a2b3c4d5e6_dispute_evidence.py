"""add structured evidence fields to disputes

Buyers previously could only submit a free-text reason. Adds evidence_type
(which evidence form the buyer filled in — proxy/account/server/payment/other)
and evidence (JSONB key-value pairs specific to that type) so admins get
structured facts instead of parsing prose.

Revision ID: o1a2b3c4d5e6
Revises: n1a2b3c4d5e6
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "o1a2b3c4d5e6"
down_revision = "n1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("disputes", sa.Column("evidence_type", sa.Text(), nullable=True))
    op.add_column("disputes", sa.Column("evidence", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("disputes", "evidence")
    op.drop_column("disputes", "evidence_type")
