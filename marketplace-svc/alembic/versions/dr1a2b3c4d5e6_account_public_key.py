"""accounts.public_key — opaque public identity for seller pages and chat

Seller profile URLs move from /sellers/{account_id} to /sellers/{handle}-{key}
(or /sellers/{key}), and chat counterparts are addressed by key instead of the
sequential account id, so nobody can count accounts or walk them by id.

The key is an 8-char base36 random string that always contains a letter, so
it can never be confused with a legacy integer id on the read path. The
generator is inlined here on purpose: a migration must keep working even if
``src/i18n/slug.py`` changes later.

Revision ID: dr1a2b3c4d5e6
Revises: dq1a2b3c4d5e6
Create Date: 2026-09-15
"""
import secrets

from alembic import op
import sqlalchemy as sa

revision = "dr1a2b3c4d5e6"
down_revision = "dq1a2b3c4d5e6"
branch_labels = None
depends_on = None

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def _new_public_key() -> str:
    while True:
        key = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if not key.isdigit():
            return key


def upgrade() -> None:
    op.add_column("accounts", sa.Column("public_key", sa.String(length=12), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM accounts ORDER BY id")).all()
    used: set[str] = set()
    for (account_id,) in rows:
        key = _new_public_key()
        while key in used:
            key = _new_public_key()
        used.add(key)
        bind.execute(
            sa.text("UPDATE accounts SET public_key = :key WHERE id = :id"),
            {"key": key, "id": account_id},
        )

    op.alter_column("accounts", "public_key", nullable=False)
    op.create_unique_constraint("uq_accounts_public_key", "accounts", ["public_key"])


def downgrade() -> None:
    op.drop_constraint("uq_accounts_public_key", "accounts", type_="unique")
    op.drop_column("accounts", "public_key")
