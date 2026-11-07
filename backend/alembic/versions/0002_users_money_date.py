"""kullanıcılar, fişlerde user_id, Decimal tutarlar ve Date tipi

Revision ID: 0002_users_money_date
Revises: 0001_baseline
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_users_money_date"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(12, 2)
QUANTITY = sa.Numeric(12, 3)


def _receipts_columns() -> list:
    return [
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_receipts_user_id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("merchant", sa.String(255), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("total_amount", MONEY, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    ]


def _items_columns() -> list:
    return [
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "receipt_id",
            sa.Integer(),
            sa.ForeignKey("receipts.id", name="fk_receipt_items_receipt_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("price", MONEY, nullable=False),
        sa.Column("quantity", QUANTITY, nullable=False, server_default="1"),
        sa.Column("unit_price", MONEY, nullable=True),
        sa.Column("category", sa.String(100), nullable=False),
    ]


def _create_indexes() -> None:
    op.create_index("ix_receipts_id", "receipts", ["id"])
    op.create_index("ix_receipts_user_id", "receipts", ["user_id"])
    op.create_index("ix_receipts_merchant", "receipts", ["merchant"])
    op.create_index("ix_receipts_date", "receipts", ["date"])
    op.create_index("ix_receipt_items_id", "receipt_items", ["id"])
    op.create_index("ix_receipt_items_receipt_id", "receipt_items", ["receipt_id"])
    op.create_index("ix_receipt_items_category", "receipt_items", ["category"])


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        _upgrade_sqlite()
    else:
        _upgrade_generic()


def _upgrade_sqlite() -> None:
    # SQLite ALTER COLUMN desteklemez. Alembic'in batch modu tip değişiminde CAST(... AS DATE) uygular
    # ve SQLite bu ifadeyle '2026-11-01' metnini 2026 sayısına çevirir (veri bozulur).
    # Bu yüzden tabloları yeniden oluşturup veriyi dönüştürmeden kopyalıyoruz.
    # (env.py bu migration sırasında PRAGMA foreign_keys=OFF yapar.)
    op.create_table("receipts_new", *_receipts_columns())
    op.execute(
        "INSERT INTO receipts_new (id, user_id, merchant, date, total_amount, created_at) "
        "SELECT id, NULL, merchant, substr(trim(date), 1, 10), ROUND(total_amount, 2), created_at FROM receipts"
    )

    op.create_table("receipt_items_new", *_items_columns())
    op.execute(
        "INSERT INTO receipt_items_new (id, receipt_id, name, price, quantity, unit_price, category) "
        "SELECT id, receipt_id, name, ROUND(price, 2), COALESCE(quantity, 1), "
        "CASE WHEN unit_price IS NULL THEN NULL ELSE ROUND(unit_price, 2) END, category "
        "FROM receipt_items"
    )

    op.drop_table("receipt_items")
    op.drop_table("receipts")
    op.rename_table("receipts_new", "receipts")
    op.rename_table("receipt_items_new", "receipt_items")
    _create_indexes()


def _upgrade_generic() -> None:
    op.add_column("receipts", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_receipts_user_id", "receipts", "users", ["user_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_receipts_user_id", "receipts", ["user_id"])
    op.alter_column(
        "receipts", "date", type_=sa.Date(), existing_type=sa.String(10),
        postgresql_using="date::date",
    )
    op.alter_column(
        "receipts", "total_amount", type_=MONEY, existing_type=sa.Float(),
        postgresql_using="round(total_amount::numeric, 2)",
    )
    for col, new_type in (("price", MONEY), ("quantity", QUANTITY), ("unit_price", MONEY)):
        op.alter_column(
            "receipt_items", col, type_=new_type, existing_type=sa.Float(),
            postgresql_using=f"{col}::numeric",
        )


def downgrade() -> None:
    raise NotImplementedError("Bu migration geri alınamaz; yedekten dönün.")
