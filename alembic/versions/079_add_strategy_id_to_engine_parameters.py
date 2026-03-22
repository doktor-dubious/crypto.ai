"""Add prediction_strategy_id to prediction_engine_parameter.

Revision ID: 079
Revises: 078
Create Date: 2026-03-22

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "079"
down_revision: str = "078"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    # Add nullable FK column
    op.add_column(
        "prediction_engine_parameter",
        sa.Column(
            "prediction_strategy_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("prediction_strategies.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_prediction_engine_parameter_prediction_strategy_id",
        "prediction_engine_parameter",
        ["prediction_strategy_id"],
    )

    # Replace old unique constraint with one that includes strategy_id
    op.drop_constraint(
        "uq_engine_param_name_value",
        "prediction_engine_parameter",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_engine_strategy_param_name_value",
        "prediction_engine_parameter",
        ["prediction_engine_id", "prediction_strategy_id", "name", "value"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_engine_strategy_param_name_value",
        "prediction_engine_parameter",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_engine_param_name_value",
        "prediction_engine_parameter",
        ["prediction_engine_id", "name", "value"],
    )
    op.drop_index(
        "ix_prediction_engine_parameter_prediction_strategy_id",
        "prediction_engine_parameter",
    )
    op.drop_column("prediction_engine_parameter", "prediction_strategy_id")
