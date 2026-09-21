"""Account profile: display name, contacts, preferences, notification prefs; session device info

Revision ID: fn1a2b3c4d5e6
Revises: fm1a2b3c4d5e6
Create Date: 2026-09-21

The self-service /account page needs a few things the auth model never
carried: a name to greet the user with, contact handles support can reach,
the locale/currency they want by default, and per-category e-mail opt-outs.
``auth_sessions`` also learns the IP and user agent it was created from so
"devices signed in" can show more than a timestamp.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "fn1a2b3c4d5e6"
down_revision = "fm1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("display_name", sa.String(80), nullable=True))
    op.add_column("accounts", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("accounts", sa.Column("telegram_username", sa.String(64), nullable=True))
    op.add_column("accounts", sa.Column("preferred_locale", sa.String(5), nullable=True))
    op.add_column("accounts", sa.Column("preferred_currency", sa.String(3), nullable=True))
    op.add_column(
        "accounts",
        sa.Column("notification_prefs", postgresql.JSONB(), nullable=False, server_default="{}"),
    )
    op.add_column("auth_sessions", sa.Column("ip", sa.String(45), nullable=True))
    op.add_column("auth_sessions", sa.Column("user_agent", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("auth_sessions", "user_agent")
    op.drop_column("auth_sessions", "ip")
    for col in ("notification_prefs", "preferred_currency", "preferred_locale", "telegram_username", "phone", "display_name"):
        op.drop_column("accounts", col)
