"""encrypt existing plaintext api_key/api_secret in providers.config

Provider.config is a JSON blob stored plaintext, including any real supplier
API credentials (topproxy/scrapecreators adapter_type). This is a data-only
migration — schema stays the same JSON column — that encrypts sensitive
fields in-place for any provider row that still has them plaintext. Idempotent:
skips fields that already look encrypted.

Revision ID: r1a2b3c4d5e6
Revises: q1a2b3c4d5e6
Create Date: 2026-07-16
"""
import json

from alembic import op
import sqlalchemy as sa

from src.security.crypto import SENSITIVE_CONFIG_KEYS, encrypt_str, is_encrypted

revision = "r1a2b3c4d5e6"
down_revision = "q1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, config FROM providers")).fetchall()
    for row in rows:
        config = row.config or {}
        changed = False
        for key in SENSITIVE_CONFIG_KEYS:
            value = config.get(key)
            if isinstance(value, str) and value and not is_encrypted(value):
                config[key] = encrypt_str(value)
                changed = True
        if changed:
            conn.execute(
                sa.text("UPDATE providers SET config = :c WHERE id = :id"),
                {"c": json.dumps(config), "id": row.id},
            )


def downgrade() -> None:
    # Encryption is one-directional here — decrypting back to plaintext on
    # downgrade would just re-introduce the vulnerability this migration
    # fixes. No-op, matching convention of other data-only migrations here.
    pass
