"""Add updated_at trigger to task_records.

Ensures updated_at is refreshed on every UPDATE, regardless of whether
the change comes from ORM-level or Core-level SQL.  This is critical for
orphaned-task detection: progress callbacks use Core-level UPDATEs, and
SQLAlchemy's onupdate only fires for ORM-level changes.

Revision ID: 089
Revises: 088
Create Date: 2026-03-24

"""

from alembic import op

revision: str = "089"
down_revision: str = "088"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_task_records_updated_at
          BEFORE UPDATE ON task_records
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_task_records_updated_at ON task_records;")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at();")
