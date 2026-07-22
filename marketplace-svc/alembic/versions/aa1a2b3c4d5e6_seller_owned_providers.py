"""seller-owned providers: seller_id, review_status, review_note

Part A of docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md
(deferred until now): lets a seller register their OWN backend as a
Provider instead of every Provider being admin-authored platform
infrastructure. `seller_id` NULL keeps today's behavior (admin-owned,
platform-wide) unchanged; a seller-created provider gets `review_status`
starting at `pending_review` until an admin approves it — only an
`approved` provider may ever be attached to a product (enforced in
providers/service.py, not just at this schema layer).

Revision ID: aa1a2b3c4d5e6
Revises: z1a2b3c4d5e6
Create Date: 2026-07-22
"""
from alembic import op
import sqlalchemy as sa

revision = "aa1a2b3c4d5e6"
down_revision = "z1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("providers", sa.Column("seller_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True))
    op.add_column(
        "providers",
        sa.Column("review_status", sa.String(20), nullable=False, server_default="approved"),
    )
    op.add_column("providers", sa.Column("review_note", sa.Text(), nullable=True))
    op.create_index("ix_providers_seller_id", "providers", ["seller_id"])


def downgrade() -> None:
    op.drop_index("ix_providers_seller_id", table_name="providers")
    op.drop_column("providers", "review_note")
    op.drop_column("providers", "review_status")
    op.drop_column("providers", "seller_id")
