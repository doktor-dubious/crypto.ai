"""Add import_logs table

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-04-18 17:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "import_logs",
        sa.Column("id", sa.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("customer_id", sa.UUID(as_uuid=False), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("template_id", sa.UUID(as_uuid=False), sa.ForeignKey("import_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("rows_imported", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_import_logs_customer_id", "import_logs", ["customer_id"])
    op.create_index("ix_import_logs_template_id", "import_logs", ["template_id"])
    op.create_index("ix_import_logs_filename", "import_logs", ["filename"])


def downgrade() -> None:
    op.drop_index("ix_import_logs_filename", table_name="import_logs")
    op.drop_index("ix_import_logs_template_id", table_name="import_logs")
    op.drop_index("ix_import_logs_customer_id", table_name="import_logs")
    op.drop_table("import_logs")
