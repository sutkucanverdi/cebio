"""ekstreden içe aktarılan banka/kart harcamaları

Revision ID: 0006_bank_transactions
Revises: 0005_terms_consent
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_bank_transactions"
down_revision: Union[str, None] = "0005_terms_consent"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "statement_imports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_statement_imports_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_statement_imports_id", "statement_imports", ["id"])
    op.create_index("ix_statement_imports_user_id", "statement_imports", ["user_id"])

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_transactions_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "import_id",
            sa.Integer(),
            sa.ForeignKey("statement_imports.id", name="fk_transactions_import_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("merchant", sa.String(120), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="TRY"),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column(
            "matched_receipt_id",
            sa.Integer(),
            sa.ForeignKey("receipts.id", name="fk_transactions_matched_receipt_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "fingerprint", name="uq_transactions_user_fingerprint"),
    )
    for col in ("id", "user_id", "import_id", "date", "merchant", "category", "matched_receipt_id"):
        op.create_index(f"ix_transactions_{col}", "transactions", [col])


def downgrade() -> None:
    op.drop_table("transactions")
    op.drop_table("statement_imports")
