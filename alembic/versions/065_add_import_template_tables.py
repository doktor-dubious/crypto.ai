"""Add import_templates and import_template_elements tables.

Revision ID: 065
Revises: 064
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_templates",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("customer_id", UUID(as_uuid=False), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("move_file", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("header_lines", sa.Integer(), server_default="0", nullable=False),
        sa.Column("footer_lines", sa.Integer(), server_default="0", nullable=False),
        sa.Column("separator", sa.String(16), server_default="','", nullable=False),
        sa.Column("reset_production_group", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("add_to_production_group", sa.Boolean(), server_default="false", nullable=False),
    )

    op.create_table(
        "import_template_elements",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("template_id", UUID(as_uuid=False), sa.ForeignKey("import_templates.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("element_index", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("allow", sa.String(255), nullable=True),
        sa.Column("disallow", sa.String(255), nullable=True),
        sa.Column("allow_empty", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("allow_negative", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("allow_positive", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("allow_zero", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("date_format", sa.String(32), server_default="'MM/DD/YY'", nullable=False),
        sa.Column("decimal_separator", sa.String(8), server_default="'.'", nullable=False),
        sa.Column("maximum_value", sa.Integer(), server_default="0", nullable=False),
        sa.Column("empty_is_zero", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("negative_parenthesis", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sequence_separator", sa.String(8), server_default="','", nullable=False),
        sa.Column("weekday_start", sa.SmallInteger(), nullable=True),
        sa.Column("strip", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("import_template_elements")
    op.drop_table("import_templates")
