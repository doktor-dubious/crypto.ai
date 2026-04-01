"""move insights_hidden_prompt to configuration

Revision ID: manual_move_hidden_prompt
Revises: 05ddb19f71fb
"""
from alembic import op
import sqlalchemy as sa

revision = "b1f2c3d4e5f6"
down_revision = "05ddb19f71fb"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("configuration", sa.Column("insights_hidden_prompt", sa.Text(), nullable=True))
    op.drop_column("customer_configuration", "insights_hidden_prompt")

def downgrade():
    op.add_column("customer_configuration", sa.Column("insights_hidden_prompt", sa.Text(), nullable=True))
    op.drop_column("configuration", "insights_hidden_prompt")
