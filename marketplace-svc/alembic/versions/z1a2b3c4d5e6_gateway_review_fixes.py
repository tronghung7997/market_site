"""orders.provider_id snapshot + usage_records 'refunded' status

Two fixes from code review of the gateway/task-webhook work
(docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md):

- `orders.provider_id`: the gateway router (src/gateway/router.py) used to
  resolve a buyer's forward through `product.provider_id` — the product's
  CURRENT provider, live-read on every call. If an admin re-links the
  product to a different provider after the order was sold, every gateway
  key already handed to a buyer silently starts hitting the new provider
  instead of the one that actually fulfilled the order. This column snapshots
  the provider that succeeded at provisioning time; the gateway router now
  resolves from it instead.
- `usage_records.status` gains `refunded`: `refund_usage()` (usage/service.py)
  only decremented `units_used` without leaving a ledger trace, so a
  forward-then-refund left a dangling `ok` record that no longer matched the
  balance. Now it writes a `refunded` row so the full history reconstructs.

Revision ID: z1a2b3c4d5e6
Revises: y1a2b3c4d5e6
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa

revision = "z1a2b3c4d5e6"
down_revision = "y1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=True),
    )
    op.execute("ALTER TYPE usagerecordstatus ADD VALUE IF NOT EXISTS 'refunded'")


def downgrade() -> None:
    # No DROP VALUE for enums in Postgres — same convention as other
    # additive enum migrations here (see n1a2b3c4d5e6). Column drop is safe.
    op.drop_column("orders", "provider_id")
