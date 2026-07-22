"""proxy_allocations — offline status + consecutive_misses grace counter

Fixes review Blocker 2 (docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md):
a temporarily offline/inactive bound assignment was being flagged `error`
immediately and could never recover, because reconciliation only ever
queried `status == allocated`. `offline` is a recoverable state included in
that query; `consecutive_misses` is a grace counter so a single bad /list
response from the supplier can't do the same thing for a genuinely-missing
assignment.

Adding a value to a PostgreSQL enum type cannot run inside the same
transaction that uses it, but CAN run in its own transaction (PG12+) — plain
`ALTER TYPE ... ADD VALUE` is fine here since alembic runs each migration in
its own transaction and this migration doesn't use the new value itself.
Removing an enum value has no direct SQL — downgrade rebuilds the type via
the standard rename-recreate-cast-drop dance.

Revision ID: ad1a2b3c4d5e6
Revises: ac1a2b3c4d5e6
Create Date: 2026-07-22
"""
from alembic import op
import sqlalchemy as sa

revision = "ad1a2b3c4d5e6"
down_revision = "ac1a2b3c4d5e6"
branch_labels = None
depends_on = None

_ENUM_NAME = "proxyallocationstatus"
_OLD_VALUES = ("allocated", "expired", "released", "error")
_NEW_VALUES = ("allocated", "offline", "expired", "released", "error")


def upgrade() -> None:
    op.execute(f"ALTER TYPE {_ENUM_NAME} ADD VALUE IF NOT EXISTS 'offline'")
    op.add_column(
        "proxy_allocations",
        sa.Column("consecutive_misses", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("proxy_allocations", "consecutive_misses")
    # No `ALTER TYPE ... DROP VALUE` in PostgreSQL — recreate the type without
    # `offline`, remapping any row currently in that state to `error` first
    # (closest existing meaning: present-but-unusable that reconciliation
    # will re-derive from live state on its next run anyway).
    op.execute("UPDATE proxy_allocations SET status = 'error' WHERE status = 'offline'")
    # The column's server_default is bound to the OLD type object — Postgres
    # refuses to ALTER COLUMN TYPE while a default still references it
    # ("cannot be cast automatically"). Drop it, swap the type, put it back.
    op.execute("ALTER TABLE proxy_allocations ALTER COLUMN status DROP DEFAULT")
    op.execute(f"ALTER TYPE {_ENUM_NAME} RENAME TO {_ENUM_NAME}_old")
    old_values_sql = ", ".join(f"'{v}'" for v in _OLD_VALUES)
    op.execute(f"CREATE TYPE {_ENUM_NAME} AS ENUM ({old_values_sql})")
    op.execute(
        f"ALTER TABLE proxy_allocations ALTER COLUMN status TYPE {_ENUM_NAME} "
        f"USING status::text::{_ENUM_NAME}"
    )
    op.execute(f"ALTER TABLE proxy_allocations ALTER COLUMN status SET DEFAULT 'allocated'")
    op.execute(f"DROP TYPE {_ENUM_NAME}_old")
