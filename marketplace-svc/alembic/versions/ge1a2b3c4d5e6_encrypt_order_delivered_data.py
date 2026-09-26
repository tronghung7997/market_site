"""orders.delivered_data: encrypt at rest

`resources.data` has been Fernet-encrypted since fx1a2b3c4d5e6, but every order
kept a plaintext copy of the lines it delivered in `orders.delivered_data`, so a
database dump or backup still exposed every sold credential. New stock orders
no longer write that copy (their lines are read from `resources`); what remains
(copies on older orders, proxy credentials, gateway keys, manual deliveries) is
encrypted here and the column is read through `EncryptedText` from now on.

Values can be tens of MB, so rows are encrypted a few at a time, each batch
committed on its own (autocommit block): the migration never holds one huge
transaction and can resume where it stopped. Already-encrypted values are
skipped. Downgrade decrypts back to plaintext.

Revision ID: ge1a2b3c4d5e6
Revises: gd1a2b3c4d5e6
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op
from cryptography.fernet import InvalidToken

from src.security.crypto import FERNET_PREFIX, decrypt_str, encrypt_str

revision = "ge1a2b3c4d5e6"
down_revision = "gd1a2b3c4d5e6"
branch_labels = None
depends_on = None

BATCH = 20


def _rewrite(conn, *, encrypted: bool, transform) -> None:  # noqa: ANN001
    condition = "left(delivered_data, :n) <> :prefix" if encrypted else "left(delivered_data, :n) = :prefix"
    cursor = 0
    while True:
        rows = conn.execute(
            sa.text(
                "SELECT id, delivered_data FROM orders "
                f"WHERE id > :cursor AND delivered_data IS NOT NULL AND {condition} "
                "ORDER BY id LIMIT :limit"
            ),
            {"cursor": cursor, "limit": BATCH, "n": len(FERNET_PREFIX), "prefix": FERNET_PREFIX},
        ).all()
        if not rows:
            return
        conn.execute(
            sa.text("UPDATE orders SET delivered_data = :value WHERE id = :id"),
            [{"id": row_id, "value": transform(value)} for row_id, value in rows],
        )
        cursor = rows[-1][0]


def _decrypt(value: str) -> str:
    try:
        return decrypt_str(value)
    except InvalidToken:
        return value


def upgrade() -> None:
    with op.get_context().autocommit_block():
        _rewrite(op.get_bind(), encrypted=True, transform=encrypt_str)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        _rewrite(op.get_bind(), encrypted=False, transform=_decrypt)
