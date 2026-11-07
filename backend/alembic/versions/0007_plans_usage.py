"""ücretsiz/premium plan ve aylık kullanım sayaçları

Revision ID: 0007_plans_usage
Revises: 0006_bank_transactions
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_plans_usage"
down_revision: Union[str, None] = "0006_bank_transactions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("premium_until", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("plan_source", sa.String(20), nullable=True))

    op.create_table(
        "usage_counters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_usage_counters_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("feature", sa.String(32), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("user_id", "period", "feature", name="uq_usage_user_period_feature"),
    )
    op.create_index("ix_usage_counters_id", "usage_counters", ["id"])
    op.create_index("ix_usage_counters_user_id", "usage_counters", ["user_id"])


def downgrade() -> None:
    op.drop_table("usage_counters")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("plan_source")
        batch.drop_column("premium_until")
