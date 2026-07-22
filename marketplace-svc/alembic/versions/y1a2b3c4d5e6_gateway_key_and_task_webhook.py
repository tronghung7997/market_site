"""gateway key on orders + external_task_id/provider_id on service_tasks

Two additive columns for the seller-gateway/task-webhook adapters (see
docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md):

- `orders.gateway_key_hash`/`gateway_key_prefix`: a platform-minted token
  handed to the buyer instead of the seller's real credential, for
  strategy=credit orders fulfilled through the `seller_gateway` adapter.
  Hashed at rest same as `seller_api_keys` — the plaintext is shown once.
- `service_tasks.external_task_id`/`provider_id`: lets a seller's webhook
  callback (`POST /webhooks/providers/{provider_id}/tasks/{external_task_id}`)
  find the right row without trusting the numeric internal task id.

Revision ID: y1a2b3c4d5e6
Revises: x1a2b3c4d5e6
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa

revision = "y1a2b3c4d5e6"
down_revision = "x1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("gateway_key_hash", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("gateway_key_prefix", sa.String(24), nullable=True))
    op.create_unique_constraint("uq_orders_gateway_key_hash", "orders", ["gateway_key_hash"])

    op.add_column("service_tasks", sa.Column("external_task_id", sa.String(100), nullable=True))
    op.add_column(
        "service_tasks",
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=True),
    )
    op.create_index("ix_service_tasks_external_task_id", "service_tasks", ["external_task_id"])


def downgrade() -> None:
    op.drop_index("ix_service_tasks_external_task_id", table_name="service_tasks")
    op.drop_column("service_tasks", "provider_id")
    op.drop_column("service_tasks", "external_task_id")

    op.drop_constraint("uq_orders_gateway_key_hash", "orders", type_="unique")
    op.drop_column("orders", "gateway_key_prefix")
    op.drop_column("orders", "gateway_key_hash")
