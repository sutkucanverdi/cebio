"""abonelikler ve ücret değişikliği geçmişi

Revision ID: 0003_subscriptions
Revises: 0002_users_money_date
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_subscriptions"
down_revision: Union[str, None] = "0002_users_money_date"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(12, 2)


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_subscriptions_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="TRY"),
        sa.Column("billing_cycle", sa.String(16), nullable=False),
        sa.Column("next_billing_date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("trial_ends_at", sa.Date(), nullable=True),
        sa.Column("cancel_url", sa.String(500), nullable=True),
        sa.Column("notes", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_subscriptions_id", "subscriptions", ["id"])
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"])
    op.create_index("ix_subscriptions_next_billing_date", "subscriptions", ["next_billing_date"])
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"])

    op.create_table(
        "subscription_price_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "subscription_id",
            sa.Integer(),
            sa.ForeignKey(
                "subscriptions.id", name="fk_subscription_price_changes_subscription_id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("old_amount", MONEY, nullable=False),
        sa.Column("new_amount", MONEY, nullable=False),
        sa.Column("changed_at", sa.Date(), nullable=False),
    )
    op.create_index("ix_subscription_price_changes_id", "subscription_price_changes", ["id"])
    op.create_index(
        "ix_subscription_price_changes_subscription_id", "subscription_price_changes", ["subscription_id"]
    )


def downgrade() -> None:
    op.drop_table("subscription_price_changes")
    op.drop_table("subscriptions")
