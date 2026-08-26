"""admin-editable mail templates"""

from alembic import op
import sqlalchemy as sa


revision = "da1a2b3c4d5e6"
down_revision = "cz1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_templates",
        sa.Column("template", sa.String(length=100), nullable=False),
        sa.Column("locale", sa.String(length=8), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("template", "locale"),
    )


def downgrade() -> None:
    op.drop_table("mail_templates")
