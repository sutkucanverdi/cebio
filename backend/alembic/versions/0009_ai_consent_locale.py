"""yapay zeka için ayrı açık rıza, kullanıcı dili, yapay zeka cevabı raporları

Revision ID: 0009_ai_consent_locale
Revises: 0008_password_reset
Create Date: 2026-11-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_ai_consent_locale"
down_revision: Union[str, None] = "0008_password_reset"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("ai_consent_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("locale", sa.String(5), nullable=False, server_default="tr"))

    # Eski kayıt ekranı yapay zeka aktarımına açık rızayı kullanım koşullarıyla BİRLİKTE alıyordu.
    # O onay verilmiş sayılır (kullanıcı ayarlardan geri alabilir); yeni kayıtlarda rıza ayrı sorulur.
    op.execute("UPDATE users SET ai_consent_at = terms_accepted_at WHERE terms_accepted_at IS NOT NULL")

    op.create_table(
        "ai_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_ai_reports_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("feature", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_reports_id", "ai_reports", ["id"])
    op.create_index("ix_ai_reports_user_id", "ai_reports", ["user_id"])


def downgrade() -> None:
    op.drop_table("ai_reports")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("locale")
        batch.drop_column("ai_consent_at")
