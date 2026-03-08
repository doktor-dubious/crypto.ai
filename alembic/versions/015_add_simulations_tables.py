"""Add simulations and simulation_dates tables.

Revision ID: 015
Revises: 014
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "simulations",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("prediction_strategy_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("task_id", sa.String(255), nullable=True),
        sa.Column("outlet_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=False)), nullable=True),
        sa.Column("simulation_from", sa.Date(), nullable=True),
        sa.Column("simulation_to", sa.Date(), nullable=True),
        sa.Column("delay", sa.SmallInteger(), nullable=True),
        sa.Column("engine", sa.String(255), nullable=True),
        # Delivered scenario
        sa.Column("delivered_total_delivered", sa.Float(), nullable=True),
        sa.Column("delivered_total_sold", sa.Float(), nullable=True),
        sa.Column("delivered_total_returned", sa.Float(), nullable=True),
        sa.Column("delivered_g1", sa.Integer(), nullable=True),
        sa.Column("delivered_g2", sa.Integer(), nullable=True),
        sa.Column("delivered_g3", sa.Integer(), nullable=True),
        sa.Column("delivered_g4", sa.Integer(), nullable=True),
        sa.Column("delivered_g1_profit", sa.Float(), nullable=True),
        sa.Column("delivered_g2_profit", sa.Float(), nullable=True),
        sa.Column("delivered_g3_profit", sa.Float(), nullable=True),
        sa.Column("delivered_g4_profit", sa.Float(), nullable=True),
        # Prediction scenario
        sa.Column("prediction_total_delivered", sa.Float(), nullable=True),
        sa.Column("prediction_total_sold", sa.Float(), nullable=True),
        sa.Column("prediction_total_returned", sa.Float(), nullable=True),
        sa.Column("prediction_g1", sa.Integer(), nullable=True),
        sa.Column("prediction_g2", sa.Integer(), nullable=True),
        sa.Column("prediction_g3", sa.Integer(), nullable=True),
        sa.Column("prediction_g4", sa.Integer(), nullable=True),
        sa.Column("prediction_g1_profit", sa.Float(), nullable=True),
        sa.Column("prediction_g2_profit", sa.Float(), nullable=True),
        sa.Column("prediction_g3_profit", sa.Float(), nullable=True),
        sa.Column("prediction_g4_profit", sa.Float(), nullable=True),
        # Economic optimal scenario
        sa.Column("eo_total_delivered", sa.Float(), nullable=True),
        sa.Column("eo_total_sold", sa.Float(), nullable=True),
        sa.Column("eo_total_returned", sa.Float(), nullable=True),
        sa.Column("eo_g1", sa.Integer(), nullable=True),
        sa.Column("eo_g2", sa.Integer(), nullable=True),
        sa.Column("eo_g3", sa.Integer(), nullable=True),
        sa.Column("eo_g4", sa.Integer(), nullable=True),
        sa.Column("eo_g1_profit", sa.Float(), nullable=True),
        sa.Column("eo_g2_profit", sa.Float(), nullable=True),
        sa.Column("eo_g3_profit", sa.Float(), nullable=True),
        sa.Column("eo_g4_profit", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prediction_strategy_id"], ["prediction_strategies.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_simulations_customer_id", "simulations", ["customer_id"])
    op.create_index("ix_simulations_prediction_strategy_id", "simulations", ["prediction_strategy_id"])
    op.create_index("ix_simulations_task_id", "simulations", ["task_id"])

    op.create_table(
        "simulation_dates",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("simulation_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("prediction_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.ForeignKeyConstraint(["simulation_id"], ["simulations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_simulation_dates_simulation_id", "simulation_dates", ["simulation_id"])
    op.create_index("ix_simulation_dates_prediction_id", "simulation_dates", ["prediction_id"])


def downgrade() -> None:
    op.drop_table("simulation_dates")
    op.drop_table("simulations")
