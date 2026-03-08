"""Add task_records table.

Revision ID: 010
Revises: 009
Create Date: 2026-03-05 00:00:00.000000

"""

# isort: skip_file
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "010"
down_revision: str | None = "009"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_records",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("task_id", sa.String(255), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", name="uq_task_records_task_id"),
    )
    op.create_index("ix_task_records_task_id", "task_records", ["task_id"])
    op.create_index("ix_task_records_customer_id", "task_records", ["customer_id"])
    op.create_index("ix_task_records_status", "task_records", ["status"])
    op.create_index("ix_task_records_type", "task_records", ["type"])
    op.create_index("ix_task_records_active", "task_records", ["active"])


def downgrade() -> None:
    op.drop_index("ix_task_records_active", table_name="task_records")
    op.drop_index("ix_task_records_type", table_name="task_records")
    op.drop_index("ix_task_records_status", table_name="task_records")
    op.drop_index("ix_task_records_customer_id", table_name="task_records")
    op.drop_index("ix_task_records_task_id", table_name="task_records")
    op.drop_table("task_records")
