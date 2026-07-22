"""order_balances.endpoint_rates + default_rate — per-endpoint gateway cost

Closes the biggest remaining "not actually generic" gap in
docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md: the
gateway router charged a flat 1 unit per call regardless of which endpoint
was hit. `pricing_params.endpoint_rates` (e.g. {"search": 1, "scrape": 5})
lets a seller price different endpoints differently — frozen onto
`order_balances` at delivery time, same principle as `units_total`: what the
buyer bought shouldn't drift if the seller edits pricing_params later.

`provider.config.endpoint_map` (no migration needed, config is already JSON)
is the other half — translates a neutral endpoint name to the seller's real
path, read live (like base_url/api_key already are) since it's an
integration detail, not a purchased term.

Revision ID: ab1a2b3c4d5e6
Revises: aa1a2b3c4d5e6
Create Date: 2026-07-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ab1a2b3c4d5e6"
down_revision = "aa1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_balances", sa.Column("endpoint_rates", postgresql.JSONB(), nullable=True))
    op.add_column("order_balances", sa.Column("default_rate", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("order_balances", "default_rate")
    op.drop_column("order_balances", "endpoint_rates")
