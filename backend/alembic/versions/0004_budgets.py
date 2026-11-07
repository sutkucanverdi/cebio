"""aylık bütçeler

Revision ID: 0004_budgets
Revises: 0003_subscriptions
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_budgets"
down_revision: Union[str, None] = "0003_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_budgets_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("monthly_limit", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_budgets_id", "budgets", ["id"])
    op.create_index("ix_budgets_user_id", "budgets", ["user_id"])


def downgrade() -> None:
    op.drop_table("budgets")
