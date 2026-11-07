"""kullanıcı yasal metin onayı (KVKK)

Revision ID: 0005_terms_consent
Revises: 0004_budgets
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_terms_consent"
down_revision: Union[str, None] = "0004_budgets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("terms_version", sa.String(20), nullable=True))
        batch.add_column(sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("terms_accepted_at")
        batch.drop_column("terms_version")
