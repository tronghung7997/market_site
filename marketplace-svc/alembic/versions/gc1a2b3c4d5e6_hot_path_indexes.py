"""indexes for the hot read paths and scheduler scans

Every buyer/seller surface filters `orders` by `buyer_id` / `seller_id`
(wallet escrow snapshot, order lists, notification bell, seller dashboard) and
every settlement job filters it by `status` (+ `created_at` /
`escrow_expires_at`), but the table only had indexes on `product_id`,
`order_code` and `gateway_key_hash` — each of those reads was a sequential scan.
The same holds for the per-order lookups on `resources`, `disputes` and
`service_tasks`, the alert lookups by target and the wallet transaction list.

`ix_resources_variant_sellable` replaces `ix_resources_variant_archived` with the
same leading columns plus `(created_at, id)`, so instant-inventory claims
(`ORDER BY created_at ... LIMIT n FOR UPDATE SKIP LOCKED`) read the oldest
sellable rows straight from the index instead of sorting a variant's stock.

Filters on enum columns use plain composite indexes, not partial ones: asyncpg
sends `status = $1`, and a generic plan cannot prove a partial predicate such
as `status = 'delivered'` from a bind parameter.

All indexes are built CONCURRENTLY (outside a transaction) because the service
runs `alembic upgrade head` at start-up against a live database; a plain
CREATE INDEX would block writes to `orders` / `resources` for the whole build.
An index left INVALID by an interrupted concurrent build is dropped and rebuilt.

Revision ID: gc1a2b3c4d5e6
Revises: gb1a2b3c4d5e6
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op

revision = "gc1a2b3c4d5e6"
down_revision = "gb1a2b3c4d5e6"
branch_labels = None
depends_on = None

_INDEXES: tuple[tuple[str, str], ...] = (
    ("ix_orders_buyer_id_created_at", "ON orders (buyer_id, created_at)"),
    ("ix_orders_seller_id_created_at", "ON orders (seller_id, created_at)"),
    ("ix_orders_status_created_at", "ON orders (status, created_at)"),
    ("ix_orders_status_escrow_expires_at", "ON orders (status, escrow_expires_at)"),
    ("ix_resources_order_id", "ON resources (order_id) WHERE order_id IS NOT NULL"),
    ("ix_resources_variant_sellable", "ON resources (variant_id, is_archived, status, created_at, id)"),
    ("ix_disputes_order_id", "ON disputes (order_id)"),
    ("ix_disputes_buyer_id", "ON disputes (buyer_id)"),
    ("ix_service_tasks_order_id", "ON service_tasks (order_id)"),
    ("ix_alerts_active_target", "ON alerts (target_type, target_id) WHERE is_active"),
    ("ix_transactions_wallet_id_created_at", "ON transactions (wallet_id, created_at)"),
)

_REPLACED = ("ix_resources_variant_archived", "ON resources (variant_id, is_archived, status)")


def _drop_if_invalid(name: str) -> None:
    invalid = op.get_bind().execute(
        sa.text(
            "SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = :name AND NOT i.indisvalid"
        ),
        {"name": name},
    ).first()
    if invalid:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")


def _create(name: str, definition: str) -> None:
    _drop_if_invalid(name)
    op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} {definition}")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, definition in _INDEXES:
            _create(name, definition)
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_REPLACED[0]}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        _create(*_REPLACED)
        for name, _ in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
