"""Add prediction_export_templates and prediction_export_template_elements tables.

Revision ID: 031
Revises: 030
Create Date: 2026-03-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prediction_export_templates",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("output_name", sa.String(255), nullable=True),
        sa.Column("header_lines", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("footer_lines", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("footer_text", sa.Text(), nullable=True),
        sa.Column("separator", sa.String(16), nullable=False, server_default="','"),
        sa.Column("field_length", sa.String(16), nullable=False, server_default="'variable'"),
        sa.Column("character_set", sa.String(32), nullable=False, server_default="'utf-8'"),
        sa.Column("send_to_download", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("send_to_ftp", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("send_to_email", sa.Boolean(), nullable=False, server_default="false"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_prediction_export_templates_active", "prediction_export_templates", ["active"])
    op.create_index("ix_prediction_export_templates_customer_id", "prediction_export_templates", ["customer_id"])

    op.create_table(
        "prediction_export_template_elements",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("template_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("fixed_length", sa.Integer(), nullable=True),
        sa.Column("prepend_filler_char", sa.String(8), nullable=True),
        sa.Column("append_filler_char", sa.String(8), nullable=True),
        sa.Column("date_format", sa.String(32), nullable=False, server_default="'MM/DD/YYYY'"),
        sa.Column("text", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["template_id"], ["prediction_export_templates.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_prediction_export_template_elements_active", "prediction_export_template_elements", ["active"])
    op.create_index("ix_prediction_export_template_elements_template_id", "prediction_export_template_elements", ["template_id"])


def downgrade() -> None:
    op.drop_table("prediction_export_template_elements")
    op.drop_table("prediction_export_templates")
