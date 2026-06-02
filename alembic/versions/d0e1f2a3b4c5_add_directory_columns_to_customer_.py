"""Add directory columns to customer_configuration

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-04-18 17:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "customer_configuration",
        sa.Column("home_directory", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("upload_directory", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("upload_directory_storage", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("forecast_directory", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("forecast_directory_storage", sa.String(length=512), nullable=True),
    )

    # Seed defaults for Toronto Star
    op.execute(
        """
        UPDATE customer_configuration
        SET home_directory = '/cassandra/ftp',
            upload_directory = '/toronto_star/data',
            upload_directory_storage = '/toronto_star/data/historic',
            forecast_directory = '/toronto_star/draw',
            forecast_directory_storage = '/toronto_star/draw/historic'
        WHERE customer_id IN (
            SELECT id FROM customers WHERE name = 'Toronto Star'
        )
        """
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "forecast_directory_storage")
    op.drop_column("customer_configuration", "forecast_directory")
    op.drop_column("customer_configuration", "upload_directory_storage")
    op.drop_column("customer_configuration", "upload_directory")
    op.drop_column("customer_configuration", "home_directory")
