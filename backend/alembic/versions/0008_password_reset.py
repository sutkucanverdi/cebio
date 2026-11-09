"""şifre sıfırlama kodları ve şifre değişim zamanı

Revision ID: 0008_password_reset
Revises: 0007_plans_usage
Create Date: 2026-11-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_password_reset"
down_revision: Union[str, None] = "0007_plans_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_password_reset_codes_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_password_reset_codes_id", "password_reset_codes", ["id"])
    op.create_index("ix_password_reset_codes_user_id", "password_reset_codes", ["user_id"])


def downgrade() -> None:
    op.drop_table("password_reset_codes")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("password_changed_at")
