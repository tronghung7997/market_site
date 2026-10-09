"""ops settings: escrow holds in hours, dispute-open window, HTML announcement

- Every escrow hold value moves from days to hours (days × 24):
  products.escrow_days → escrow_hours, fee_runtime_config.escrow_default_days /
  escrow_min_days / category_escrow_min_days → *_hours, and
  seller_tier_config.escrow_reduction_days → escrow_reduction_hours.
  A product (or default) hold of 0 days already meant one day (the hold never
  went under a day), so it becomes 24 h and every existing order keeps the same hold.
- fee_runtime_config.dispute_open_window_hours: hours after delivery a buyer
  may open a dispute (0 = until escrow release, the previous behaviour).
- site_runtime_config.announcement_format (text | html) and room for the
  sanitized HTML in the announcement texts.

Revision ID: ka1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op

revision = "ka1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None


def _days_map_to_hours(column: str) -> None:
    # {category_id: days} → {category_id: hours}. JSON, not JSONB.
    op.execute(
        f"""
        UPDATE fee_runtime_config SET {column} = COALESCE((
            SELECT json_object_agg(key, ((value::text)::numeric * 24)::int)
            FROM json_each({column})
        ), '{{}}'::json)
        """
    )


def upgrade() -> None:
    op.alter_column("products", "escrow_days", new_column_name="escrow_hours")
    op.execute("UPDATE products SET escrow_hours = GREATEST(escrow_hours, 1) * 24")

    op.alter_column("fee_runtime_config", "escrow_default_days", new_column_name="escrow_default_hours",
                    server_default="48")
    op.alter_column("fee_runtime_config", "escrow_min_days", new_column_name="escrow_min_hours")
    op.alter_column("fee_runtime_config", "category_escrow_min_days", new_column_name="category_escrow_min_hours")
    op.execute("UPDATE fee_runtime_config SET escrow_default_hours = GREATEST(escrow_default_hours, 1) * 24, "
               "escrow_min_hours = escrow_min_hours * 24")
    _days_map_to_hours("category_escrow_min_hours")
    op.add_column("fee_runtime_config", sa.Column(
        "dispute_open_window_hours", sa.Integer(), nullable=False, server_default="0",
    ))

    op.alter_column("seller_tier_config", "escrow_reduction_days", new_column_name="escrow_reduction_hours")
    op.execute("UPDATE seller_tier_config SET escrow_reduction_hours = escrow_reduction_hours * 24")

    op.add_column("site_runtime_config", sa.Column(
        "announcement_format", sa.String(8), nullable=False, server_default="text",
    ))
    op.alter_column("site_runtime_config", "announcement_text_vi", type_=sa.String(2000), existing_nullable=False)
    op.alter_column("site_runtime_config", "announcement_text_en", type_=sa.String(2000), existing_nullable=False)


def downgrade() -> None:
    # HTML announcements do not fit back into 300 plain characters: drop them.
    op.execute(
        "UPDATE site_runtime_config SET announcement_text_vi = '', announcement_text_en = '', "
        "announcement_enabled = false WHERE announcement_format = 'html'"
    )
    op.alter_column("site_runtime_config", "announcement_text_en", type_=sa.String(300), existing_nullable=False)
    op.alter_column("site_runtime_config", "announcement_text_vi", type_=sa.String(300), existing_nullable=False)
    op.drop_column("site_runtime_config", "announcement_format")

    # Hours that are not whole days round up, so no hold gets shorter.
    op.execute("UPDATE seller_tier_config SET escrow_reduction_hours = escrow_reduction_hours / 24")
    op.alter_column("seller_tier_config", "escrow_reduction_hours", new_column_name="escrow_reduction_days")

    op.drop_column("fee_runtime_config", "dispute_open_window_hours")
    op.execute(
        "UPDATE fee_runtime_config SET escrow_default_hours = CEIL(escrow_default_hours / 24.0), "
        "escrow_min_hours = CEIL(escrow_min_hours / 24.0)"
    )
    op.execute(
        "UPDATE fee_runtime_config SET category_escrow_min_hours = COALESCE((SELECT json_object_agg(key, CEIL((value::text)::numeric / 24)::int) "
        "FROM json_each(category_escrow_min_hours)), '{}'::json)"
    )
    op.alter_column("fee_runtime_config", "category_escrow_min_hours", new_column_name="category_escrow_min_days")
    op.alter_column("fee_runtime_config", "escrow_min_hours", new_column_name="escrow_min_days")
    op.alter_column("fee_runtime_config", "escrow_default_hours", new_column_name="escrow_default_days",
                    server_default="2")

    op.execute("UPDATE products SET escrow_hours = CEIL(escrow_hours / 24.0)")
    op.alter_column("products", "escrow_hours", new_column_name="escrow_days")
