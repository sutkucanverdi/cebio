"""baseline: kullanıcı sistemi öncesi şema (receipts, receipt_items)

Alembic'ten önce `create_all` ile oluşturulmuş veritabanlarında tablolar zaten vardır;
bu revizyon o durumda yalnızca eksik sütunları tamamlar ve sürümü işaretler.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "receipts" not in tables:
        op.create_table(
            "receipts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("merchant", sa.String(255), nullable=False),
            sa.Column("date", sa.String(10), nullable=False),
            sa.Column("total_amount", sa.Float(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_receipts_id", "receipts", ["id"])
        op.create_index("ix_receipts_merchant", "receipts", ["merchant"])
        op.create_index("ix_receipts_date", "receipts", ["date"])

    if "receipt_items" not in tables:
        op.create_table(
            "receipt_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "receipt_id",
                sa.Integer(),
                sa.ForeignKey("receipts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="1.0"),
            sa.Column("unit_price", sa.Float(), nullable=True),
            sa.Column("category", sa.String(100), nullable=False),
        )
        op.create_index("ix_receipt_items_id", "receipt_items", ["id"])
        op.create_index("ix_receipt_items_receipt_id", "receipt_items", ["receipt_id"])
        op.create_index("ix_receipt_items_category", "receipt_items", ["category"])
    else:
        # Eski main.py içindeki elle ALTER TABLE mantığının karşılığı.
        cols = {c["name"] for c in inspector.get_columns("receipt_items")}
        if "quantity" not in cols:
            op.add_column(
                "receipt_items",
                sa.Column("quantity", sa.Float(), nullable=False, server_default="1.0"),
            )
        if "unit_price" not in cols:
            op.add_column("receipt_items", sa.Column("unit_price", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_table("receipt_items")
    op.drop_table("receipts")
